"""
APEX HUMANITY — SATIN Oracle Engine
====================================
Sovereign Autonomous Trust & Impact Network (SATIN)
Core Impact Evaluator for Proof of Beneficial Action (PoBA)

Author: APEX HUMANITY Protocol
Version: 1.0.0
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
    FOOD_DISTRIBUTION = "FOOD_DISTRIBUTION"
    MEDICAL_AID = "MEDICAL_AID"
    SHELTER_CONSTRUCTION = "SHELTER_CONSTRUCTION"
    EDUCATION_SESSION = "EDUCATION_SESSION"
    DISASTER_RELIEF = "DISASTER_RELIEF"
    CLEAN_WATER_PROJECT = "CLEAN_WATER_PROJECT"
    MENTAL_HEALTH_SUPPORT = "MENTAL_HEALTH_SUPPORT"
    ENVIRONMENTAL_ACTION = "ENVIRONMENTAL_ACTION"


class UrgencyLevel(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class VerificationStatus(str, Enum):
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    PENDING_REVIEW = "PENDING_REVIEW"
    INSUFFICIENT_PROOF = "INSUFFICIENT_PROOF"


# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------
@dataclass
class GPSCoordinate:
    latitude: float
    longitude: float
    altitude: float = 0.0
    accuracy_meters: float = 10.0
    timestamp_utc: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict:
        return asdict(self)

    def distance_to(self, other: "GPSCoordinate") -> float:
        """Haversine formula — distance in kilometers."""
        R = 6371.0
        lat1, lon1 = np.radians(self.latitude), np.radians(self.longitude)
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
    proof_hash: str        # Poseidon hash of the proof
    public_signals: list   # Public inputs (non-private)
    verification_key_hash: str
    protocol: str = "groth16"
    curve: str = "bn128"


@dataclass
class ImpactMetadata:
    """
    Canonical JSON schema for a single Impact Proof submission.
    This object travels from the dApp → SATIN Oracle → Blockchain.
    """
    # Identity
    event_id: str
    volunteer_address: str       # Ethereum address of volunteer
    beneficiary_zkp_hash: str    # ZK-protected identity (NOT real address)

    # Action Details
    action_type: ActionType
    urgency_level: UrgencyLevel
    description: str
    effort_hours: float

    # Geospatial
    gps_coordinates: GPSCoordinate
    poverty_index: float         # 0.0 (wealthy) to 1.0 (extreme poverty) — UN HDI

    # Evidence
    ipfs_media_cid: str          # IPFS CID of photo/video proof
    ipfs_metadata_cid: str = ""  # IPFS CID of this metadata (set after upload)

    # ZK Privacy
    zkp_bundle: Optional[ZKProofBundle] = None

    # Timestamps
    action_timestamp_utc: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    submission_timestamp_utc: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    # Oracle Output (filled after evaluation)
    impact_score: float = 0.0
    verification_status: VerificationStatus = VerificationStatus.PENDING_REVIEW
    event_hash: str = ""
    oracle_signature: str = ""
    ai_confidence: float = 0.0
    rejection_reason: str = ""

    def to_json(self, indent: int = 2) -> str:
        d = asdict(self)
        d["action_type"] = self.action_type.value
        d["urgency_level"] = self.urgency_level.value
        d["verification_status"] = self.verification_status.value
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
        UrgencyLevel.HIGH: 2.0,
        UrgencyLevel.MEDIUM: 1.5,
        UrgencyLevel.LOW: 1.0,
    }

    ACTION_BASE_SCORES = {
        ActionType.DISASTER_RELIEF: 90.0,
        ActionType.MEDICAL_AID: 85.0,
        ActionType.FOOD_DISTRIBUTION: 80.0,
        ActionType.CLEAN_WATER_PROJECT: 78.0,
        ActionType.SHELTER_CONSTRUCTION: 75.0,
        ActionType.MENTAL_HEALTH_SUPPORT: 72.0,
        ActionType.EDUCATION_SESSION: 70.0,
        ActionType.ENVIRONMENTAL_ACTION: 65.0,
    }

    MAX_EFFORT_HOURS = 72.0   # cap effort bonus at 72h
    NORMALIZATION_FACTOR = 10.0

    def calculate(
        self,
        metadata: ImpactMetadata,
        ai_confidence: float,
    ) -> float:
        """
        Returns a normalized impact score from 0.0 to 100.0
        """
        base = self.ACTION_BASE_SCORES.get(metadata.action_type, 60.0)

        # AI confidence weight (0.0–1.0 → scales base)
        base_weighted = base * max(0.0, min(1.0, ai_confidence))

        # Urgency multiplier
        urgency_mult = self.URGENCY_MULTIPLIERS.get(metadata.urgency_level, 1.0)

        # Location multiplier (higher poverty → higher impact weight)
        poverty = max(0.0, min(1.0, metadata.poverty_index))
        location_mult = 1.0 + (poverty * 0.8)  # up to 1.8x

        # Difficulty multiplier based on effort hours
        capped_hours = min(metadata.effort_hours, self.MAX_EFFORT_HOURS)
        difficulty_mult = 1.0 + (capped_hours * 0.05)  # +5% per hour

        raw_score = (
            base_weighted
            * urgency_mult
            * location_mult
            * difficulty_mult
        ) / self.NORMALIZATION_FACTOR

        return round(min(100.0, raw_score), 4)


# ---------------------------------------------------------------------------
# AI Verification Modules (Simulated — Replace with Real Models)
# ---------------------------------------------------------------------------
class ComputerVisionVerifier:
    """
    Simulates OpenCV + YOLO object detection.
    In production: load YOLO weights, run inference on IPFS-fetched media.
    """

    # Object classes that indicate beneficial action
    POSITIVE_CLASSES = {
        "person", "food", "bottle", "cup", "bed", "chair",
        "book", "laptop", "medical", "tool", "tree", "plant",
    }

    def verify_image_from_bytes(self, image_bytes: bytes) -> dict[str, Any]:
        """
        Analyze image bytes for proof of beneficial action.
        Returns a confidence score and detected objects.
        """
        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return {"confidence": 0.0, "error": "Could not decode image"}

            # --- Simulated detection pipeline ---
            # In production: run YOLO inference here
            # detected_objects = yolo_model(img)

            # Heuristic: analyze image properties as simulation
            h, w = img.shape[:2]
            mean_brightness = img.mean()
            is_sharp = self._check_sharpness(img)
            has_people_heuristic = mean_brightness > 30 and h > 100 and w > 100

            confidence = 0.0
            if is_sharp:
                confidence += 0.4
            if has_people_heuristic:
                confidence += 0.4
            confidence += min(0.2, (h * w) / (1920 * 1080) * 0.2)

            return {
                "confidence": round(min(1.0, confidence), 4),
                "image_dimensions": {"width": w, "height": h},
                "is_sharp": is_sharp,
                "brightness": round(float(mean_brightness), 2),
                "simulated_objects": ["person", "food"],  # placeholder
            }

        except Exception as e:
            logger.error(f"CV verification failed: {e}")
            return {"confidence": 0.0, "error": str(e)}

    def _check_sharpness(self, img: np.ndarray) -> bool:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        return laplacian_var > 100.0  # threshold for acceptable sharpness


class GPSAuthenticityChecker:
    """
    Validates GPS coordinates for plausibility and cross-references with known high-need zones.
    """

    # Sample known high-need zones (lat, lon, radius_km, poverty_index)
    HIGH_NEED_ZONES = [
        (14.4974, 46.9611, 200, 0.95),   # Yemen
        (15.5527, 32.5324, 150, 0.88),   # Sudan
        (-0.2280, 15.8277, 300, 0.90),   # DRC
        (33.9391, 67.7100, 200, 0.85),   # Afghanistan
        (12.3714, 43.1456, 180, 0.87),   # Somalia
    ]

    def validate(self, gps: GPSCoordinate) -> dict[str, Any]:
        """Returns GPS validity and contextual poverty index."""
        if not (-90 <= gps.latitude <= 90) or not (-180 <= gps.longitude <= 180):
            return {"valid": False, "reason": "Coordinates out of range", "poverty_index": 0.0}

        # Check proximity to high-need zones
        poverty_boost = 0.0
        nearest_zone = None
        min_dist = float("inf")

        for lat, lon, radius, pov_idx in self.HIGH_NEED_ZONES:
            zone_coord = GPSCoordinate(latitude=lat, longitude=lon)
            dist = gps.distance_to(zone_coord)
            if dist < min_dist:
                min_dist = dist
                if dist <= radius:
                    poverty_boost = pov_idx
                    nearest_zone = {"lat": lat, "lon": lon, "poverty_index": pov_idx}

        return {
            "valid": True,
            "distance_to_nearest_zone_km": round(min_dist, 2),
            "in_high_need_zone": poverty_boost > 0,
            "detected_poverty_index": poverty_boost,
            "nearest_zone": nearest_zone,
        }


# ---------------------------------------------------------------------------
# Cryptographic Oracle Signer
# ---------------------------------------------------------------------------
class OracleSigner:
    """
    ECDSA (secp256k1) signer for oracle-verified impact events.
    The signed hash is verified on-chain by the BenevolenceVault contract.
    """

    def __init__(self, private_key_hex: Optional[str] = None):
        if private_key_hex:
            key_bytes = bytes.fromhex(private_key_hex)
            self._private_key = ec.derive_private_key(
                int.from_bytes(key_bytes, "big"), ec.SECP256K1()
            )
        else:
            logger.warning("No private key provided — generating ephemeral key (DEV ONLY)")
            self._private_key = ec.generate_private_key(ec.SECP256K1())

        self._public_key = self._private_key.public_key()

    @property
    def public_key_hex(self) -> str:
        pub_bytes = self._public_key.public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        return pub_bytes.hex()

    def sign(self, data: bytes) -> str:
        """Returns DER-encoded ECDSA signature as hex string."""
        signature = self._private_key.sign(data, ec.ECDSA(hashes.SHA256()))
        return signature.hex()

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
        2. Computer Vision Image Analysis
        3. ZK-Proof Verification
        4. Impact Score Calculation
        5. Cryptographic Event Hash + Oracle Signature Generation
    """

    VERSION = "1.0.0"

    def __init__(self, oracle_private_key_hex: Optional[str] = None):
        self.cv_verifier = ComputerVisionVerifier()
        self.gps_checker = GPSAuthenticityChecker()
        self.score_calculator = ImpactScoreCalculator()
        self.signer = OracleSigner(oracle_private_key_hex)
        logger.info(f"SATIN ImpactEvaluator v{self.VERSION} initialized.")
        logger.info(f"Oracle Public Key: {self.signer.public_key_hex[:20]}...")

    # ------------------------------------------------------------------
    def evaluate(
        self,
        metadata: ImpactMetadata,
        image_bytes: Optional[bytes] = None,
    ) -> ImpactMetadata:
        """
        Main evaluation pipeline. Mutates and returns the metadata object
        with all oracle outputs filled in.
        """
        logger.info(f"[{metadata.event_id}] Starting evaluation pipeline...")

        # ── Step 1: GPS Validation ─────────────────────────────────────
        gps_result = self.gps_checker.validate(metadata.gps_coordinates)
        if not gps_result["valid"]:
            return self._reject(metadata, f"GPS validation failed: {gps_result.get('reason')}")
        logger.info(f"[{metadata.event_id}] GPS valid. High-need zone: {gps_result['in_high_need_zone']}")

        # Merge poverty index from GPS check if more specific
        if gps_result["detected_poverty_index"] > 0:
            metadata.poverty_index = gps_result["detected_poverty_index"]

        # ── Step 2: Computer Vision ────────────────────────────────────
        ai_confidence = 0.5  # default when no image provided
        cv_result = {}
        if image_bytes:
            cv_result = self.cv_verifier.verify_image_from_bytes(image_bytes)
            ai_confidence = cv_result.get("confidence", 0.0)
            logger.info(f"[{metadata.event_id}] CV confidence: {ai_confidence:.2%}")

            if ai_confidence < 0.25:
                return self._reject(
                    metadata,
                    f"Image verification confidence too low: {ai_confidence:.2%} (min 25%)",
                )
        else:
            logger.warning(f"[{metadata.event_id}] No image provided — using default confidence")

        metadata.ai_confidence = ai_confidence

        # ── Step 3: ZKP Verification (simulated) ──────────────────────
        if metadata.zkp_bundle:
            zkp_valid = self._verify_zkp(metadata.zkp_bundle)
            if not zkp_valid:
                return self._reject(metadata, "ZKP verification failed — proof invalid")
            logger.info(f"[{metadata.event_id}] ZKP verified successfully.")

        # ── Step 4: Impact Score ───────────────────────────────────────
        impact_score = self.score_calculator.calculate(metadata, ai_confidence)
        metadata.impact_score = impact_score
        logger.info(f"[{metadata.event_id}] Impact Score: {impact_score}")

        # ── Step 5: Cryptographic Hash + Oracle Signature ──────────────
        event_hash = self._compute_event_hash(metadata)
        oracle_sig = self.signer.sign(bytes.fromhex(event_hash))

        metadata.event_hash = event_hash
        metadata.oracle_signature = oracle_sig
        metadata.verification_status = VerificationStatus.VERIFIED

        logger.info(f"[{metadata.event_id}] ✅ VERIFIED — Hash: {event_hash[:16]}... Score: {impact_score}")
        return metadata

    # ------------------------------------------------------------------
    def _compute_event_hash(self, metadata: ImpactMetadata) -> str:
        """
        Generates a deterministic SHA-256 hash over canonical fields.
        This hash is what gets signed and what the smart contract verifies.
        """
        canonical = {
            "event_id": metadata.event_id,
            "volunteer_address": metadata.volunteer_address.lower(),
            "beneficiary_zkp_hash": metadata.beneficiary_zkp_hash,
            "action_type": metadata.action_type.value,
            "impact_score": str(metadata.impact_score),
            "ipfs_media_cid": metadata.ipfs_media_cid,
            "action_timestamp_utc": metadata.action_timestamp_utc,
            "gps_lat": str(round(metadata.gps_coordinates.latitude, 6)),
            "gps_lon": str(round(metadata.gps_coordinates.longitude, 6)),
            "satin_version": self.VERSION,
        }
        canonical_str = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical_str.encode()).hexdigest()

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
        # Simulate: check proof_hash entropy
        hash_int = int(zkp_bundle.proof_hash[:8], 16)
        return hash_int % 7 != 0  # simulate ~85% success for dev

    # ------------------------------------------------------------------
    def _reject(self, metadata: ImpactMetadata, reason: str) -> ImpactMetadata:
        metadata.verification_status = VerificationStatus.REJECTED
        metadata.rejection_reason = reason
        metadata.impact_score = 0.0
        logger.warning(f"[{metadata.event_id}] ❌ REJECTED — {reason}")
        return metadata

    # ------------------------------------------------------------------
    def generate_oracle_payload(self, metadata: ImpactMetadata) -> dict:
        """
        Generates the final ABI-encoded payload for the BenevolenceVault contract.
        """
        if metadata.verification_status != VerificationStatus.VERIFIED:
            raise ValueError("Cannot generate payload for non-verified event.")

        return {
            "oracle_version": self.VERSION,
            "oracle_public_key": self.signer.public_key_hex,
            "event_id": metadata.event_id,
            "volunteer_address": metadata.volunteer_address,
            "beneficiary_zkp_hash": metadata.beneficiary_zkp_hash,
            "impact_score": metadata.impact_score,
            "action_type": metadata.action_type.value,
            "event_hash": metadata.event_hash,
            "oracle_signature": metadata.oracle_signature,
            "timestamp": int(time.time()),
            # ABI encoding hint for Solidity verifyOracle()
            "abi_encoded_message": self._abi_encode_message(metadata),
        }

    def _abi_encode_message(self, metadata: ImpactMetadata) -> str:
        """
        Produces eth_sign compatible packed encoding.
        Mirrors the abi.encodePacked() in the Solidity contract.
        """
        packed = (
            bytes.fromhex(metadata.event_hash)
            + bytes.fromhex(metadata.volunteer_address[2:].zfill(40))
            + bytes.fromhex(metadata.beneficiary_zkp_hash[:64].zfill(64))
            + int(metadata.impact_score * 100).to_bytes(32, "big")
        )
        return "0x" + packed.hex()


# ---------------------------------------------------------------------------
# Factory Helper
# ---------------------------------------------------------------------------
def create_impact_submission(
    volunteer_address: str,
    action_type: ActionType,
    urgency_level: UrgencyLevel,
    description: str,
    effort_hours: float,
    latitude: float,
    longitude: float,
    poverty_index: float,
    ipfs_media_cid: str,
    beneficiary_zkp_hash: str,
    zkp_proof_hash: Optional[str] = None,
) -> ImpactMetadata:
    """
    Helper factory to create a well-formed ImpactMetadata object.
    """
    gps = GPSCoordinate(latitude=latitude, longitude=longitude)
    zkp = None
    if zkp_proof_hash:
        zkp = ZKProofBundle(
            proof_hash=zkp_proof_hash,
            public_signals=["1", volunteer_address],
            verification_key_hash=hashlib.sha256(volunteer_address.encode()).hexdigest(),
        )

    return ImpactMetadata(
        event_id=str(uuid.uuid4()),
        volunteer_address=volunteer_address,
        beneficiary_zkp_hash=beneficiary_zkp_hash,
        action_type=action_type,
        urgency_level=urgency_level,
        description=description,
        effort_hours=effort_hours,
        gps_coordinates=gps,
        poverty_index=poverty_index,
        ipfs_media_cid=ipfs_media_cid,
        zkp_bundle=zkp,
    )


# ---------------------------------------------------------------------------
# Demo / Test Runner
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 70)
    print("  SATIN ENGINE — APEX HUMANITY Oracle  (Demo Run)")
    print("=" * 70)

    # Create a synthetic 200×200 test image (simulates uploaded photo)
    dummy_image = np.ones((200, 200, 3), dtype=np.uint8) * 128
    cv2.putText(dummy_image, "APEX", (40, 100), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 3)
    _, img_encoded = cv2.imencode(".jpg", dummy_image)
    image_bytes = img_encoded.tobytes()

    # Build metadata
    submission = create_impact_submission(
        volunteer_address="0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
        action_type=ActionType.FOOD_DISTRIBUTION,
        urgency_level=UrgencyLevel.HIGH,
        description="Distributed 200 food packages to displaced families in conflict zone.",
        effort_hours=8.0,
        latitude=14.4974,     # Yemen coordinates
        longitude=46.9611,
        poverty_index=0.95,
        ipfs_media_cid="bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        beneficiary_zkp_hash="a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
        zkp_proof_hash="deadbeefcafe1234deadbeefcafe1234deadbeefcafe1234deadbeefcafe1234",
    )

    # Run evaluation
    evaluator = ImpactEvaluator()
    result = evaluator.evaluate(submission, image_bytes=image_bytes)

    print("\n📋 EVALUATION RESULT:")
    print(result.to_json())

    if result.verification_status == VerificationStatus.VERIFIED:
        print("\n🔐 ORACLE PAYLOAD (for BenevolenceVault.sol):")
        payload = evaluator.generate_oracle_payload(result)
        print(json.dumps(payload, indent=2))
