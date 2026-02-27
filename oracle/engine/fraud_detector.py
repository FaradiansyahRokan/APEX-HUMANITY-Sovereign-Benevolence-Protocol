"""
APEX HUMANITY — SATIN Oracle: Fraud & Sybil Detection Module
=============================================================
v2.0.0 — Data Integrity Update

Layers of protection:
  1. Sybil / duplicate (SHA-256 + dHash perceptual)
  2. Per-address rate limiting
  3. EXIF metadata validation (timestamp staleness + GPS mismatch) [NEW]
  4. ELA — Error Level Analysis for Photoshop/edit detection   [NEW]

Production roadmap:
  - Replace in-memory stores with Redis + PostgreSQL
  - Add AI-generated image detection (fine-tuned ViT/CNNDetect model)
  - Integrate reverse-image-search API (Google Lens / TinEye)
  - Community validation DAO (smart contract voting)
"""

from __future__ import annotations

import hashlib
import io
import logging
import math
import os
import struct
import time
from collections import defaultdict
from typing import Optional

logger = logging.getLogger("satin.fraud")

# ── Configuration ──────────────────────────────────────────────────────────────
PHASH_THRESHOLD      = int(os.getenv("FRAUD_PHASH_THRESHOLD", "10"))
RATE_WINDOW_SEC      = int(os.getenv("FRAUD_RATE_WINDOW_SEC", "3600"))
MAX_SUBMITS_WINDOW   = int(os.getenv("FRAUD_MAX_SUBMITS_HOUR", "5"))
EXIF_MAX_AGE_HOURS   = int(os.getenv("FRAUD_EXIF_MAX_AGE_HOURS", "48"))  # foto > 48h lalu = penalty
GPS_MISMATCH_KM      = float(os.getenv("FRAUD_GPS_MISMATCH_KM", "50"))   # jarak > 50km = suspicious
ELA_THRESHOLD        = float(os.getenv("FRAUD_ELA_THRESHOLD", "35.0"))   # mean ELA > 35 = edited


# ── Persistent Stores (Redis) ──────────────────────────────────────────────────
import redis
import json

redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
try:
    redis_client.ping()
except redis.ConnectionError:
    pass


# ══════════════════════════════════════════════════════════════════════════════
#  EXIF UTILITIES
# ══════════════════════════════════════════════════════════════════════════════

def _dms_to_dd(dms_tuple, ref: str) -> float:
    """Convert EXIF DMS (degrees, minutes, seconds) to decimal degrees."""
    def _as_float(v):
        if hasattr(v, "numerator"):           # IFDRational
            return float(v)
        if isinstance(v, (list, tuple)):
            return float(v[0]) / float(v[1]) if len(v) == 2 else float(v[0])
        return float(v)

    d = _as_float(dms_tuple[0])
    m = _as_float(dms_tuple[1])
    s = _as_float(dms_tuple[2])
    dd = d + m / 60.0 + s / 3600.0
    if ref in ("S", "W"):
        dd = -dd
    return dd


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two GPS points."""
    R = 6371.0
    p = math.pi / 180
    a = (
        math.sin((lat2 - lat1) * p / 2) ** 2
        + math.cos(lat1 * p) * math.cos(lat2 * p)
        * math.sin((lon2 - lon1) * p / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))


def _extract_exif(image_bytes: bytes) -> dict:
    """
    Extract useful EXIF fields from JPEG/HEIC image bytes.
    Returns dict with keys: has_exif, datetime_original, gps_lat, gps_lon
    """
    result = {"has_exif": False, "datetime_original": None, "gps_lat": None, "gps_lon": None}
    try:
        from PIL import Image
        from PIL.ExifTags import TAGS, GPSTAGS

        img  = Image.open(io.BytesIO(image_bytes))
        exif = img._getexif()
        if not exif:
            return result

        result["has_exif"] = True
        tag_map = {TAGS.get(k, k): v for k, v in exif.items()}

        # Datetime
        dt_str = tag_map.get("DateTimeOriginal") or tag_map.get("DateTime")
        if dt_str:
            result["datetime_original"] = dt_str  # format: "2024:03:15 08:32:11"

        # GPS
        gps_raw = tag_map.get("GPSInfo")
        if gps_raw:
            gps = {GPSTAGS.get(k, k): v for k, v in gps_raw.items()}
            try:
                lat = _dms_to_dd(gps["GPSLatitude"],  gps.get("GPSLatitudeRef",  "N"))
                lon = _dms_to_dd(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))
                result["gps_lat"] = lat
                result["gps_lon"] = lon
            except Exception:
                pass

    except Exception as e:
        logger.debug(f"EXIF extraction error: {e}")

    return result


# ══════════════════════════════════════════════════════════════════════════════
#  ELA — Error Level Analysis
# ══════════════════════════════════════════════════════════════════════════════

def _run_ela(image_bytes: bytes, quality: int = 75) -> dict:
    """
    Error Level Analysis: detect photo manipulation / Photoshop edits.

    Theory: When a JPEG is re-saved at lower quality, unedited areas converge
    quickly (small error). Edited areas retain high error because they were
    saved at a different quality level — creating bright spots on the ELA map.

    Returns:
        ela_score: float (mean pixel delta — higher = more suspicious)
        ela_max:   float (max delta — bright spots indicate local edits)
        verdict:   str
    """
    try:
        from PIL import Image, ImageChops, ImageEnhance
        import numpy as np

        orig = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Re-save at lower quality
        buf = io.BytesIO()
        orig.save(buf, "JPEG", quality=quality)
        buf.seek(0)
        recompressed = Image.open(buf).convert("RGB")

        # Pixel-level difference
        diff = ImageChops.difference(orig, recompressed)
        arr  = np.array(diff, dtype=np.float32)

        mean_ela = float(arr.mean())
        max_ela  = float(arr.max())

        if mean_ela < 15:
            verdict = "authentic"
        elif mean_ela < ELA_THRESHOLD:
            verdict = "possibly_edited"
        else:
            verdict = "suspicious"

        logger.info(f"[ELA] mean={mean_ela:.2f} max={max_ela:.2f} → {verdict}")
        return {"ela_score": round(mean_ela, 2), "ela_max": round(max_ela, 2), "verdict": verdict}

    except Exception as e:
        logger.warning(f"ELA analysis failed: {e}")
        return {"ela_score": 0.0, "ela_max": 0.0, "verdict": "unknown"}


# ══════════════════════════════════════════════════════════════════════════════
#  Perceptual Hashing (dHash) — unchanged
# ══════════════════════════════════════════════════════════════════════════════

def _dhash(image_bytes: bytes, hash_size: int = 16) -> str:
    try:
        from PIL import Image
        img  = Image.open(io.BytesIO(image_bytes)).convert("L")
        img  = img.resize((hash_size + 1, hash_size), Image.LANCZOS)
        px   = list(img.getdata())
        bits = 0
        for row in range(hash_size):
            for col in range(hash_size):
                left  = px[row * (hash_size + 1) + col]
                right = px[row * (hash_size + 1) + col + 1]
                bits  = (bits << 1) | (1 if left > right else 0)
        return format(bits, f"0{hash_size * hash_size // 4}x")
    except Exception as e:
        logger.warning(f"dHash failed: {e}")
        return ""


def _hamming_distance(h1: str, h2: str) -> int:
    try:
        return bin(int(h1, 16) ^ int(h2, 16)).count("1")
    except Exception:
        return 999


# ══════════════════════════════════════════════════════════════════════════════
#  FraudDetector — main class
# ══════════════════════════════════════════════════════════════════════════════

class FraudDetector:

    # ── Rate limiting ──────────────────────────────────────────────────────────
    def check_rate_limit(self, volunteer_address: str) -> dict:
        now = int(time.time())
        addr = volunteer_address.lower()
        window_start = now - RATE_WINDOW_SEC
        
        rk = f"satin:fraud:rate:{addr}"
        times_raw = redis_client.get(rk)
        times = json.loads(times_raw) if times_raw else []
        times = [t for t in times if t >= window_start]
        
        count = len(times)
        if count >= MAX_SUBMITS_WINDOW:
            wait = times[0] + RATE_WINDOW_SEC - now
            return {
                "ok":     False,
                "reason": f"Rate limit: max {MAX_SUBMITS_WINDOW} submissions "
                          f"per {RATE_WINDOW_SEC // 3600}h. Try again in {wait}s.",
            }
        
        # Save pruned list back
        if times:
            redis_client.set(rk, json.dumps(times))
        else:
            redis_client.delete(rk)
            
        return {"ok": True}

    def record_submission(self, volunteer_address: str) -> None:
        rk = f"satin:fraud:rate:{volunteer_address.lower()}"
        times_raw = redis_client.get(rk)
        times = json.loads(times_raw) if times_raw else []
        times.append(int(time.time()))
        redis_client.set(rk, json.dumps(times))

    # ── SHA-256 exact dedup ────────────────────────────────────────────────────
    def check_sha256(self, hash_sha256: str, volunteer_address: str) -> dict:
        key = hash_sha256.lower()
        first = redis_client.get(f"satin:fraud:sha256:{key}")
        if first:
            reason = (
                "Duplicate evidence: kamu sudah pernah submit file yang sama sebelumnya."
                if first == volunteer_address.lower()
                else "Duplicate evidence: file ini sudah pernah disubmit oleh volunteer lain."
            )
            return {"ok": False, "reason": reason}
        return {"ok": True}

    def record_sha256(self, hash_sha256: str, volunteer_address: str) -> None:
        key = hash_sha256.lower()
        redis_client.setnx(f"satin:fraud:sha256:{key}", volunteer_address.lower())

    # ── Perceptual hash near-dup ───────────────────────────────────────────────
    def check_image_phash(self, image_bytes: bytes, volunteer_address: str) -> dict:
        if not image_bytes:
            return {"ok": True}
        dh = _dhash(image_bytes)
        if not dh:
            return {"ok": True}
        now = int(time.time())
        window = now - (7 * 24 * 3600)
        
        seen_raw = redis_client.lrange("satin:fraud:phash", 0, -1)
        for item_raw in seen_raw:
            item = json.loads(item_raw)
            ph, pw, pt = item["h"], item["v"], item["t"]
            if pt < window:
                continue
            dist = _hamming_distance(dh, ph)
            if dist < PHASH_THRESHOLD and pw != volunteer_address.lower():
                return {
                    "ok":     False,
                    "reason": f"Near-duplicate image detected (visual similarity distance "
                              f"{dist} < threshold {PHASH_THRESHOLD}). Sybil attack blocked.",
                }
                
        # Record successful phash
        new_item = {"h": dh, "v": volunteer_address.lower(), "t": now}
        redis_client.lpush("satin:fraud:phash", json.dumps(new_item))
        redis_client.ltrim("satin:fraud:phash", 0, 9999)
        return {"ok": True}

    # ── Layer 3: EXIF Validation ───────────────────────────────────────────────
    def check_exif(
        self,
        image_bytes:    bytes,
        submit_lat:     float,
        submit_lon:     float,
        source:         str = "gallery",
    ) -> dict:
        """
        Validates EXIF metadata for:
          - Presence (no EXIF = likely AI-generated or screenshot)
          - Timestamp freshness (too old = possible reuse of old photo)
          - GPS proximity (EXIF GPS vs submitted GPS)

        Returns {"ok": True, "warnings": [...], "authenticity_penalty": float}
        """
        warnings  = []
        penalty   = 0.0

        if not image_bytes:
            return {"ok": True, "warnings": [], "authenticity_penalty": 0.0}

        # Live capture from in-app camera produces a canvas JPEG with no EXIF —
        # this is expected and should NOT be penalized.
        if source == "live_capture":
            logger.info("[EXIF] Skipping EXIF check for live_capture (canvas JPEG has no EXIF by design)")
            return {"ok": True, "warnings": [], "authenticity_penalty": 0.0}

        exif = _extract_exif(image_bytes)

        # No EXIF at all — likely screenshot, AI-gen, or WhatsApp-recompressed
        if not exif["has_exif"]:
            warnings.append("no_exif_metadata")
            penalty += 0.15  # 15% authenticity penalty
            logger.info("[EXIF] No EXIF found — possible AI/screenshot image")
        else:
            # Timestamp check
            dt_str = exif.get("datetime_original")
            if dt_str:
                try:
                    import datetime
                    dt = datetime.datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S")
                    age_hours = (datetime.datetime.now() - dt).total_seconds() / 3600
                    if age_hours > EXIF_MAX_AGE_HOURS:
                        warnings.append(f"photo_too_old_{int(age_hours)}h")
                        # Graduated penalty: 48h-168h = 15%, >168h (1 week) = 30%
                        penalty += 0.30 if age_hours > 168 else 0.15
                        logger.warning(f"[EXIF] Photo age: {age_hours:.1f}h (limit: {EXIF_MAX_AGE_HOURS}h)")
                except Exception:
                    pass

            # GPS proximity check
            exif_lat = exif.get("gps_lat")
            exif_lon = exif.get("gps_lon")
            if exif_lat is not None and exif_lon is not None and submit_lat and submit_lon:
                dist_km = _haversine_km(exif_lat, exif_lon, submit_lat, submit_lon)
                if dist_km > GPS_MISMATCH_KM:
                    warnings.append(f"gps_mismatch_{dist_km:.0f}km")
                    penalty += 0.25
                    logger.warning(
                        f"[EXIF] GPS mismatch: photo at ({exif_lat:.4f},{exif_lon:.4f}) "
                        f"vs submit at ({submit_lat:.4f},{submit_lon:.4f}) — {dist_km:.1f}km apart"
                    )

        # Live capture bonus: reduce penalty if from in-app camera
        if source == "live_capture":
            penalty = max(0.0, penalty - 0.10)
            logger.info("[EXIF] Live-capture bonus applied")

        return {
            "ok":                   True,   # EXIF issues → penalty only, not hard reject
            "warnings":             warnings,
            "authenticity_penalty": round(min(penalty, 0.50), 2),  # cap at 50%
        }

    # ── Layer 4: ELA Analysis ──────────────────────────────────────────────────
    def check_ela(self, image_bytes: bytes) -> dict:
        """
        Returns {"ok": True, "ela_score": float, "verdict": str, "penalty": float}
        """
        if not image_bytes:
            return {"ok": True, "ela_score": 0.0, "verdict": "no_image", "penalty": 0.0}

        result = _run_ela(image_bytes)
        ela    = result["ela_score"]

        if result["verdict"] == "suspicious":
            penalty = 0.30
        elif result["verdict"] == "possibly_edited":
            penalty = 0.10
        else:
            penalty = 0.0

        return {
            "ok":       True,
            "ela_score": ela,
            "verdict":   result["verdict"],
            "penalty":   penalty,
        }

    # ── Combined check ─────────────────────────────────────────────────────────
    def check_all(
        self,
        volunteer_address: str,
        hash_sha256:       str,
        image_bytes:       Optional[bytes],
        submit_lat:        float = 0.0,
        submit_lon:        float = 0.0,
        source:            str   = "gallery",
    ) -> dict:
        """
        Run all fraud checks.
        Returns: {
            "ok":                   bool,
            "reason":               str | None,   # only if ok=False (hard block)
            "warnings":             list[str],
            "authenticity_penalty": float,        # 0.0–1.0, reduces impact score
        }
        """
        all_warnings: list[str] = []
        total_penalty: float    = 0.0

        # 1. Rate limit (hard block)
        r = self.check_rate_limit(volunteer_address)
        if not r["ok"]:
            return {**r, "warnings": [], "authenticity_penalty": 0.0}

        # 2. SHA-256 exact dedup (hard block)
        if hash_sha256 and hash_sha256 not in ("0" * 64,):
            r = self.check_sha256(hash_sha256, volunteer_address)
            if not r["ok"]:
                return {**r, "warnings": [], "authenticity_penalty": 0.0}

        if image_bytes:
            # 3. Perceptual hash (hard block — Sybil)
            r = self.check_image_phash(image_bytes, volunteer_address)
            if not r["ok"]:
                return {**r, "warnings": [], "authenticity_penalty": 0.0}

            # 4. EXIF metadata (soft — penalty only)
            exif_r = self.check_exif(image_bytes, submit_lat, submit_lon, source)
            all_warnings.extend(exif_r["warnings"])
            total_penalty += exif_r["authenticity_penalty"]

            # 5. ELA analysis (soft — penalty only)
            ela_r = self.check_ela(image_bytes)
            if ela_r["verdict"] not in ("no_image", "authentic"):
                # Only flag when suspicious/possibly_edited — authentic is a pass, not a warning
                all_warnings.append(f"ela_{ela_r['verdict']}")
                total_penalty += ela_r["penalty"]

        return {
            "ok":                   True,
            "reason":               None,
            "warnings":             all_warnings,
            "authenticity_penalty": round(min(total_penalty, 0.60), 2),  # max 60% penalty
        }
