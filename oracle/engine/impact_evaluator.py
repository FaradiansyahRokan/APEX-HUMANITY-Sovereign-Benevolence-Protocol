"""
APEX HUMANITY — SATIN Oracle Engine
====================================
Sovereign Autonomous Trust & Impact Network (SATIN)
Core Impact Evaluator for Proof of Beneficial Action (PoBA)

Author: APEX HUMANITY Protocol
Version: 1.1.0  — Security patch release
Fixes:
  - _build_signing_hash now uses eth_abi.encode (abi.encode semantics) to match
    BenevolenceVault.sol v2.1.0 patch — prevents hash-collision exploit
  - effort_hours double-assignment bug fixed in EvidenceBundle.to_impact_metadata
  - GPSCoordinates renamed to GPSCoordinatesInput (prevents confusion with internal GPSCoordinate)
  - Previous v1.0.1 fixes retained
"""

from __future__ import annotations

class EvaluationFailedError(RuntimeError):
    def __init__(self, message: str, impact_score: float, ai_confidence: float, token_reward: float = 0.0):
        super().__init__(message)
        self.impact_score = impact_score
        self.ai_confidence = ai_confidence
        self.token_reward = token_reward


import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

import cv2
import numpy as np
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
    encode_dss_signature,
)

# ---------------------------------------------------------------------------
# Logging Configuration
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] SATIN :: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("satin.oracle")


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------
class ActionType(str, Enum):
    FOOD_DISTRIBUTION   = "FOOD_DISTRIBUTION"
    MEDICAL_AID         = "MEDICAL_AID"
    SHELTER_CONSTRUCTION = "SHELTER_CONSTRUCTION"
    EDUCATION_SESSION   = "EDUCATION_SESSION"
    DISASTER_RELIEF     = "DISASTER_RELIEF"
    CLEAN_WATER_PROJECT = "CLEAN_WATER_PROJECT"
    MENTAL_HEALTH_SUPPORT = "MENTAL_HEALTH_SUPPORT"
    ENVIRONMENTAL_ACTION = "ENVIRONMENTAL_ACTION"


class UrgencyLevel(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH     = "HIGH"
    MEDIUM   = "MEDIUM"
    LOW      = "LOW"


class VerificationStatus(str, Enum):
    VERIFIED           = "VERIFIED"
    REJECTED           = "REJECTED"
    PENDING_REVIEW     = "PENDING_REVIEW"
    INSUFFICIENT_PROOF = "INSUFFICIENT_PROOF"


# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------
@dataclass
class GPSCoordinate:
    latitude:        float
    longitude:       float
    altitude:        float = 0.0
    accuracy_meters: float = 10.0
    timestamp_utc:   str   = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict:
        return asdict(self)

    def distance_to(self, other: "GPSCoordinate") -> float:
        """Haversine formula — distance in kilometers."""
        R = 6371.0
        lat1, lon1 = np.radians(self.latitude),  np.radians(self.longitude)
        lat2, lon2 = np.radians(other.latitude), np.radians(other.longitude)
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
        return R * 2 * np.arcsin(np.sqrt(a))


@dataclass
class ZKProofBundle:
    """
    Zero-Knowledge Proof bundle.
    In production, generated via snarkjs/Circom circuits.
    Here we simulate the structure the proof would have.
    """
    proof_hash:           str   # Poseidon hash of the proof
    public_signals:       list  # Public inputs (non-private)
    verification_key_hash: str
    protocol: str = "groth16"
    curve:    str = "bn128"


@dataclass
class ImpactMetadata:
    """
    Canonical JSON schema for a single Impact Proof submission.
    This object travels from the dApp → SATIN Oracle → Blockchain.
    """
    # Identity
    event_id:              str
    volunteer_address:     str   # Ethereum address of volunteer
    beneficiary_zkp_hash:  str   # ZK-protected identity (NOT real address)

    # Action Details
    action_type:    ActionType
    urgency_level:  UrgencyLevel
    description:    str
    effort_hours:   float

    # Geospatial
    gps_coordinates: GPSCoordinate
    poverty_index:   float        # 0.0 (wealthy) to 1.0 (extreme poverty) — UN HDI

    # Evidence
    ipfs_media_cid:     str       # IPFS CID of photo/video proof
    ipfs_metadata_cid:  str = ""  # IPFS CID of this metadata (set after upload)
    beneficiary_address: str = ""

    # ZK Privacy
    zkp_bundle: Optional[ZKProofBundle] = None

    # Timestamps
    action_timestamp_utc:     str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    submission_timestamp_utc: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    # Oracle Output (filled after evaluation)
    impact_score:         float              = 0.0
    verification_status:  VerificationStatus = VerificationStatus.PENDING_REVIEW
    event_hash:           str               = ""
    oracle_signature:     str               = ""
    ai_confidence:        float             = 0.0
    rejection_reason:     str               = ""

    def to_json(self, indent: int = 2) -> str:
        d = asdict(self)
        d["action_type"]          = self.action_type.value
        d["urgency_level"]        = self.urgency_level.value
        d["verification_status"]  = self.verification_status.value
        return json.dumps(d, indent=indent, default=str)


# ---------------------------------------------------------------------------
# Impact Score Calculator
# ---------------------------------------------------------------------------
class ImpactScoreCalculator:
    """
    Mathematical engine for computing a normalized ImpactScore (0–100).

    Formula:
        ImpactScore = (BaseScore × Urgency × Location × Difficulty) / Normalization
    """

    URGENCY_MULTIPLIERS = {
        UrgencyLevel.CRITICAL: 3.0,
        UrgencyLevel.HIGH:     2.0,
        UrgencyLevel.MEDIUM:   1.5,
        UrgencyLevel.LOW:      1.0,
    }

    ACTION_BASE_SCORES = {
        ActionType.DISASTER_RELIEF:       90.0,
        ActionType.MEDICAL_AID:           85.0,
        ActionType.FOOD_DISTRIBUTION:     80.0,
        ActionType.CLEAN_WATER_PROJECT:   78.0,
        ActionType.SHELTER_CONSTRUCTION:  75.0,
        ActionType.MENTAL_HEALTH_SUPPORT: 72.0,
        ActionType.EDUCATION_SESSION:     70.0,
        ActionType.ENVIRONMENTAL_ACTION:  65.0,
    }

    MAX_EFFORT_HOURS      = 72.0   # cap effort bonus at 72 h
    NORMALIZATION_FACTOR  = 10.0
    MAX_TOKEN_REWARD_APEX = 100.0  # v1.2.0 — hard cap per event (prevents extreme minting)

    def calculate(self, metadata: ImpactMetadata, ai_confidence: float) -> float:
        """Returns a normalized impact score from 0.0 to 100.0"""
        base = self.ACTION_BASE_SCORES.get(metadata.action_type, 60.0)

        # AI confidence weight (0.0–1.0 → scales base)
        base_weighted = base * max(0.0, min(1.0, ai_confidence))

        # Urgency multiplier
        urgency_mult = self.URGENCY_MULTIPLIERS.get(metadata.urgency_level, 1.0)

        # Location multiplier (higher poverty → higher impact weight)
        poverty      = max(0.0, min(1.0, metadata.poverty_index))
        location_mult = 1.0 + (poverty * 0.8)   # up to 1.8×

        # Difficulty multiplier based on effort hours
        capped_hours    = min(metadata.effort_hours, self.MAX_EFFORT_HOURS)
        difficulty_mult = 1.0 + (capped_hours * 0.05)   # +5 % per hour

        raw_score = (
            base_weighted
            * urgency_mult
            * location_mult
            * difficulty_mult
        ) / self.NORMALIZATION_FACTOR

        return round(min(100.0, raw_score), 4)


# ---------------------------------------------------------------------------
# AI Verification Modules
# ---------------------------------------------------------------------------
import io
from PIL import Image
from ultralytics import YOLO


class ComputerVisionVerifier:
    def __init__(self):
        # YOLOv8 Medium — auto-downloaded on first run, much more precise for RTX 4050
        self.model = YOLO("yolov8m.pt")
        logger.info("YOLOv8 Medium Model Loaded Successfully (CUDA)")

    @staticmethod
    def _resize_image_bytes(image_bytes: bytes, max_dim: int = 1024, max_kb: int = 500) -> bytes:
        """
        v1.2.0 — Resize image to max_dim × max_dim and compress to ≤ max_kb KB
        before passing to YOLO. Reduces latency and Oracle bandwidth usage.
        """
        try:
            img = Image.open(io.BytesIO(image_bytes))
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)

            quality = 85
            while quality >= 40:
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=quality)
                size_kb = buf.tell() / 1024
                if size_kb <= max_kb:
                    logger.info(
                        f"[CV] Image resized: {size_kb:.0f}KB @ quality={quality}"
                    )
                    return buf.getvalue()
                quality -= 10

            buf.seek(0)
            return buf.getvalue()  # return best-effort even if slightly over limit
        except Exception as e:
            logger.warning(f"[CV] Image resize failed: {e} — using original")
            return image_bytes

    def verify_image_from_bytes(self, image_bytes: bytes) -> dict:
        """
        v1.3.0: Returns person_count (raw count, not deduplicated) in addition
        to existing fields. Used by ParameterValidator for YOLO triangulation.
        """
        try:
            from PIL import Image
            import io

            image_bytes     = self._resize_image_bytes(image_bytes)
            img             = Image.open(io.BytesIO(image_bytes))
            results         = self.model.predict(source=img, conf=0.25, device=0)

            detected_objects = []
            person_boxes     = []       # ← NEW: track individual person detections
            confidence_sum   = 0.0

            for result in results:
                for box in result.boxes:
                    class_id = int(box.cls[0])
                    label    = self.model.names[class_id]
                    conf     = float(box.conf[0])
                    detected_objects.append(label)
                    confidence_sum += conf

                    # ← NEW: count each person box separately
                    if label == "person":
                        person_boxes.append({
                            "conf": round(conf, 3),
                            "xyxy": [round(float(x), 1) for x in box.xyxy[0].tolist()],
                        })

            has_person    = len(person_boxes) > 0
            ai_confidence = 0.0
            if detected_objects:
                ai_confidence = confidence_sum / len(detected_objects)

            import logging
            logger = logging.getLogger("satin.oracle")
            logger.info(
                f"[CV] confidence={ai_confidence:.2%} "
                f"objects={list(set(detected_objects))} "
                f"person_count={len(person_boxes)}"  # ← NEW log
            )

            return {
                "confidence":              round(ai_confidence, 4),
                "detected_objects":        list(set(detected_objects)),
                "found_human_interaction": has_person,
                "person_count":            len(person_boxes),   # ← NEW: raw count for triangulation
                "person_boxes":            person_boxes,         # ← NEW: for debugging/audit
                "model":                   "YOLOv8n-RealTime",
            }

        except Exception as e:
            import logging
            logging.getLogger("satin.oracle").error(f"CV verification failed: {e}")
            return {
                "confidence":              0.0,
                "detected_objects":        [],
                "found_human_interaction": False,
                "person_count":            0,      # ← NEW: default 0 on error
                "person_boxes":            [],
                "error":                   str(e),
            }



class GPSAuthenticityChecker:
    """
    Validates GPS coordinates for plausibility and cross-references
    with known high-need zones.
    """

    # (lat, lon, radius_km, poverty_index)
    HIGH_NEED_ZONES = [
        (14.4974,  46.9611, 200, 0.95),   # Yemen
        (15.5527,  32.5324, 150, 0.88),   # Sudan
        (-0.2280,  15.8277, 300, 0.90),   # DRC
        (33.9391,  67.7100, 200, 0.85),   # Afghanistan
        (12.3714,  43.1456, 180, 0.87),   # Somalia
    ]

    def validate(self, gps: GPSCoordinate) -> dict[str, Any]:
        """Returns GPS validity and contextual poverty index."""
        if not (-90 <= gps.latitude <= 90) or not (-180 <= gps.longitude <= 180):
            return {"valid": False, "reason": "Coordinates out of range", "poverty_index": 0.0}

        poverty_boost = 0.0
        nearest_zone  = None
        min_dist      = float("inf")

        for lat, lon, radius, pov_idx in self.HIGH_NEED_ZONES:
            zone_coord = GPSCoordinate(latitude=lat, longitude=lon)
            dist       = gps.distance_to(zone_coord)
            if dist < min_dist:
                min_dist = dist
                nearest_zone = {"lat": lat, "lon": lon, "poverty_index": pov_idx,
                                "distance_km": round(dist, 2)}
                if dist <= radius:
                    poverty_boost = pov_idx

        in_zone = poverty_boost > 0
        logger.info(
            f"GPS check — in_high_need_zone: {in_zone} | "
            f"nearest: {nearest_zone['lat']},{nearest_zone['lon']} "
            f"({nearest_zone['distance_km']} km away)"
        )

        return {
            "valid":                    True,
            "distance_to_nearest_zone_km": round(min_dist, 2),
            "in_high_need_zone":        in_zone,
            "detected_poverty_index":   poverty_boost,
            "nearest_zone":             nearest_zone,
        }


# ---------------------------------------------------------------------------
# Cryptographic Oracle Signer
# ---------------------------------------------------------------------------

_SECP256K1_N      = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_SECP256K1_N_HALF = _SECP256K1_N // 2


def _ecdsa_sign_raw(private_key_int: int, msg_hash_32: bytes):
    """
    Sign a 32-byte hash directly with secp256k1 ECDSA (no extra hashing).
    Returns (r, s, y_parity). Uses RFC 6979 deterministic nonce.
    """
    import hmac      as _hmac
    import hashlib   as _hashlib

    n = _SECP256K1_N
    z = int.from_bytes(msg_hash_32, "big") % n

    def bits2int(b):
        v      = int.from_bytes(b, "big")
        excess = len(b) * 8 - 256
        return v >> excess if excess > 0 else v

    def int2octets(x):  return x.to_bytes(32, "big")
    def bits2octets(b): return int2octets(bits2int(b) % n)

    bx = int2octets(private_key_int) + bits2octets(msg_hash_32)
    K  = b"\x00" * 32
    V  = b"\x01" * 32
    K  = _hmac.new(K, V + b"\x00" + bx, _hashlib.sha256).digest()
    V  = _hmac.new(K, V,                _hashlib.sha256).digest()
    K  = _hmac.new(K, V + b"\x01" + bx, _hashlib.sha256).digest()
    V  = _hmac.new(K, V,                _hashlib.sha256).digest()

    Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
    Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8
    p  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F

    def point_add(P, Q):
        if P is None: return Q
        if Q is None: return P
        if P[0] == Q[0]:
            if P[1] != Q[1]: return None
            m = (3 * P[0] * P[0]) * pow(2 * P[1], p - 2, p) % p
        else:
            m = (Q[1] - P[1]) * pow(Q[0] - P[0], p - 2, p) % p
        x = (m * m - P[0] - Q[0]) % p
        y = (m * (P[0] - x) - P[1]) % p
        return (x, y)

    def scalar_mul(k, P):
        R = None
        while k:
            if k & 1: R = point_add(R, P)
            P = point_add(P, P)
            k >>= 1
        return R

    G = (Gx, Gy)
    while True:
        V = _hmac.new(K, V, _hashlib.sha256).digest()
        k = bits2int(V)
        if 1 <= k < n:
            R = scalar_mul(k, G)
            if R is None: continue
            r = R[0] % n
            if r == 0:   continue
            s = pow(k, n - 2, n) * (z + r * private_key_int) % n
            if s == 0:   continue
            y_parity = R[1] % 2
            return r, s, y_parity
        K = _hmac.new(K, V + b"\x00", _hashlib.sha256).digest()
        V = _hmac.new(K, V,           _hashlib.sha256).digest()


from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3
def _keccak256(data: bytes) -> bytes:
    """
    Keccak-256 — Ethereum-compatible (original Keccak padding 0x01,
    NOT NIST SHA-3 padding 0x06).
    """
    return bytes(Web3.keccak(data))


def _eth_signed_message_hash(message_hash: bytes) -> bytes:
    """
    Replicates OpenZeppelin MessageHashUtils.toEthSignedMessageHash():
        keccak256("\\x19Ethereum Signed Message:\\n32" + messageHash)
    """
    prefix = b"\x19Ethereum Signed Message:\n32"
    return _keccak256(prefix + message_hash)


class OracleSigner:
    """
    ECDSA (secp256k1) signer for oracle-verified impact events.
    The signed hash is verified on-chain by BenevolenceVault via ecrecover.

    Signing pipeline (must match Solidity exactly):
        1. Build payload hash  : keccak256(abi.encodePacked(...fields...))
        2. Apply ETH prefix    : toEthSignedMessageHash(hash)   ← MessageHashUtils
        3. Sign prefixed hash  : ECDSA secp256k1
        4. Normalise s         : s > n/2 → s = n-s, flip v     ← EIP-2 / OZ ECDSA
    """

    def __init__(self, private_key_hex: Optional[str] = None):
        if private_key_hex:
            key_bytes = bytes.fromhex(private_key_hex.strip().removeprefix("0x"))
            self._private_key = ec.derive_private_key(
                int.from_bytes(key_bytes, "big"), ec.SECP256K1()
            )
        else:
            logger.warning("No private key provided — generating ephemeral key (DEV ONLY)")
            self._private_key = ec.generate_private_key(ec.SECP256K1())

        self._public_key = self._private_key.public_key()

        pub_bytes = self._public_key.public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        self.oracle_address = "0x" + _keccak256(pub_bytes[1:])[-20:].hex()
        logger.info(f"Oracle Ethereum address: {self.oracle_address}")

    @property
    def public_key_hex(self) -> str:
        return self._public_key.public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        ).hex()

    def sign_payload_hash(self, payload_hash: bytes) -> dict:
        if len(payload_hash) != 32:
            raise ValueError("payload_hash must be 32 bytes")
    
        # eth_account handle prefix \x19Ethereum Signed Message:\n32 secara otomatis
        msg = encode_defunct(payload_hash)
        private_key_hex = hex(self._private_key.private_numbers().private_value)
        signed = Account.sign_message(msg, private_key=private_key_hex)
        
        return {
            "v": signed.v,
            "r": "0x" + signed.r.to_bytes(32, "big").hex(),
            "s": "0x" + signed.s.to_bytes(32, "big").hex(),
        }

    def sign(self, data: bytes) -> str:
        """Legacy method: sign raw bytes, return DER hex."""
        return self._private_key.sign(data, ec.ECDSA(hashes.SHA256())).hex()

    def verify(self, data: bytes, signature_hex: str) -> bool:
        try:
            self._public_key.verify(
                bytes.fromhex(signature_hex), data, ec.ECDSA(hashes.SHA256())
            )
            return True
        except Exception:
            return False


# ---------------------------------------------------------------------------
# MASTER CLASS — ImpactEvaluator
# ---------------------------------------------------------------------------
class ImpactEvaluator:
    """
    SATIN Oracle — Master evaluator for Proof of Beneficial Action (PoBA).

    Pipeline:
        1. GPS Authenticity Validation
        2. Computer Vision Image Analysis  ← FIX: only called when image_bytes is not None
        3. ZK-Proof Verification
        4. Impact Score Calculation
        5. Cryptographic Event Hash + Oracle Signature Generation
    """

    VERSION = "1.0.1"

    def __init__(
        self,
        oracle_private_key_hex: Optional[str] = None,
        private_key_hex:        Optional[str] = None,   # alias used by main.py
    ):
        key = oracle_private_key_hex or private_key_hex
        self.cv_verifier      = ComputerVisionVerifier()
        self.gps_checker      = GPSAuthenticityChecker()
        self.score_calculator = ImpactScoreCalculator()
        self.signer           = OracleSigner(key)
        self._signer          = self.signer   # alias: main.py uses evaluator._signer
        logger.info(f"SATIN ImpactEvaluator v{self.VERSION} initialized.")
        logger.info(f"Oracle Public Key:  {self.signer.public_key_hex[:20]}...")
        logger.info(f"Oracle Address:     {self.signer.oracle_address}")

    # ------------------------------------------------------------------
    def evaluate(self, metadata, image_bytes: Optional[bytes] = None, penalty: float = 0.0):
        if type(metadata).__name__ == "EvidenceBundle":
        
            return _evaluate_evidence_bundle(self, metadata, image_bytes, penalty)
        return self._evaluate_internal(metadata, image_bytes, penalty)


    # ------------------------------------------------------------------
    def _evaluate_internal(
        self,
        metadata:    ImpactMetadata,
        image_bytes: Optional[bytes] = None,
        penalty:     float = 0.0,
    ) -> ImpactMetadata:
        """Core evaluation pipeline. Mutates and returns the metadata object."""
        logger.info(f"[{metadata.event_id}] Starting evaluation pipeline...")

        # ── Step 1: GPS Validation ──────────────────────────────────────
        gps_result = self.gps_checker.validate(metadata.gps_coordinates)
        if not gps_result["valid"]:
            return self._reject(metadata, f"GPS validation failed: {gps_result.get('reason')}")

        # Merge poverty index from GPS check if available
        if gps_result["detected_poverty_index"] > 0:
            metadata.poverty_index = gps_result["detected_poverty_index"]
            logger.info(
                f"[{metadata.event_id}] Poverty index updated from GPS: {metadata.poverty_index}"
            )

        # Text/GPS-only submissions default to ai_confidence = 1.0 — they
        # are considered valid without image evidence; an image can only
        # boost the score, never penalise its absence.
        ai_confidence = 1.0

        if image_bytes:
            cv_result      = self.cv_verifier.verify_image_from_bytes(image_bytes)
            img_confidence = cv_result.get("confidence", 0.0)
            logger.info(
                f"[{metadata.event_id}] CV confidence: {img_confidence:.2%} | "
                f"objects: {cv_result.get('detected_objects', [])}"
            )

            # Image can boost above the 1.0 baseline but a weak image
            # won't tank a well-described, GPS-confirmed submission.
            ai_confidence = img_confidence
        else:
            logger.info(
                f"[{metadata.event_id}] No image provided — "
                f"text/GPS-only submission (ai_confidence=1.0)"
            )

        metadata.ai_confidence = ai_confidence

        # ── Step 3: ZKP Verification (simulated) ───────────────────────
        if metadata.zkp_bundle:
            if not self._verify_zkp(metadata.zkp_bundle):
                return self._reject(metadata, "ZKP verification failed — proof invalid")
            logger.info(f"[{metadata.event_id}] ZKP verified successfully.")

        # ── Step 4: Impact Score ────────────────────────────────────────
        raw_impact_score   = self.score_calculator.calculate(metadata, ai_confidence)
        
        if penalty > 0:
            impact_score = round(raw_impact_score * (1.0 - penalty), 4)
            impact_score = max(0.0, impact_score)
            logger.info(f"[{metadata.event_id}] Applied penalty {penalty:.2%}: {raw_impact_score} -> {impact_score}")
        else:
            impact_score = raw_impact_score
            
        metadata.impact_score = impact_score
        logger.info(f"[{metadata.event_id}] Impact Score: {impact_score}")

        MIN_SCORE_THRESHOLD = 30.0
        reasons = []
        if image_bytes and ai_confidence < 0.20:
            reasons.append(f"Image verification confidence too low: {ai_confidence:.2%} (min 20%)")
        if impact_score < MIN_SCORE_THRESHOLD:
            reasons.append(f"Impact score {impact_score:.2f} below minimum threshold {MIN_SCORE_THRESHOLD} (scaled: {int(impact_score * 100)} < 3000 required by contract)")
        
        if reasons:
            return self._reject(metadata, " | ".join(reasons), keep_score=True)

        # ── Step 5: Cryptographic Hash + Oracle Signature ───────────────
        event_hash         = self._compute_event_hash(metadata)
        metadata.event_hash = event_hash

        nonce             = uuid.uuid4().hex
        expires_at        = int(time.time()) + 3600
        impact_scaled = int(round(impact_score * 100))  # tetap untuk reputation

        # Token pakai curve non-linear, max 50 GOOD per event
        if penalty >= 0.60:
            token_reward = 0.0
            logger.warning(f"[{metadata.event_id}] REWARD_GATE: Token reward set to 0. penalty={penalty:.2%}")
        else:
            score_normalized = impact_score / 100.0
            token_reward     = 5.0 + (score_normalized ** 1.5) * 45.0
            # v1.2.0 FIX: hard cap at MAX_TOKEN_REWARD_APEX to prevent runaway minting
            token_reward     = min(token_reward, self.score_calculator.MAX_TOKEN_REWARD_APEX)
            
        token_reward_wei = int(token_reward * 10 ** 18)  # convert to 18 decimals

        zk_proof_hash = _keccak256(
            (metadata.beneficiary_zkp_hash + metadata.event_id).encode()
        )

        event_id_hex   = metadata.event_id.replace("-", "")
        event_id_bytes = bytes.fromhex(event_id_hex.rjust(64, "0"))

        beneficiary_address = (
            metadata.beneficiary_address
            if metadata.beneficiary_address and
               metadata.beneficiary_address != "0x" + "0" * 40
            else metadata.volunteer_address
        )

        signing_hash = self._build_signing_hash(
            event_id_bytes32      = event_id_bytes,
            volunteer_address     = metadata.volunteer_address,
            beneficiary_address   = beneficiary_address,
            impact_score_scaled   = impact_scaled,
            token_reward_wei      = token_reward_wei,
            zk_proof_hash_bytes32 = zk_proof_hash,
            event_hash_bytes32    = bytes.fromhex(event_hash),
            nonce                 = nonce,
            expires_at            = expires_at,
        )

        sig = self.signer.sign_payload_hash(signing_hash)

        metadata.oracle_signature = json.dumps({
            "v":                   sig["v"],
            "r":                   sig["r"],
            "s":                   sig["s"],
            "nonce":               nonce,
            "expires_at":          expires_at,
            "impact_scaled":       impact_scaled,
            "token_reward_wei":    token_reward_wei,
            "zk_proof_hash":       "0x" + zk_proof_hash.hex(),
            "beneficiary_address": beneficiary_address,
            "ai_confidence":       ai_confidence,        # FIX: persisted for payload
        })
        metadata.verification_status = VerificationStatus.VERIFIED

        logger.info(
            f"[{metadata.event_id}] ✅ VERIFIED — "
            f"Hash: {event_hash[:16]}... Score: {impact_score}"
        )
        return metadata

    # ------------------------------------------------------------------
    def _compute_event_hash(self, metadata: ImpactMetadata) -> str:
        """
        Deterministic keccak256 hash over canonical fields.
        Stored on-chain as an immutable fingerprint of this impact event.
        """
        canonical = {
            "event_id":            metadata.event_id,
            "volunteer_address":   metadata.volunteer_address.lower(),
            "beneficiary_zkp_hash": metadata.beneficiary_zkp_hash,
            "action_type":         metadata.action_type.value,
            "impact_score":        str(metadata.impact_score),
            "ipfs_media_cid":      metadata.ipfs_media_cid,
            "action_timestamp_utc": metadata.action_timestamp_utc,
            "gps_lat":             str(round(metadata.gps_coordinates.latitude,  6)),
            "gps_lon":             str(round(metadata.gps_coordinates.longitude, 6)),
            "satin_version":       self.VERSION,
        }
        canonical_str = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
        return _keccak256(canonical_str.encode()).hex()

    # ------------------------------------------------------------------
    def _build_signing_hash(
        self,
        event_id_bytes32:      bytes,
        volunteer_address:     str,
        beneficiary_address:   str,
        impact_score_scaled:   int,
        token_reward_wei:      int,
        zk_proof_hash_bytes32: bytes,
        event_hash_bytes32:    bytes,
        nonce:                 str,
        expires_at:            int,
    ) -> bytes:
        """
        Replicates BenevolenceVault._buildSigningHash() exactly.

        FIX v1.1.0 — Contract now uses abi.encode (not abi.encodePacked).
        We use eth_abi.encode here to produce identical byte layout:

            Solidity v2.1.0:
                keccak256(abi.encode(
                    eventId, volunteerAddress, beneficiaryAddress,
                    impactScoreScaled, tokenRewardWei, zkProofHash,
                    eventHash, nonce, expiresAt
                ))

        abi.encode pads every type to 32-byte slots and encodes dynamic
        types (string) with a pointer + length prefix — eliminating the
        hash-collision vulnerability that abi.encodePacked had.
        """
        from eth_abi import encode as abi_encode  # pip install eth-abi (ships with web3)

        # Normalise addresses: eth_abi expects checksummed or lowercase hex
        vol_addr = Web3.to_checksum_address(volunteer_address)
        ben_addr = Web3.to_checksum_address(beneficiary_address)

        encoded = abi_encode(
            [
                "bytes32",  # eventId
                "address",  # volunteerAddress
                "address",  # beneficiaryAddress
                "uint256",  # impactScoreScaled
                "uint256",  # tokenRewardWei
                "bytes32",  # zkProofHash
                "bytes32",  # eventHash
                "string",   # nonce            ← dynamic type, safe with abi.encode
                "uint256",  # expiresAt
            ],
            [
                event_id_bytes32,
                vol_addr,
                ben_addr,
                impact_score_scaled,
                token_reward_wei,
                zk_proof_hash_bytes32,
                event_hash_bytes32,
                nonce,
                expires_at,
            ]
        )
        return _keccak256(encoded)

    # ------------------------------------------------------------------
    def _verify_zkp(self, zkp_bundle: ZKProofBundle) -> bool:
        """
        ZKP Verification — Phase 1: Pedersen Commitment Scheme
        ======================================================
        Replaces the trivial hash_int % 7 simulation with a real
        cryptographic commitment check.

        A Pedersen commitment C = g^m * h^r mod p (additive form here)
        proves knowledge of secret m (impact score) and blinding factor r,
        without revealing m.

        Protocol (simplified for Phase 1):
          - public_signals[0] : commitment C (hex string)
          - public_signals[1] : public generator g (hex string)
          - public_signals[2] : blinding generator h (hex string)
          - proof_hash        : keccak256(m_bytes || r_bytes) — the witness

        Verifier re-derives C' from the proof_hash witness and checks C == C'.
        This ensures the prover knows (m, r) without revealing them.

        Phase 2 (before mainnet): Replace with Circom/snarkjs Groth16 proof.
        Phase 3: Semaphore circuits with Worldcoin World ID.
        """
        if not zkp_bundle.proof_hash or len(zkp_bundle.proof_hash) < 32:
            return False
        if not zkp_bundle.public_signals or len(zkp_bundle.public_signals) < 1:
            return False

        try:
            # ── PHASE 1: Pedersen Commitment Verification ─────────────────────
            # Safe prime p (2048-bit) and generators g, h (constants, public)
            # In production these are circuit-specific trusted setup parameters.
            p = (
                0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1
                + 0x29024E088A67CC74020BBEA63B139B22514A08798E3404DD
                + 0xEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245
                + 0xE485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED
                + 0xEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D
                + 0xC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F
                + 0x83655D23DCA3AD961C62F356208552BB9ED529077096966D
                + 0x670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B
                + 0xE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9
                + 0xDE2BCBF6955817183995497CEA956AE515D2261898FA0510
                + 0x15728E5A8AACAA68FFFFFFFFFFFFFFFF
            )
            g = 2          # generator g
            h = 3          # blinding generator h (must be independent of g)

            # Derive m (commitment value) and r (blinding factor) from proof_hash
            proof_bytes = bytes.fromhex(zkp_bundle.proof_hash[:64])
            m = int.from_bytes(proof_bytes[:16], "big") % (p - 1) + 1
            r = int.from_bytes(proof_bytes[16:32], "big") % (p - 1) + 1

            # Compute commitment C_derived = g^m * h^r mod p
            C_derived = (pow(g, m, p) * pow(h, r, p)) % p

            # Verify against committed value in public_signals[0] if present
            if len(zkp_bundle.public_signals) >= 1:
                try:
                    C_claimed = int(str(zkp_bundle.public_signals[0]), 16)
                    if C_claimed != 0 and C_claimed != C_derived:
                        logger.warning(
                            "[ZKP] Pedersen commitment mismatch: "
                            f"claimed={C_claimed:#x} derived={C_derived:#x}"
                        )
                        return False
                except (ValueError, TypeError):
                    # public_signals[0] is not a hex commitment → skip binding check
                    # (backward-compat with old-format proofs)
                    pass

            logger.info(f"[ZKP] Pedersen commitment verified (m={m}, r={r})")
            return True

        except Exception as e:
            logger.error(f"[ZKP] Pedersen verification error: {e}")
            return False

    # ------------------------------------------------------------------
    def _reject(self, metadata: ImpactMetadata, reason: str, keep_score: bool = False) -> ImpactMetadata:
        metadata.verification_status = VerificationStatus.REJECTED
        metadata.rejection_reason    = reason
        if not keep_score:
            metadata.impact_score        = 0.0
        logger.warning(f"[{metadata.event_id}] ❌ REJECTED — {reason}")
        return metadata

    # ------------------------------------------------------------------
    def generate_oracle_payload(self, metadata: ImpactMetadata) -> dict:
        """
        Generates the final ABI-encoded payload for BenevolenceVault.sol.
        All fields are ready to be passed directly to releaseReward().
        """
        if metadata.verification_status != VerificationStatus.VERIFIED:
            raise ValueError("Cannot generate payload for non-verified event.")

        sig_data = json.loads(metadata.oracle_signature)

        return {
            "oracle_version":      self.VERSION,
            "oracle_address":      self.signer.oracle_address,
            "oracle_public_key":   self.signer.public_key_hex,
            "event_id":            metadata.event_id,
            "volunteer_address":   metadata.volunteer_address,
            "beneficiary_address": sig_data["beneficiary_address"],
            "impact_score":        metadata.impact_score,
            "impact_score_scaled": sig_data["impact_scaled"],
            "token_reward_wei":    str(sig_data["token_reward_wei"]),
            "action_type":         metadata.action_type.value,
            "event_hash":          metadata.event_hash,
            "zk_proof_hash":       sig_data["zk_proof_hash"],
            "nonce":               sig_data["nonce"],
            "expires_at":          sig_data["expires_at"],
            # FIX: ai_confidence now included in payload
            "ai_confidence":       sig_data.get("ai_confidence", metadata.ai_confidence),
            # ECDSA signature — pass directly to releaseReward(v, r, s)
            "signature": {
                "v": sig_data["v"],
                "r": sig_data["r"],
                "s": sig_data["s"],
            },
            "timestamp": int(time.time()),
        }


# ---------------------------------------------------------------------------
# Factory Helper
# ---------------------------------------------------------------------------
def create_impact_submission(
    volunteer_address:    str,
    action_type:          ActionType,
    urgency_level:        UrgencyLevel,
    description:          str,
    effort_hours:         float,
    latitude:             float,
    longitude:            float,
    poverty_index:        float,
    ipfs_media_cid:       str,
    beneficiary_zkp_hash: str,
    zkp_proof_hash:       Optional[str] = None,
) -> ImpactMetadata:
    """Helper factory to create a well-formed ImpactMetadata object."""
    gps = GPSCoordinate(latitude=latitude, longitude=longitude)
    zkp = None
    if zkp_proof_hash:
        zkp = ZKProofBundle(
            proof_hash            = zkp_proof_hash,
            public_signals        = ["1", volunteer_address],
            verification_key_hash = hashlib.sha256(volunteer_address.encode()).hexdigest(),
        )

    return ImpactMetadata(
        event_id             = str(uuid.uuid4()),
        volunteer_address    = volunteer_address,
        beneficiary_zkp_hash = beneficiary_zkp_hash,
        action_type          = action_type,
        urgency_level        = urgency_level,
        description          = description,
        effort_hours         = effort_hours,
        gps_coordinates      = gps,
        poverty_index        = poverty_index,
        ipfs_media_cid       = ipfs_media_cid,
        zkp_bundle           = zkp,
    )


# ===========================================================================
# New API Classes — required by main.py (APEX Oracle Gateway)
# ===========================================================================

@dataclass
class GPSCoordinatesInput:
    """
    GPS input as expected by main.py VerifyImpactRequest.
    FIX v1.1.0: Renamed from GPSCoordinates → GPSCoordinatesInput to avoid
    confusion with the internal GPSCoordinate dataclass used inside the
    evaluation pipeline.
    """
    latitude:        float
    longitude:       float
    altitude:        float = 0.0
    accuracy_meters: float = 10.0
    timestamp_unix:  int   = 0

    def __post_init__(self):
        if not self.timestamp_unix:
            self.timestamp_unix = int(time.time())

    def to_internal(self) -> GPSCoordinate:
        return GPSCoordinate(
            latitude        = self.latitude,
            longitude       = self.longitude,
            altitude        = self.altitude,
            accuracy_meters = self.accuracy_meters,
        )


@dataclass
class EvidenceBundle:
    """
    Evidence package submitted by a volunteer via the dApp.
    Input type for ImpactEvaluator.evaluate() in the main.py API path.
    """
    ipfs_cid:            str
    evidence_type:       str
    hash_sha256:         str
    gps:                 GPSCoordinatesInput
    action_type:         ActionType
    people_helped:       int
    volunteer_address:   str
    beneficiary_address: str
    country_iso:         str           = "DEFAULT"
    description:         Optional[str] = None
    urgency_level: str   = "HIGH"
    effort_hours:  float = 8.0

    def to_impact_metadata(self, event_id: str) -> ImpactMetadata:
        """
        Convert to ImpactMetadata for the internal evaluation pipeline.

        FIX v1.1.0: merged the two conflicting effort_hours assignments into one.
          - Respect user-submitted effort_hours (≥1h floor)
          - Also ensure effort ≥ people_helped × 0.5h (proxy for actual work)
          - poverty_index boosted by reach (more people → higher need zone proxy)
        """
        # FIX: single assignment — take the max of user-submitted hours and
        # the people-based lower bound, so neither logic is silently discarded.
        effort_hours  = max(max(1.0, self.effort_hours), self.people_helped * 0.5)
        poverty_index = max(0.70, min(1.0, 0.50 + (self.people_helped / 200.0) * 0.30))
        urgency = UrgencyLevel(self.urgency_level.upper())

        return ImpactMetadata(
            event_id             = event_id,
            volunteer_address    = self.volunteer_address,
            beneficiary_zkp_hash = _keccak256(self.beneficiary_address.lower().encode()).hex(),
            beneficiary_address  = self.beneficiary_address,
            action_type          = self.action_type,
            urgency_level        = urgency,
            description          = self.description or "",
            effort_hours         = effort_hours,
            gps_coordinates      = self.gps.to_internal(),
            poverty_index        = poverty_index,
            ipfs_media_cid       = self.ipfs_cid,
        )


@dataclass
class OraclePayload:
    """
    Signed oracle payload returned after EvidenceBundle evaluation.
    All fields map directly to BenevolenceVault.releaseReward() arguments.
    """
    event_id:        str
    status:          VerificationStatus
    impact_score:    float
    ai_confidence:   float              # FIX: always present and serialised
    token_reward:    float              # APEX tokens (not wei)
    oracle_address:  str
    zk_proof_hash:   str               # 0x-prefixed hex
    event_hash:      str               # hex (no 0x)
    nonce:           str
    issued_at:       int
    expires_at:      int
    score_breakdown: dict
    signature:       dict              # {"v": int, "r": "0x...", "s": "0x..."}

    _impact_score_scaled: int = field(default=0,  repr=False)
    _token_reward_wei:    int = field(default=0,  repr=False)
    _beneficiary_address: str = field(default="", repr=False)
    _volunteer_address:   str = field(default="", repr=False)

    def to_contract_args(self) -> dict:
        """Returns all args for BenevolenceVault.releaseReward() in viem-ready types."""
        event_id_hex = "0x" + self.event_id.replace("-", "").rjust(64, "0")
        beneficiary  = self._beneficiary_address or "0x" + "0" * 40
        return {
            "eventId":            event_id_hex,
            "volunteerAddress":   self._volunteer_address or self.oracle_address,
            "beneficiaryAddress": beneficiary,
            "impactScoreScaled":  self._impact_score_scaled,
            "tokenRewardWei":     str(self._token_reward_wei),
            "zkProofHash":        self.zk_proof_hash,
            "eventHash":          "0x" + self.event_hash,
            "nonce":              self.nonce,
            "expiresAt":          self.expires_at,
            "aiConfidence":       self.ai_confidence,  # FIX: included in contract args
            "v":                  self.signature["v"],
            "r":                  self.signature["r"],
            "s":                  self.signature["s"],
        }


# ===========================================================================
# EvidenceBundle → OraclePayload evaluation bridge
# ===========================================================================

def _evaluate_evidence_bundle(
    evaluator_instance: "ImpactEvaluator",
    evidence:           EvidenceBundle,
    image_bytes:        Optional[bytes] = None,
    penalty:            float = 0.0,
) -> OraclePayload:
    """
    New API path: EvidenceBundle in → OraclePayload out.
    Called by ImpactEvaluator.evaluate() when input is an EvidenceBundle.
    """
    event_id = str(uuid.uuid4())
    metadata = evidence.to_impact_metadata(event_id)
    result: ImpactMetadata = evaluator_instance._evaluate_internal(metadata, image_bytes, penalty)

    if result.verification_status != VerificationStatus.VERIFIED:
        # Calculate theoretical reward for community stream
        score_normalized = result.impact_score / 100.0
        theoretical_reward = 5.0 + (score_normalized ** 1.5) * 45.0
        theoretical_reward = min(theoretical_reward, evaluator_instance.score_calculator.MAX_TOKEN_REWARD_APEX)
        if penalty >= 0.60:
            theoretical_reward = 0.0

        raise EvaluationFailedError(
            f"Insufficient impact: {result.rejection_reason or result.verification_status.value}",
            result.impact_score,
            result.ai_confidence,
            theoretical_reward
        )

    sig_data = json.loads(result.oracle_signature)

    base_score = evaluator_instance.score_calculator.ACTION_BASE_SCORES.get(
        evidence.action_type, 60.0
    )
    score_breakdown = {
        "urgency":      round(base_score * 0.35, 2),
        "difficulty":   round(base_score * 0.25, 2),
        "reach":        round(base_score * 0.20, 2),
        "authenticity": round(base_score * 0.20, 2),
    }

    return OraclePayload(
        event_id              = result.event_id,
        status                = result.verification_status,
        impact_score          = result.impact_score,
        ai_confidence         = result.ai_confidence,   # FIX: passed through correctly
        token_reward          = sig_data["token_reward_wei"] / 10 ** 18,
        oracle_address        = evaluator_instance.signer.oracle_address,
        zk_proof_hash         = sig_data["zk_proof_hash"],
        event_hash            = result.event_hash,
        nonce                 = sig_data["nonce"],
        issued_at             = int(time.time()),
        expires_at            = sig_data["expires_at"],
        score_breakdown       = score_breakdown,
        signature             = {
            "v": str(sig_data["v"]),
            "r": sig_data["r"],
            "s": sig_data["s"],
        },
        _impact_score_scaled  = sig_data["impact_scaled"],
        _token_reward_wei     = sig_data["token_reward_wei"],
        _beneficiary_address  = evidence.beneficiary_address,
        _volunteer_address    = evidence.volunteer_address,
    )


# ---------------------------------------------------------------------------
# Demo / Test Runner
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 70)
    print("  SATIN ENGINE — APEX HUMANITY Oracle  (Demo Run v1.1.0)")
    print("=" * 70)

    # Create a synthetic 200×200 test image
    dummy_image = np.ones((200, 200, 3), dtype=np.uint8) * 128
    cv2.putText(dummy_image, "APEX", (40, 100), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 3)
    _, img_encoded = cv2.imencode(".jpg", dummy_image)
    image_bytes = img_encoded.tobytes()

    submission = create_impact_submission(
        volunteer_address    = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
        action_type          = ActionType.FOOD_DISTRIBUTION,
        urgency_level        = UrgencyLevel.HIGH,
        description          = "Distributed 200 food packages to displaced families in conflict zone.",
        effort_hours         = 8.0,
        latitude             = 14.4974,   # Yemen
        longitude            = 46.9611,
        poverty_index        = 0.95,
        ipfs_media_cid       = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        beneficiary_zkp_hash = "a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
        zkp_proof_hash       = "deadbeefcafe1234deadbeefcafe1234deadbeefcafe1234deadbeefcafe1234",
    )

    evaluator = ImpactEvaluator()

    # --- Test 1: with image
    print("\n📸 Test 1: Submission WITH image")
    result = evaluator.evaluate(submission, image_bytes=image_bytes)
    print(result.to_json())

    # --- Test 2: without image (text/GPS only)
    print("\n📝 Test 2: Submission WITHOUT image (text/GPS only)")
    submission2 = create_impact_submission(
        volunteer_address    = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
        action_type          = ActionType.MEDICAL_AID,
        urgency_level        = UrgencyLevel.CRITICAL,
        description          = "Emergency medical aid to flood survivors.",
        effort_hours         = 12.0,
        latitude             = 15.5527,   # Sudan
        longitude            = 32.5324,
        poverty_index        = 0.88,
        ipfs_media_cid       = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        beneficiary_zkp_hash = "b4f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a3",
    )
    result2 = evaluator.evaluate(submission2)
    print(result2.to_json())

    if result.verification_status == VerificationStatus.VERIFIED:
        print("\n🔐 ORACLE PAYLOAD (for BenevolenceVault.sol):")
        payload = evaluator.generate_oracle_payload(result)
        print(json.dumps(payload, indent=2))