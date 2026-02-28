"""
APEX HUMANITY — SATIN Parameter Integrity Validator
====================================================
v2.0.0 — Autonomous AI Deduction (AAD) Architecture

PERUBAHAN FUNDAMENTAL:
  User TIDAK lagi mengisi slider atau memilih parameter.
  AI (YOLOv8m + LLaVA) yang MENYIMPULKAN semua parameter dari foto + deskripsi bebas.

  Validator ini sekarang bertugas:
  1. Menerima AI-deduced parameters dari main.py
  2. Cross-check konsistensi internal (deduced params vs foto evidence)
  3. Deteksi anomali pada output AI itu sendiri (hallucination guard)
  4. Tidak ada lagi validasi slider/user input — tidak ada slider untuk divalidasi
"""

from __future__ import annotations

import logging
import os
import re
import json
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("satin.param_validator")

import requests
import base64

_OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"
_LLM_AVAILABLE   = True


# ═══════════════════════════════════════════════════════════════════════════════
# AI DEDUCTION ENGINE — Core baru, menggantikan user input
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class AIDeductionResult:
    """
    Output dari LLaVA yang mendeduski semua parameter dari foto + deskripsi.
    Ini yang menggantikan slider user.
    """
    action_type:          str    = "FOOD_DISTRIBUTION"
    urgency_level:        str    = "MEDIUM"
    people_helped:        int    = 0
    effort_hours:         float  = 1.0
    scene_context:        str    = ""
    confidence:           float  = 0.0
    fraud_indicators:     list   = field(default_factory=list)
    reasoning:            str    = ""
    # Estimasi yang AI yakini realistis
    realistic_people_min: int    = 0
    realistic_people_max: int    = 0
    realistic_effort_min: float  = 0.0
    realistic_effort_max: float  = 0.0
    # Override dari YOLO
    yolo_person_count:    int    = 0
    final_people_helped:  int    = 0   # reconciled value
    final_effort_hours:   float  = 1.0


def deduce_parameters_from_ai(
    description:    str,
    image_bytes:    Optional[bytes],
    yolo_result:    dict,
    source:         str = "gallery",
) -> AIDeductionResult:
    """
    CORE FUNCTION — LLaVA + YOLO menyimpulkan semua parameter.
    Tidak ada user input yang dipercaya untuk scoring.
    
    Pipeline:
      1. LLaVA membaca foto + deskripsi → deduce action_type, urgency, people, effort
      2. YOLO cross-check person count
      3. Reconcile: ambil nilai konservatif (cegah inflasi)
      4. Return AIDeductionResult yang siap dipakai langsung oleh evaluator
    """
    result = AIDeductionResult()
    
    yolo_person_count = yolo_result.get("person_count", 0)
    detected_objects  = yolo_result.get("detected_objects", [])
    result.yolo_person_count = yolo_person_count

    # ── LLaVA Vision-Language Deduction ───────────────────────────────────────
    if _LLM_AVAILABLE:
        try:
            image_b64 = base64.b64encode(image_bytes).decode("utf-8") if image_bytes else None
            
            yolo_context = f"""
YOLO Computer Vision mendeteksi:
- Jumlah orang di foto: {yolo_person_count}
- Objek yang terdeteksi: {detected_objects}
"""
            prompt = f"""Kamu adalah sistem AI analisis dampak sosial bernama SATIN Vision.
Tugasmu adalah menganalisis foto kegiatan sosial dan mendeduski parameter objektif dari visual dan deskripsi.

DESKRIPSI DARI RELAWAN: "{description}"

{yolo_context if image_bytes else ""}

Tugas: Analisis secara objektif dan deduksi parameter berikut HANYA dari bukti visual dan deskripsi.
JANGAN percaya klaim angka dari user — simpulkan sendiri dari yang kamu lihat dan baca.

Jawab HANYA dalam JSON murni (tanpa markdown, tanpa penjelasan di luar JSON):
{{
  "action_type": "FOOD_DISTRIBUTION|MEDICAL_AID|SHELTER_CONSTRUCTION|EDUCATION_SESSION|DISASTER_RELIEF|CLEAN_WATER_PROJECT|MENTAL_HEALTH_SUPPORT|ENVIRONMENTAL_ACTION",
  "urgency_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "scene_context": "deskripsi singkat situasi yang kamu lihat di foto (max 50 kata)",
  "people_helped_estimate": {{
    "visible_in_photo": <integer dari foto>,
    "realistic_min": <integer minimum realistis berdasarkan skala kegiatan>,
    "realistic_max": <integer maximum realistis>,
    "best_estimate": <integer — nilaimu yang paling masuk akal>
  }},
  "effort_hours_estimate": {{
    "realistic_min": <float jam minimum>,
    "realistic_max": <float jam maximum>,
    "best_estimate": <float — nilaimu yang paling masuk akal>
  }},
  "confidence": <integer 0-100>,
  "fraud_indicators": ["list hal mencurigakan jika ada, kosong jika bersih"],
  "reasoning": "penjelasan singkat deduksimu"
}}

Contoh:
- Jika foto ada 3 orang tapi konteks dapur umum besar → people bisa 50-200
- Jika foto cuma selfie + caption "membantu 1000 orang" → estimate 1-5
- Kegiatan pembagian nasi di tenda → FOOD_DISTRIBUTION HIGH
- Foto indoor biasa tanpa konteks bencana → jangan klaim DISASTER_RELIEF CRITICAL"""

            payload = {
                "model":  "llava",
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "keep_alive": "1h",
                "options": {
                    "num_ctx":     2048,
                    "num_predict": 600,
                    "temperature": 0.05,
                }
            }
            if image_b64:
                payload["images"] = [image_b64]

            logger.info("[AAD] Sending deduction request to LLaVA...")
            resp = requests.post(_OLLAMA_ENDPOINT, json=payload, timeout=120)
            resp.raise_for_status()
            
            raw = resp.json().get("response", "").strip()
            
            # Robust JSON extraction
            match = re.search(r'\{.*\}', raw, re.DOTALL)
            if match:
                data = json.loads(match.group(0))
            else:
                data = json.loads(raw)

            # Parse LLaVA output
            result.action_type    = data.get("action_type", "FOOD_DISTRIBUTION")
            result.urgency_level  = data.get("urgency_level", "MEDIUM")
            result.scene_context  = data.get("scene_context", "")
            result.confidence     = data.get("confidence", 50) / 100.0
            result.fraud_indicators = data.get("fraud_indicators", [])
            result.reasoning      = data.get("reasoning", "")

            ph_est = data.get("people_helped_estimate", {})
            result.realistic_people_min = int(ph_est.get("realistic_min", 1))
            result.realistic_people_max = int(ph_est.get("realistic_max", 10))
            result.people_helped = int(ph_est.get("best_estimate", 5))

            ef_est = data.get("effort_hours_estimate", {})
            result.realistic_effort_min = float(ef_est.get("realistic_min", 0.5))
            result.realistic_effort_max = float(ef_est.get("realistic_max", 4.0))
            result.effort_hours   = float(ef_est.get("best_estimate", 2.0))

            logger.info(
                f"[AAD] LLaVA deduced: action={result.action_type} urgency={result.urgency_level} "
                f"people={result.people_helped} effort={result.effort_hours}h conf={result.confidence:.0%}"
            )

        except Exception as e:
            logger.warning(f"[AAD] LLaVA deduction failed: {e} — using YOLO-only fallback")
            # Fallback: hanya pakai YOLO
            result.people_helped = max(1, yolo_person_count)
            result.confidence    = 0.30

    else:
        # Tanpa LLM — YOLO only, konservatif
        result.people_helped = max(1, yolo_person_count)
        result.confidence    = 0.20

    # ── YOLO Cross-Check & Reconciliation ─────────────────────────────────────
    # Rule: final value = min(AI_estimate, YOLO_plausible_max)
    # Mencegah LLaVA hallucinate angka tinggi yang tidak didukung foto
    
    if yolo_person_count > 0:
        # 1 orang di foto bisa mewakili max 20 orang di area sekitar (conservative)
        yolo_plausible_max = yolo_person_count * 20
        
        if result.people_helped > yolo_plausible_max:
            logger.warning(
                f"[AAD] YOLO cap applied: LLaVA said {result.people_helped} "
                f"but YOLO only sees {yolo_person_count} people "
                f"→ capped to {yolo_plausible_max}"
            )
            result.people_helped = yolo_plausible_max
            result.fraud_indicators.append("llava_people_estimate_exceeded_yolo_evidence")
    elif yolo_person_count == 0 and result.people_helped > 10:
        # Tidak ada orang di foto tapi AI estimate tinggi → suspicious
        result.people_helped = 3  # konservatif
        result.fraud_indicators.append("no_people_visible_conservative_estimate")
        logger.warning("[AAD] No people in photo — people_helped capped to 3")

    # Final reconciled values
    result.final_people_helped = max(1, result.people_helped)
    result.final_effort_hours  = max(0.5, result.effort_hours)

    logger.info(
        f"[AAD] Final deduced: people={result.final_people_helped} "
        f"effort={result.final_effort_hours}h "
        f"fraud_indicators={result.fraud_indicators}"
    )
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# VALIDATION RESULT (simplified — hanya validasi AI output, bukan user input)
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ValidationResult:
    passed:          bool
    hard_blocked:    bool       = False
    block_reason:    str        = ""
    penalties:       list       = field(default_factory=list)
    warnings:        list       = field(default_factory=list)
    total_penalty:   float      = 0.0
    llm_verdict:     Optional[str] = None
    llm_reason:      Optional[str] = None
    deduction:       Optional[AIDeductionResult] = None

    def add_penalty(self, code: str, amount: float, reason: str):
        self.penalties.append({"code": code, "amount": amount, "reason": reason})
        self.total_penalty = min(0.70, self.total_penalty + amount)
        self.warnings.append(code)
        logger.warning(f"[Validator] PENALTY +{amount:.0%} | {code}: {reason}")

    def hard_block(self, reason: str):
        self.hard_blocked = True
        self.passed       = False
        self.block_reason = reason
        logger.error(f"[Validator] HARD BLOCK: {reason}")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN VALIDATOR — Sekarang validasi AI output, bukan user input
# ═══════════════════════════════════════════════════════════════════════════════

class ParameterValidator:
    """
    v2.0.0 — Validates AI-deduced parameters (not user sliders).
    
    User tidak lagi punya slider. Validator ini cross-check:
    1. AI deduction confidence vs fraud indicators
    2. Scene context vs action type plausibility
    3. LLaVA output anomaly (hallucination detection)
    4. Hard limits fisik yang tidak bisa dilanggar siapapun
    """

    # Hard physical limits — bahkan AI tidak boleh melampaui ini
    PHYSICAL_LIMITS = {
        "FOOD_DISTRIBUTION":      {"max_people": 1000, "max_hours": 16},
        "MEDICAL_AID":            {"max_people": 200,  "max_hours": 24},
        "SHELTER_CONSTRUCTION":   {"max_people": 100,  "max_hours": 72},
        "EDUCATION_SESSION":      {"max_people": 300,  "max_hours": 10},
        "DISASTER_RELIEF":        {"max_people": 2000, "max_hours": 72},
        "CLEAN_WATER_PROJECT":    {"max_people": 500,  "max_hours": 48},
        "MENTAL_HEALTH_SUPPORT":  {"max_people": 50,   "max_hours": 12},
        "ENVIRONMENTAL_ACTION":   {"max_people": 1000, "max_hours": 16},
    }

    def __init__(self):
        logger.info("ParameterValidator v2.0.0 initialized — AAD mode (no user sliders)")

    def validate_ai_deduction(self, deduction: AIDeductionResult) -> ValidationResult:
        """
        Validate the AI-deduced parameters.
        Returns ValidationResult dengan penalty jika deduction tidak meyakinkan.
        """
        result = ValidationResult(passed=True, deduction=deduction)

        limits = self.PHYSICAL_LIMITS.get(deduction.action_type, {"max_people": 500, "max_hours": 24})

        # 1. Confidence check
        if deduction.confidence < 0.20:
            result.add_penalty(
                "low_ai_confidence", 0.40,
                f"AI confidence sangat rendah ({deduction.confidence:.0%}) — foto tidak informatif"
            )

        # 2. Fraud indicators dari LLaVA
        if len(deduction.fraud_indicators) >= 2:
            result.hard_block(
                f"AI mendeteksi multiple fraud indicators: {deduction.fraud_indicators}"
            )
            return result
        elif len(deduction.fraud_indicators) == 1:
            result.add_penalty(
                f"fraud_indicator_{deduction.fraud_indicators[0]}", 0.25,
                f"AI mendeteksi anomali: {deduction.fraud_indicators[0]}"
            )

        # 3. Physical limit check (hard cap AI output)
        if deduction.final_people_helped > limits["max_people"]:
            capped = limits["max_people"]
            logger.warning(f"[Validator] Physical cap: people {deduction.final_people_helped} → {capped}")
            deduction.final_people_helped = capped
            result.warnings.append("physical_cap_people_applied")

        if deduction.final_effort_hours > limits["max_hours"]:
            capped = limits["max_hours"]
            logger.warning(f"[Validator] Physical cap: effort {deduction.final_effort_hours} → {capped}")
            deduction.final_effort_hours = capped
            result.warnings.append("physical_cap_effort_applied")

        # 4. YOLO cross-check anomaly
        if "llava_people_estimate_exceeded_yolo_evidence" in deduction.fraud_indicators:
            result.add_penalty(
                "yolo_llava_mismatch", 0.20,
                "LLaVA estimate melebihi bukti visual YOLO — nilai diturunkan"
            )

        result.llm_verdict = "consistent" if not deduction.fraud_indicators else "suspicious"
        result.llm_reason  = deduction.reasoning

        return result

    # Legacy method — kept for backward compat, delegates to AI deduction
    def validate(
        self,
        action_type:       str,
        urgency_level:     str,
        effort_hours:      float,
        people_helped:     int,
        description:       str,
        detected_objects:  Optional[list] = None,
        person_count_yolo: Optional[int]  = None,
        image_bytes:       Optional[bytes] = None,
    ) -> ValidationResult:
        """
        Legacy interface. In v2.0 this is only called when AI deduction
        is not available (e.g., text-only submissions without image).
        """
        result = ValidationResult(passed=True)
        # Text-only: minimal validation, trust description
        if not image_bytes:
            result.llm_verdict = "text_only"
            return result
        
        # Should not reach here in normal AAD flow
        logger.warning("[Validator] Legacy validate() called — use validate_ai_deduction()")
        return result