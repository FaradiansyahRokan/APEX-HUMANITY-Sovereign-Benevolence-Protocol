"""
APEX HUMANITY — SATIN Parameter Integrity Validator
====================================================
v1.0.0 — Anti-Manipulation Core

Lapisan pertahanan berlapis terhadap manipulasi parameter:

  Layer A: Action Constraint Matrix
    - Hard caps per action_type (max people/hour, max effort_hours, urgency range)
    - Plausibility windows yang realistis berdasarkan data lapangan nyata

  Layer B: Description NLP Cross-Validator
    - Keyword presence/absence analysis per action_type
    - Mendeteksi "membantu orang menyebrang" tapi klaim DISASTER_RELIEF

  Layer C: YOLO Person Count Triangulation
    - Bandingkan visible_person_count dari CV vs claimed people_helped
    - Jika foto hanya ada 2 orang tapi klaim 500 → suspect

  Layer D: Effort-to-People Ratio Anomaly
    - Deteksi "1 jam effort tapi 5000 orang dibantu" → statistik mustahil
    - Per-action ratio windows berdasarkan ground truth NGO data

  Layer E: LLM Consistency Auditor (Anthropic API)
    - AI cross-reads description vs ALL claimed parameters
    - Single most powerful anti-lying mechanism
    - Runs async, result baked into penalty system

  Layer F: Urgency-Action Compatibility Matrix
    - ENVIRONMENTAL_ACTION + CRITICAL → blocked kecuali ada keyword valid
    - FOOD_DISTRIBUTION + CRITICAL → hanya valid jika ada konteks bencana
"""

from __future__ import annotations

import logging
import math
import os
import re
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("satin.param_validator")

# ── Ollama API untuk Local VLM Cross-Validator ───────────────────────────────────
import requests
import base64

_OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"
# Assume always available for this local integration
_LLM_AVAILABLE = True


# ═══════════════════════════════════════════════════════════════════════════════
# KONSTANTA & MATRIKS PLAUSIBILITAS
# ═══════════════════════════════════════════════════════════════════════════════

# Hard limits per action type — berdasarkan data real NGO/disaster response:
#   max_people_per_hour : berapa orang MAKSIMUM yang bisa dibantu per jam
#   max_effort_hours    : durasi maksimum realistis (single event)
#   max_people_abs      : hard cap absolute untuk people_helped
#   urgency_allowed     : urgency level yang logis untuk action ini
#   require_any_keyword : kata kunci MINIMAL 1 harus ada di description (bahasa ID/EN)
#   forbid_if_keyword   : jika kata ini ada DAN action tidak match → manipulasi
#   typical_people_min  : jika kurang dari ini, action type mencurigakan
ACTION_CONSTRAINTS: dict[str, dict] = {
    "FOOD_DISTRIBUTION": {
        "max_people_per_hour": 80,      # 1 relawan bisa bantu max 80 org/jam di dapur umum
        "max_effort_hours":    16,      # shift kerja paling panjang di lapangan
        "max_people_abs":      1000,    # 1 relawan 1 event, max 1000 orang (dengan tim besar)
        "urgency_allowed":     ["LOW", "MEDIUM", "HIGH", "CRITICAL"],  # CRITICAL valid saat bencana
        "require_any_keyword": [
            "makan", "food", "distribusi", "bagi", "nasi", "sembako", "makanan",
            "meal", "rice", "ration", "package", "paket", "logistik", "pangan",
            "dapur", "kitchen", "hunger", "lapar", "nutrisi", "nutrition"
        ],
        "critical_requires_keyword": [
            "bencana", "disaster", "darurat", "emergency", "pengungsi", "refugee",
            "banjir", "flood", "gempa", "earthquake", "crisis", "krisis"
        ],
        "typical_people_min": 5,
    },
    "MEDICAL_AID": {
        "max_people_per_hour": 12,      # dokter/paramedis → 12 pasien/jam max
        "max_effort_hours":    24,      # shift medis darurat bisa 24 jam
        "max_people_abs":      200,
        "urgency_allowed":     ["MEDIUM", "HIGH", "CRITICAL"],
        "require_any_keyword": [
            "medis", "medical", "obat", "medicine", "sakit", "sick", "luka", "wound",
            "dokter", "doctor", "nurse", "perawat", "health", "kesehatan", "clinic",
            "klinik", "patient", "pasien", "injury", "cedera", "treatment", "pengobatan",
            "first aid", "p3k", "ambulan", "ambulance", "hospital", "rumah sakit"
        ],
        "critical_requires_keyword": None,  # CRITICAL always valid for MEDICAL
        "typical_people_min": 1,
    },
    "SHELTER_CONSTRUCTION": {
        "max_people_per_hour": 5,       # konstruksi fisik → 5 keluarga/hari realistis
        "max_effort_hours":    72,      # bisa multi-hari
        "max_people_abs":      100,
        "urgency_allowed":     ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        "require_any_keyword": [
            "shelter", "rumah", "house", "bangunan", "building", "tenda", "tent",
            "konstruksi", "construction", "bangun", "build", "atap", "roof",
            "tempat tinggal", "hunian", "terpal", "tarpaulin", "fondasi", "foundation",
            "renovasi", "renovation", "perbaikan", "repair"
        ],
        "critical_requires_keyword": [
            "bencana", "disaster", "darurat", "emergency", "pengungsi"
        ],
        "typical_people_min": 1,
    },
    "EDUCATION_SESSION": {
        "max_people_per_hour": 100,     # 1 guru bisa ajar 100 murid/jam (seminar)
        "max_effort_hours":    10,      # sesi edukasi max 10 jam
        "max_people_abs":      300,
        "urgency_allowed":     ["LOW", "MEDIUM", "HIGH"],  # CRITICAL tidak logis untuk edukasi
        "require_any_keyword": [
            "belajar", "learn", "mengajar", "teach", "sekolah", "school", "kelas", "class",
            "edukasi", "education", "siswa", "student", "murid", "pelatihan", "training",
            "workshop", "seminar", "literacy", "literasi", "book", "buku", "skill",
            "keterampilan", "tutoring", "les", "mengaji", "reading"
        ],
        "critical_requires_keyword": [],  # CRITICAL essentially banned for education
        "typical_people_min": 2,
    },
    "DISASTER_RELIEF": {
        "max_people_per_hour": 50,
        "max_effort_hours":    72,
        "max_people_abs":      2000,    # large-scale disaster — higher cap
        "urgency_allowed":     ["HIGH", "CRITICAL"],  # LOW/MEDIUM tidak logis untuk disaster
        "require_any_keyword": [
            "bencana", "disaster", "gempa", "earthquake", "banjir", "flood",
            "tsunami", "kebakaran", "fire", "longsor", "landslide", "evakuasi",
            "evacuation", "darurat", "emergency", "korban", "victim", "rescue",
            "penyelamatan", "bantuan darurat", "relief", "tanggap darurat"
        ],
        "critical_requires_keyword": None,
        "typical_people_min": 5,
    },
    "CLEAN_WATER_PROJECT": {
        "max_people_per_hour": 30,
        "max_effort_hours":    48,
        "max_people_abs":      500,
        "urgency_allowed":     ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        "require_any_keyword": [
            "air", "water", "sumur", "well", "sanitasi", "sanitation", "bersih", "clean",
            "minum", "drinking", "filter", "pompa", "pump", "sumber air", "water source",
            "irigasi", "irrigation", "toilet", "MCK", "hygiene", "kebersihan"
        ],
        "critical_requires_keyword": [
            "kekeringan", "drought", "darurat", "emergency", "kontaminasi", "contamination"
        ],
        "typical_people_min": 5,
    },
    "MENTAL_HEALTH_SUPPORT": {
        "max_people_per_hour": 8,       # konseling: max 8 sesi/jam (kelompok kecil)
        "max_effort_hours":    12,
        "max_people_abs":      50,
        "urgency_allowed":     ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        "require_any_keyword": [
            "mental", "psikologi", "psychology", "trauma", "counseling", "konseling",
            "stress", "anxiety", "depresi", "depression", "emotion", "emosi",
            "jiwa", "wellbeing", "kesehatan mental", "support group", "therapy",
            "terapi", "healing", "pemulihan", "grief", "dukacita"
        ],
        "critical_requires_keyword": [
            "trauma", "bencana", "disaster", "krisis", "crisis", "suicide", "bunuh diri"
        ],
        "typical_people_min": 1,
    },
    "ENVIRONMENTAL_ACTION": {
        "max_people_per_hour": 40,      # bersih-bersih: 40 orang terlibat per jam
        "max_effort_hours":    16,
        "max_people_abs":      1000,
        "urgency_allowed":     ["LOW", "MEDIUM", "HIGH"],  # CRITICAL sangat jarang valid
        "require_any_keyword": [
            "lingkungan", "environment", "sampah", "trash", "garbage", "plastic",
            "plastik", "bersih", "clean", "tanam", "plant", "pohon", "tree",
            "recycle", "daur ulang", "polusi", "pollution", "pantai", "beach",
            "sungai", "river", "hutan", "forest", "mangrove", "solar", "energi"
        ],
        "critical_requires_keyword": [
            "kebakaran hutan", "forest fire", "tumpahan minyak", "oil spill",
            "bencana lingkungan", "environmental disaster", "toxic", "beracun"
        ],
        "typical_people_min": 1,
    },
}

# Effort-People ratio yang MUSTAHIL secara fisik per action type
# Format: (max_people_per_single_hour_when_effort_is_1h)
# Misal: effort=1h, people=500 → 500 org/jam → jauh di atas threshold → fraud
PHYSICAL_IMPOSSIBILITY_RATIOS: dict[str, float] = {
    "FOOD_DISTRIBUTION":     120.0,   # 1 org tidak bisa bantu >120 org/jam
    "MEDICAL_AID":           20.0,
    "SHELTER_CONSTRUCTION":  8.0,
    "EDUCATION_SESSION":     150.0,   # seminar besar masih bisa 150/jam
    "DISASTER_RELIEF":       80.0,
    "CLEAN_WATER_PROJECT":   50.0,
    "MENTAL_HEALTH_SUPPORT": 12.0,
    "ENVIRONMENTAL_ACTION":  60.0,
}


# ═══════════════════════════════════════════════════════════════════════════════
# RESULT DATACLASS
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ValidationResult:
    passed:              bool
    hard_blocked:        bool        = False   # True = reject langsung
    block_reason:        str         = ""      # alasan hard block
    penalties:           list[dict]  = field(default_factory=list)
    warnings:            list[str]   = field(default_factory=list)
    total_penalty:       float       = 0.0     # 0.0–1.0
    adjusted_effort_hours:   Optional[float] = None   # nilai yg sudah di-clamp
    adjusted_people_helped:  Optional[int]   = None
    adjusted_urgency:        Optional[str]   = None
    llm_verdict:         Optional[str] = None  # "consistent" | "suspicious" | "fabricated"
    llm_reason:          Optional[str] = None

    def add_penalty(self, code: str, amount: float, reason: str):
        self.penalties.append({"code": code, "amount": amount, "reason": reason})
        self.total_penalty = min(0.60, self.total_penalty + amount) # Cap total param penalty at 60%
        self.warnings.append(code)
        logger.warning(f"[ParamValidator] PENALTY +{amount:.0%} | {code}: {reason}")

    def hard_block(self, reason: str):
        self.hard_blocked = True
        self.passed       = False
        self.block_reason = reason
        logger.error(f"[ParamValidator] HARD BLOCK: {reason}")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN VALIDATOR CLASS
# ═══════════════════════════════════════════════════════════════════════════════

class ParameterValidator:
    """
    Single-entry validation point. Dipanggil dari main.py sebelum evaluasi oracle.

    Usage:
        validator = ParameterValidator()
        result = validator.validate(
            action_type       = "DISASTER_RELIEF",
            urgency_level     = "CRITICAL",
            effort_hours      = 8.0,
            people_helped     = 200,
            description       = "...",
            detected_objects  = ["person", "food"],   # dari YOLO
            person_count_yolo = 3,                    # jumlah orang di foto
        )
        if result.hard_blocked:
            raise HTTPException(409, result.block_reason)
    """

    def __init__(self):
        self._llm_available = _LLM_AVAILABLE
        logger.info(
            f"ParameterValidator initialized | Local VLM layer (Ollama): {'ON' if self._llm_available else 'OFF'}"
        )

    # ─────────────────────────────────────────────────────────────────────────
    # PUBLIC ENTRY POINT
    # ─────────────────────────────────────────────────────────────────────────
    def validate(
        self,
        action_type:        str,
        urgency_level:      str,
        effort_hours:       float,
        people_helped:      int,
        description:        str,
        detected_objects:   Optional[list[str]] = None,
        person_count_yolo:  Optional[int]       = None,
        image_bytes:        Optional[bytes]     = None,
    ) -> ValidationResult:
        result = ValidationResult(passed=True)
        constraint = ACTION_CONSTRAINTS.get(action_type.upper(), {})

        if not constraint:
            result.add_penalty(
                "unknown_action_type", 0.20,
                f"Action type '{action_type}' tidak dikenal — tidak dapat divalidasi"
            )
            return result

        # Run all validation layers
        self._check_effort_hours(result, constraint, effort_hours, action_type)
        self._check_people_helped(result, constraint, people_helped, action_type)
        self._check_effort_people_ratio(result, action_type, effort_hours, people_helped)
        self._check_urgency(result, constraint, urgency_level, description, action_type)
        self._check_description_keywords(result, constraint, description, action_type, urgency_level)
        self._check_yolo_count_vs_claimed(result, person_count_yolo, people_helped, action_type)
        self._check_yolo_objects_vs_action(result, detected_objects, action_type)

        # LLM layer (most powerful — runs last, most expensive)
        if self._llm_available and description.strip():
            self._llm_cross_validate(
                result, action_type, urgency_level,
                effort_hours, people_helped, description, image_bytes
            )

        # Auto-clamp adjusted values for downstream use
        result.adjusted_effort_hours  = self._clamp_effort(constraint, effort_hours)
        result.adjusted_people_helped = self._clamp_people(constraint, people_helped)

        if result.total_penalty >= 0.80:
            result.hard_block(
                f"Akumulasi skor manipulasi terlalu tinggi ({result.total_penalty:.0%}). "
                f"Flags: {', '.join(result.warnings[:5])}"
            )

        return result

    # ─────────────────────────────────────────────────────────────────────────
    # LAYER A: EFFORT HOURS VALIDATION
    # ─────────────────────────────────────────────────────────────────────────
    def _check_effort_hours(
        self, result: ValidationResult, constraint: dict, effort_hours: float, action_type: str
    ):
        max_hours = constraint.get("max_effort_hours", 24)

        if effort_hours > max_hours * 2:
            result.hard_block(
                f"effort_hours={effort_hours:.1f}h jauh melampaui batas fisik realistis "
                f"untuk {action_type} (max={max_hours}h). Mustahil secara fisik."
            )
            return

        if effort_hours > max_hours:
            overshoot_pct = (effort_hours - max_hours) / max_hours
            penalty = min(0.25, 0.10 + overshoot_pct * 0.15) # Moderate effort penalty
            result.add_penalty(
                "effort_hours_inflated",
                penalty,
                f"{action_type} effort={effort_hours:.1f}h melebihi batas realistis {max_hours}h "
                f"({overshoot_pct:.0%} overshoot)"
            )

        # Sangat rendah tapi klaim action type berat
        if effort_hours < 0.5 and action_type in ("DISASTER_RELIEF", "SHELTER_CONSTRUCTION", "CLEAN_WATER_PROJECT"):
            result.add_penalty(
                "effort_too_low_for_action",
                0.25,
                f"{action_type} tidak mungkin selesai dalam {effort_hours:.1f}h — "
                f"action ini butuh kerja fisik substansial"
            )

    # ─────────────────────────────────────────────────────────────────────────
    # LAYER A: PEOPLE HELPED VALIDATION
    # ─────────────────────────────────────────────────────────────────────────
    def _check_people_helped(
        self, result: ValidationResult, constraint: dict, people_helped: int, action_type: str
    ):
        max_abs = constraint.get("max_people_abs", 500)
        max_per_hour = constraint.get("max_people_per_hour", 50)

        if people_helped > max_abs * 3:
            result.hard_block(
                f"people_helped={people_helped} jauh melampaui batas absolut fisik "
                f"untuk satu relawan ({action_type}, max={max_abs}). "
                f"Data ini tidak bisa benar."
            )
            return

        if people_helped > max_abs:
            overshoot_pct = (people_helped - max_abs) / max_abs
            penalty = min(0.30, 0.15 + overshoot_pct * 0.10) # Moderate inflated people penalty
            result.add_penalty(
                "people_helped_inflated",
                penalty,
                f"{action_type}: {people_helped} orang melewati batas realistis {max_abs} "
                f"untuk 1 relawan ({overshoot_pct:.0%} overshoot)"
            )

    # ─────────────────────────────────────────────────────────────────────────
    # LAYER D: EFFORT-TO-PEOPLE RATIO ANOMALY
    # ─────────────────────────────────────────────────────────────────────────
    def _check_effort_people_ratio(
        self, result: ValidationResult, action_type: str, effort_hours: float, people_helped: int
    ):
        if effort_hours <= 0:
            return

        actual_ratio = people_helped / effort_hours
        impossible_ratio = PHYSICAL_IMPOSSIBILITY_RATIOS.get(action_type.upper(), 100.0)

        if actual_ratio > impossible_ratio * 3:
            result.hard_block(
                f"Rasio {people_helped} orang / {effort_hours:.1f}h = {actual_ratio:.0f} org/jam "
                f"MUSTAHIL secara fisik untuk {action_type} (batas: {impossible_ratio:.0f}/jam). "
                f"Ini adalah indikasi kuat inflasi data."
            )
            return

        if actual_ratio > impossible_ratio:
            overshoot_pct = (actual_ratio - impossible_ratio) / impossible_ratio
            penalty = min(0.25, 0.15 + overshoot_pct * 0.05) # Moderate ratio penalty
            result.add_penalty(
                "effort_people_ratio_anomaly",
                penalty,
                f"Rasio effort/people={actual_ratio:.0f}/jam tidak realistis "
                f"untuk {action_type} (max fisik: {impossible_ratio:.0f}/jam)"
            )

    # ─────────────────────────────────────────────────────────────────────────
    # LAYER F: URGENCY-ACTION COMPATIBILITY
    # ─────────────────────────────────────────────────────────────────────────
    def _check_urgency(
        self,
        result:       ValidationResult,
        constraint:   dict,
        urgency_level: str,
        description:  str,
        action_type:  str,
    ):
        allowed = constraint.get("urgency_allowed", ["LOW", "MEDIUM", "HIGH", "CRITICAL"])
        desc_lower = description.lower()

        if urgency_level not in allowed:
            result.add_penalty(
                "urgency_incompatible_with_action",
                0.35,
                f"URGENCY={urgency_level} tidak kompatibel dengan {action_type}. "
                f"Action ini hanya menerima: {allowed}"
            )
            return

        # CRITICAL butuh konteks khusus untuk action tertentu
        if urgency_level == "CRITICAL":
            critical_keywords = constraint.get("critical_requires_keyword")
            if critical_keywords is not None and len(critical_keywords) > 0:
                has_critical_context = any(kw in desc_lower for kw in critical_keywords)
                if not has_critical_context:
                    result.add_penalty(
                        "critical_urgency_without_context",
                        0.30,
                        f"URGENCY=CRITICAL untuk {action_type} butuh konteks darurat "
                        f"di description (kata kunci: {critical_keywords[:3]}…). "
                        f"Kemungkinan urgency dinaikkan untuk memanipulasi skor."
                    )

            elif critical_keywords is not None and len(critical_keywords) == 0:
                # Empty list = CRITICAL is banned for this action type
                result.add_penalty(
                    "critical_urgency_banned_for_action",
                    0.40,
                    f"URGENCY=CRITICAL tidak valid untuk {action_type}. "
                    f"Action ini hampir tidak pernah merupakan situasi CRITICAL."
                )

    # ─────────────────────────────────────────────────────────────────────────
    # LAYER B: DESCRIPTION KEYWORD VALIDATION
    # ─────────────────────────────────────────────────────────────────────────
    def _check_description_keywords(
        self,
        result:       ValidationResult,
        constraint:   dict,
        description:  str,
        action_type:  str,
        urgency_level: str,
    ):
        if len(description) < 20:
            result.add_penalty(
                "description_too_short",
                0.25,
                f"Description terlalu pendek ({len(description)} chars). "
                f"Minimal 20 karakter — tidak bisa divalidasi konteksnya."
            )
            return

        desc_lower = description.lower()
        required_keywords = constraint.get("require_any_keyword", [])
        has_relevant_keyword = any(kw in desc_lower for kw in required_keywords)

        if not has_relevant_keyword:
            result.add_penalty(
                "description_keyword_mismatch",
                0.25, # Moderate mismatch penalty
                f"Description tidak mengandung kata kunci relevan untuk {action_type}. "
                f"Contoh kata kunci yang diharapkan: {required_keywords[:5]}. "
                f"Kemungkinan action_type dipilih secara tidak jujur."
            )

        # Cross-action contamination check: kata kunci action LAIN muncul tapi tidak konsisten
        # Contoh: description bilang "pungut sampah" tapi action = DISASTER_RELIEF
        cross_action_flags = self._detect_cross_action_contamination(
            desc_lower, action_type
        )
        if cross_action_flags:
            result.add_penalty(
                "description_action_mismatch",
                0.20, # Moderate cross mismatch penalty
                f"Description lebih cocok untuk action: {', '.join(cross_action_flags)} "
                f"daripada {action_type}. Kemungkinan action_type dipilih salah/sengaja dimanipulasi."
            )

    def _detect_cross_action_contamination(self, desc_lower: str, claimed_action: str) -> list[str]:
        """Deteksi jika description sebenarnya cocok untuk action type berbeda."""
        cross_flags = []
        # Signatures yang kuat per action (kata yang sangat spesifik)
        STRONG_SIGNATURES = {
            "ENVIRONMENTAL_ACTION": ["pungut sampah", "bersih pantai", "tanam pohon", "recycle", "daur ulang"],
            "FOOD_DISTRIBUTION":    ["distribusi makanan", "bagi nasi", "dapur umum", "sembako"],
            "EDUCATION_SESSION":    ["mengajar", "belajar", "kelas", "sekolah", "workshop", "pelatihan"],
            "MEDICAL_AID":          ["obati", "rawat pasien", "periksa kesehatan", "first aid"],
            "SHELTER_CONSTRUCTION": ["bangun rumah", "renovasi", "pasang tenda", "perbaikan rumah"],
        }
        for action, sigs in STRONG_SIGNATURES.items():
            if action == claimed_action:
                continue
            if any(sig in desc_lower for sig in sigs):
                cross_flags.append(action)
        return cross_flags

    # ─────────────────────────────────────────────────────────────────────────
    # LAYER C: YOLO PERSON COUNT vs CLAIMED PEOPLE HELPED
    # ─────────────────────────────────────────────────────────────────────────
    def _check_yolo_count_vs_claimed(
        self,
        result:            ValidationResult,
        person_count_yolo: Optional[int],
        people_helped:     int,
        action_type:       str,
    ):
        if person_count_yolo is None or person_count_yolo < 0:
            return  # No image or YOLO didn't run

        # Foto dengan 0 orang tapi klaim banyak helped → suspicious
        if person_count_yolo == 0 and people_helped > 5:
            result.add_penalty(
                "no_people_visible_but_high_claimed",
                0.15, # Moderate no people penalty
                f"YOLO tidak mendeteksi orang di foto, tapi people_helped={people_helped}. "
                f"Foto tidak membuktikan keberadaan orang yang dibantu."
            )
            return

        # Ratio check: visible vs claimed
        # Allowance: foto mungkin hanya capture sebagian orang
        # Rule: visible_count × 20 harus >= claimed (1 orang di foto bisa mewakili 20)
        if person_count_yolo > 0:
            max_plausible = person_count_yolo * 30  # Moderate tolerance from 35x to 30x
            if people_helped > max_plausible and people_helped > 50:
                ratio = people_helped / max(person_count_yolo, 1)
                penalty = min(0.25, 0.10 + (ratio / 100) * 0.05) # Moderate penalty
                result.add_penalty(
                    "yolo_count_vs_claimed_mismatch",
                    penalty,
                    f"YOLO melihat {person_count_yolo} orang di foto, tapi klaim {people_helped} "
                    f"dibantu (rasio {ratio:.0f}x). Foto tidak cukup membuktikan skala klaim ini."
                )

    # ─────────────────────────────────────────────────────────────────────────
    # LAYER C: YOLO DETECTED OBJECTS vs ACTION TYPE
    # ─────────────────────────────────────────────────────────────────────────
    def _check_yolo_objects_vs_action(
        self,
        result:           ValidationResult,
        detected_objects: Optional[list[str]],
        action_type:      str,
    ):
        if not detected_objects:
            return

        detected_lower = [obj.lower() for obj in detected_objects]

        # Action-specific expected objects (COCO class names from YOLOv8)
        EXPECTED_OBJECTS: dict[str, list[str]] = {
            "FOOD_DISTRIBUTION": ["person", "bowl", "cup", "bottle", "banana", "apple", "sandwich", "carrot", "hot dog"],
            "MEDICAL_AID":       ["person"],       # stetoskop dll tidak di COCO tapi person wajib
            "SHELTER_CONSTRUCTION": ["person"],
            "EDUCATION_SESSION": ["person", "book", "laptop", "chair"],
            "DISASTER_RELIEF":   ["person"],
            "ENVIRONMENTAL_ACTION": ["person", "bottle", "cup"],
        }

        # Objects yang MENCURIGAKAN jika muncul bersamaan dengan action tertentu
        SUSPICIOUS_COMBO: dict[str, list[str]] = {
            "DISASTER_RELIEF":  ["tv", "monitor", "laptop", "couch", "bed"],  # interior, bukan disaster zone
            "FOOD_DISTRIBUTION": ["car", "motorcycle"],                         # hanya kendaraan, tidak ada makanan/orang
        }

        suspicious = SUSPICIOUS_COMBO.get(action_type, [])
        found_suspicious = [obj for obj in detected_lower if obj in suspicious]
        has_person = "person" in detected_lower

        # Tidak ada orang sama sekali di foto untuk action yang butuh interaksi manusia
        if not has_person and action_type in ("FOOD_DISTRIBUTION", "MEDICAL_AID", "EDUCATION_SESSION", "DISASTER_RELIEF"):
            result.add_penalty(
                "no_person_detected_for_people_action",
                0.20,
                f"YOLOv8 tidak mendeteksi manusia sama sekali untuk {action_type}. "
                f"Action ini harus melibatkan orang yang terlihat di foto."
            )

        if found_suspicious:
            result.add_penalty(
                "suspicious_objects_detected",
                0.15,
                f"YOLO mendeteksi objek mencurigakan {found_suspicious} untuk {action_type}. "
                f"Kemungkinan foto tidak di lokasi yang diklaim."
            )

    # ─────────────────────────────────────────────────────────────────────────
    # LAYER E: LLM CROSS-VALIDATOR (ANTHROPIC API)
    # ─────────────────────────────────────────────────────────────────────────
    def _llm_cross_validate(
        self,
        result:       ValidationResult,
        action_type:  str,
        urgency_level: str,
        effort_hours: float,
        people_helped: int,
        description:  str,
        image_bytes:  Optional[bytes] = None,
    ):
        """
        Gunakan Ollama VLM (LLaVA) untuk membaca description, meilihat foto evidence, dan menilai konsistensinya.
        
        Output: JSON verdict dengan skor 0-100 dan reasoning.
        """
        try:
            image_b64 = base64.b64encode(image_bytes).decode('utf-8') if image_bytes else None

            prompt = f"""Kamu adalah sistem deteksi penipuan AI bernama SATIN Vanguard.
Silakan lihat foto kejadian (jika dilampirkan) dan baca klaim kegiatan sosial berikut:

ACTION_TYPE: {action_type}
URGENCY: {urgency_level}
EFFORT_HOURS: {effort_hours}
PEOPLE_HELPED: {people_helped}
DESCRIPTION: "{description}"

Tugas utama: Deteksi apakah parameter yang diklaim logis, konsisten satu sama lain, dan KONSISTEN DENGAN FOTO (jika ada).
Jawab HANYA dalam format JSON tulen berikut, tidak boleh ada teks pengantar atau markdown block sama sekali:
{{
  "verdict": "consistent" | "suspicious" | "fabricated",
  "confidence": <integer 0-100>,
  "inconsistencies": ["list", "of", "specific", "issues"],
  "manipulation_type": null | "action_type_mismatch" | "people_inflated" | "effort_inflated" | "urgency_gamed" | "description_vague" | "multiple",
  "realistic_people_helped": <integer estimate>,
  "realistic_effort_hours": <float estimate>,
  "reasoning": "penjelasan logis"
}}

Contoh penipuan: "Bagi nasi 500 orang" tapi di foto cuma ada piring kotor kosong di meja.
Contoh jujur: Fotonya ada banyak relawan distribusi paket ke masyarakat, sesuai dengan deskripsinya."""

            payload = {
                "model": "llava",
                "prompt": prompt,
                "stream": False,
                "format": "json"
            }
            if image_b64:
                payload["images"] = [image_b64]

            logger.info("[LLM] Sending request to Ollama (llava)...")
            response = requests.post(_OLLAMA_ENDPOINT, json=payload, timeout=45)
            response.raise_for_status()

            raw = response.json().get("response", "").strip()
            # Clean JSON
            raw = re.sub(r"```json|```", "", raw).strip()

            import json
            data = json.loads(raw)
            verdict    = data.get("verdict", "consistent")
            confidence = data.get("confidence", 0)
            issues     = data.get("inconsistencies", [])
            manip_type = data.get("manipulation_type")
            reasoning  = data.get("reasoning", "")

            result.llm_verdict = verdict
            result.llm_reason  = reasoning

            logger.info(
                f"[LLM] verdict={verdict} confidence={confidence} manip={manip_type}"
            )

            if verdict == "fabricated" and confidence >= 70:
                result.hard_block(
                    f"LLM AI Audit mendeteksi kemungkinan FABRIKASI DATA: {reasoning}. "
                    f"Issues: {'; '.join(issues[:3])}"
                )
            elif verdict == "suspicious" and confidence >= 60:
                penalty = 0.10 + (confidence / 100.0) * 0.30
                result.add_penalty(
                    f"llm_suspicious_{manip_type or 'generic'}",
                    round(penalty, 2),
                    f"LLM AI Audit mencurigakan (conf={confidence}%): {reasoning}"
                )
            elif verdict == "suspicious":
                result.add_penalty(
                    "llm_mild_suspicion",
                    0.10,
                    f"LLM AI Audit sedikit ragu: {reasoning}"
                )

            # Suggest realistic values if available
            realistic_people = data.get("realistic_people_helped")
            realistic_effort = data.get("realistic_effort_hours")
            if realistic_people and realistic_people < people_helped * 0.5:
                logger.warning(
                    f"[LLM] Realistic people estimate ({realistic_people}) << claimed ({people_helped})"
                )

        except Exception as e:
            logger.warning(f"[LLM] Cross-validation failed: {e} — skipping LLM layer")

    # ─────────────────────────────────────────────────────────────────────────
    # CLAMP HELPERS (adjusted values untuk downstream)
    # ─────────────────────────────────────────────────────────────────────────
    def _clamp_effort(self, constraint: dict, effort_hours: float) -> float:
        max_h = constraint.get("max_effort_hours", 24)
        if effort_hours > max_h:
            logger.info(f"[ParamValidator] effort_hours clamped: {effort_hours:.1f} → {max_h:.1f}")
        return min(effort_hours, max_h)

    def _clamp_people(self, constraint: dict, people_helped: int) -> int:
        max_p = constraint.get("max_people_abs", 500)
        if people_helped > max_p:
            logger.info(f"[ParamValidator] people_helped clamped: {people_helped} → {max_p}")
        return min(people_helped, max_p)


# ═══════════════════════════════════════════════════════════════════════════════
# STANDALONE TEST
# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import json

    v = ParameterValidator()

    print("=" * 70)
    print("TEST 1: Skenario Penipuan — Pungut Sampah tapi klaim DISASTER_RELIEF CRITICAL")
    r = v.validate(
        action_type="DISASTER_RELIEF",
        urgency_level="CRITICAL",
        effort_hours=1.0,
        people_helped=5000,
        description="Saya membantu seorang nenek menyebrang jalan di dekat rumah saya.",
        detected_objects=["person"],
        person_count_yolo=2,
    )
    print(f"passed={r.passed} hard_blocked={r.hard_blocked}")
    print(f"block_reason: {r.block_reason}")
    print(f"total_penalty: {r.total_penalty:.2%}")
    print(f"warnings: {r.warnings}")
    print()

    print("=" * 70)
    print("TEST 2: Skenario Jujur — Food Distribution di camp pengungsi")
    r2 = v.validate(
        action_type="FOOD_DISTRIBUTION",
        urgency_level="HIGH",
        effort_hours=8.0,
        people_helped=150,
        description="Distribusi 150 paket nasi bungkus bersama tim relawan BNPB selama 8 jam di posko pengungsi banjir Bekasi.",
        detected_objects=["person", "bowl", "cup"],
        person_count_yolo=12,
    )
    print(f"passed={r2.passed} hard_blocked={r2.hard_blocked}")
    print(f"total_penalty: {r2.total_penalty:.2%}")
    print(f"warnings: {r2.warnings}")
    print()

    print("=" * 70)
    print("TEST 3: Parameter Inflation — 72 jam effort, 5000 orang, Education CRITICAL")
    r3 = v.validate(
        action_type="EDUCATION_SESSION",
        urgency_level="CRITICAL",
        effort_hours=72,
        people_helped=5000,
        description="Mengajar anak-anak membaca.",
        detected_objects=["person"],
        person_count_yolo=3,
    )
    print(f"passed={r3.passed} hard_blocked={r3.hard_blocked}")
    print(f"total_penalty: {r3.total_penalty:.2%}")
    print(f"warnings: {r3.warnings}")