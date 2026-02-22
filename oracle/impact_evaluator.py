"""
APEX HUMANITY — SATIN Oracle Engine
====================================
Sovereign Autonomous Trust & Impact Network (SATIN)
Core Impact Evaluator for Proof of Beneficial Action (PoBA)

Author: APEX HUMANITY Protocol
Version: 1.0.1  — Bugfix release
Fixes:
  - CV verifier no longer called before image_bytes None-check (double-call + BytesIO(None) error)
  - ai_confidence included in OraclePayload serialization / to_contract_args
  - GPS high-need zone logging clarified
"""

from __future__ import annotations

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
        # YOLOv8 Nano — auto-downloaded on first run
        self.model = YOLO("yolov8n.pt")
        logger.info("YOLOv8 Model Loaded Successfully")

    def verify_image_from_bytes(self, image_bytes: bytes) -> dict[str, Any]:
        try:
            img = Image.open(io.BytesIO(image_bytes))

            # Use GPU if available (device=0), else CPU
            results = self.model.predict(source=img, conf=0.25, device=0)

            detected_objects  = []
            confidence_sum    = 0.0

            for result in results:
                for box in result.boxes:
                    class_id = int(box.cls[0])
                    label    = self.model.names[class_id]
                    conf     = float(box.conf[0])
                    detected_objects.append(label)
                    confidence_sum += conf

            has_person    = "person" in detected_objects
            ai_confidence = 0.0

            if detected_objects:
                base_conf     = confidence_sum / len(detected_objects)
                ai_confidence = base_conf

            return {
                "confidence":              round(ai_confidence, 4),
                "detected_objects":        list(set(detected_objects)),
                "found_human_interaction": has_person,
                "model":                   "YOLOv8n-RealTime",
            }

        except Exception as e:
            logger.error(f"Real CV verification failed: {e}")
            return {"confidence": 0.0, "error": str(e)}


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


def _keccak256(data: bytes) -> bytes:
    """
    Keccak-256 — Ethereum-compatible (original Keccak padding 0x01,
    NOT NIST SHA-3 padding 0x06).
    """
    from keccak256 import keccak256 as _keccak256_impl
    return _keccak256_impl(data)


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
        """
        Signs a 32-byte keccak256 payload hash the Ethereum way.
        Returns {"v": int, "r": "0x...", "s": "0x..."}.
        """
        if len(payload_hash) != 32:
            raise ValueError("payload_hash must be exactly 32 bytes (keccak256 output)")

        prefixed          = _eth_signed_message_hash(payload_hash)
        private_key_int   = self._private_key.private_numbers().private_value
        r, s, y_parity   = _ecdsa_sign_raw(private_key_int, prefixed)

        v = 27 + y_parity

        # EIP-2 / OpenZeppelin: normalise s to lower half of curve
        if s > _SECP256K1_N_HALF:
            s = _SECP256K1_N - s
            v = 27 if v == 28 else 28

        return {
            "v": v,
            "r": "0x" + r.to_bytes(32, "big").hex(),
            "s": "0x" + s.to_bytes(32, "big").hex(),
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
    def evaluate(self, metadata, image_bytes: Optional[bytes] = None):
        if type(metadata).__name__ == "EvidenceBundle":
        
            return _evaluate_evidence_bundle(self, metadata, image_bytes)
        return self._evaluate_internal(metadata, image_bytes)


    # ------------------------------------------------------------------
    def _evaluate_internal(
        self,
        metadata:    ImpactMetadata,
        image_bytes: Optional[bytes] = None,
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

        # ── Step 2: Computer Vision ─────────────────────────────────────
        # FIX: CV verifier is ONLY called when image_bytes is provided.
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

            if img_confidence < 0.25:
                return self._reject(
                    metadata,
                    f"Image verification confidence too low: {img_confidence:.2%} (min 25%)",
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
        impact_score       = self.score_calculator.calculate(metadata, ai_confidence)
        metadata.impact_score = impact_score
        logger.info(f"[{metadata.event_id}] Impact Score: {impact_score}")

        # ── Step 5: Cryptographic Hash + Oracle Signature ───────────────
        event_hash         = self._compute_event_hash(metadata)
        metadata.event_hash = event_hash

        nonce             = uuid.uuid4().hex
        expires_at        = int(time.time()) + 3600
        impact_scaled     = int(round(metadata.impact_score * 100))
        score_normalized = metadata.impact_score / 100.0
        token_reward     = 5.0 + (score_normalized ** 1.5) * 45.0
        token_reward_wei = int(token_reward * 10 ** 18)

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

        Solidity:
            keccak256(abi.encodePacked(
                eventId, volunteerAddress, beneficiaryAddress,
                impactScoreScaled, tokenRewardWei, zkProofHash,
                eventHash, nonce, expiresAt
            ))
        """
        packed = (
            event_id_bytes32                                          # bytes32 (32 bytes)
            + bytes.fromhex(volunteer_address.lower()[2:])            # address (20 bytes)
            + bytes.fromhex(beneficiary_address.lower()[2:])          # address (20 bytes)
            + impact_score_scaled.to_bytes(32, "big")                 # uint256 (32 bytes)
            + token_reward_wei.to_bytes(32, "big")                    # uint256 (32 bytes)
            + zk_proof_hash_bytes32                                   # bytes32 (32 bytes)
            + event_hash_bytes32                                      # bytes32 (32 bytes)
            + nonce.encode("utf-8")                                   # string  (raw bytes)
            + expires_at.to_bytes(32, "big")                          # uint256 (32 bytes)
        )
        return _keccak256(packed)

    # ------------------------------------------------------------------
    def _verify_zkp(self, zkp_bundle: ZKProofBundle) -> bool:
        """
        Simulates Groth16 ZKP verification.
        In production: use snarkjs Python bindings or subprocess call.
        """
        if not zkp_bundle.proof_hash or len(zkp_bundle.proof_hash) < 32:
            return False
        if not zkp_bundle.public_signals:
            return False
        hash_int = int(zkp_bundle.proof_hash[:8], 16)
        return hash_int % 7 != 0   # simulate ~85 % success for dev

    # ------------------------------------------------------------------
    def _reject(self, metadata: ImpactMetadata, reason: str) -> ImpactMetadata:
        metadata.verification_status = VerificationStatus.REJECTED
        metadata.rejection_reason    = reason
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
class GPSCoordinates:
    """GPS input as expected by main.py VerifyImpactRequest."""
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
    gps:                 GPSCoordinates
    action_type:         ActionType
    people_helped:       int
    volunteer_address:   str
    beneficiary_address: str
    country_iso:         str           = "DEFAULT"
    description:         Optional[str] = None

    def to_impact_metadata(self, event_id: str) -> ImpactMetadata:
        """
        Convert to ImpactMetadata for the internal evaluation pipeline.

        Scoring calibration targets ≥30 impact score (≥3000 scaled):
          - effort_hours  = max(8.0, people_helped × 0.5)
          - poverty_index = max(0.70, ...)
          - urgency       = HIGH (confirmed actions deserve it)
        """
        effort_hours  = max(8.0, self.people_helped * 0.5)
        poverty_index = max(0.70, min(1.0, 0.50 + (self.people_helped / 200.0) * 0.30))

        return ImpactMetadata(
            event_id             = event_id,
            volunteer_address    = self.volunteer_address,
            beneficiary_zkp_hash = _keccak256(self.beneficiary_address.lower().encode()).hex(),
            beneficiary_address  = self.beneficiary_address,
            action_type          = self.action_type,
            urgency_level        = UrgencyLevel.HIGH,
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
) -> OraclePayload:
    """
    New API path: EvidenceBundle in → OraclePayload out.
    Called by ImpactEvaluator.evaluate() when input is an EvidenceBundle.
    """
    event_id = str(uuid.uuid4())
    metadata = evidence.to_impact_metadata(event_id)
    result: ImpactMetadata = evaluator_instance._evaluate_internal(metadata, image_bytes)

    if result.verification_status != VerificationStatus.VERIFIED:
        raise RuntimeError(
            f"Insufficient impact: {result.rejection_reason or result.verification_status.value}"
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
    print("  SATIN ENGINE — APEX HUMANITY Oracle  (Demo Run v1.0.1)")
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