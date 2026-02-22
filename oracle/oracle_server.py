"""
SATIN Oracle — FastAPI REST Server
Exposes the ImpactEvaluator as a secure HTTP service.
"""

import hashlib
import os
import uuid
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Security, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field

from impact_evaluator import (
    ActionType,
    GPSCoordinate,
    ImpactEvaluator,
    ImpactMetadata,
    UrgencyLevel,
    VerificationStatus,
    ZKProofBundle,
    create_impact_submission,
)

app = FastAPI(
    title="SATIN Oracle API — APEX HUMANITY",
    description="Sovereign Autonomous Trust & Impact Network Oracle Server",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY_HEADER = APIKeyHeader(name="X-SATIN-API-Key", auto_error=True)
VALID_API_KEYS = set(os.getenv("SATIN_API_KEYS", "dev-key-apex-humanity").split(","))


async def verify_api_key(api_key: str = Security(API_KEY_HEADER)):
    if api_key not in VALID_API_KEYS:
        raise HTTPException(status_code=403, detail="Invalid Oracle API Key")
    return api_key


evaluator = ImpactEvaluator(
    oracle_private_key_hex=os.getenv("ORACLE_PRIVATE_KEY_HEX")
)


# ── Pydantic Schemas ─────────────────────────────────────────────────────────

class GPSInput(BaseModel):
    latitude: float
    longitude: float
    altitude: float = 0.0
    accuracy_meters: float = 10.0


class ZKPInput(BaseModel):
    proof_hash: str
    public_signals: list
    verification_key_hash: str


class ImpactSubmissionRequest(BaseModel):
    volunteer_address: str = Field(..., description="Ethereum address of volunteer")
    beneficiary_zkp_hash: str = Field(..., description="ZK-protected beneficiary hash")
    action_type: ActionType
    urgency_level: UrgencyLevel
    description: str
    effort_hours: float = Field(..., ge=0.1, le=720.0)
    gps: GPSInput
    poverty_index: float = Field(..., ge=0.0, le=1.0)
    ipfs_media_cid: str
    zkp_bundle: Optional[ZKPInput] = None


class EvaluationResponse(BaseModel):
    event_id: str
    verification_status: str
    impact_score: float
    ai_confidence: float
    event_hash: str
    oracle_signature: str
    oracle_public_key: str
    oracle_payload: Optional[dict] = None
    rejection_reason: str = ""


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "operational",
        "service": "SATIN Oracle",
        "oracle_public_key": evaluator.signer.public_key_hex[:20] + "...",
    }


@app.post("/evaluate", response_model=EvaluationResponse)
async def evaluate_impact(
    request: ImpactSubmissionRequest,
    api_key: str = Depends(verify_api_key),
):
    """
    Submit an Impact Proof for AI oracle evaluation.
    Returns a signed oracle payload ready for on-chain submission.
    """
    gps = GPSCoordinate(
        latitude=request.gps.latitude,
        longitude=request.gps.longitude,
        altitude=request.gps.altitude,
        accuracy_meters=request.gps.accuracy_meters,
    )

    zkp = None
    if request.zkp_bundle:
        zkp = ZKProofBundle(
            proof_hash=request.zkp_bundle.proof_hash,
            public_signals=request.zkp_bundle.public_signals,
            verification_key_hash=request.zkp_bundle.verification_key_hash,
        )

    metadata = ImpactMetadata(
        event_id=str(uuid.uuid4()),
        volunteer_address=request.volunteer_address,
        beneficiary_zkp_hash=request.beneficiary_zkp_hash,
        action_type=request.action_type,
        urgency_level=request.urgency_level,
        description=request.description,
        effort_hours=request.effort_hours,
        gps_coordinates=gps,
        poverty_index=request.poverty_index,
        ipfs_media_cid=request.ipfs_media_cid,
        zkp_bundle=zkp,
    )

    result = evaluator.evaluate(metadata)

    oracle_payload = None
    if result.verification_status == VerificationStatus.VERIFIED:
        oracle_payload = evaluator.generate_oracle_payload(result)

    return EvaluationResponse(
        event_id=result.event_id,
        verification_status=result.verification_status.value,
        impact_score=result.impact_score,
        ai_confidence=result.ai_confidence,
        event_hash=result.event_hash,
        oracle_signature=result.oracle_signature,
        oracle_public_key=evaluator.signer.public_key_hex,
        oracle_payload=oracle_payload,
        rejection_reason=result.rejection_reason,
    )


@app.post("/evaluate-with-image", response_model=EvaluationResponse)
async def evaluate_with_image(
    volunteer_address: str,
    beneficiary_zkp_hash: str,
    action_type: ActionType,
    urgency_level: UrgencyLevel,
    description: str,
    effort_hours: float,
    latitude: float,
    longitude: float,
    poverty_index: float,
    ipfs_media_cid: str,
    image: UploadFile = File(...),
    api_key: str = Depends(verify_api_key),
):
    """
    Evaluate impact with direct image upload (multipart form).
    The image is analyzed by the CV engine for authenticity.
    """
    image_bytes = await image.read()
    if len(image_bytes) > 50 * 1024 * 1024:  # 50MB limit
        raise HTTPException(status_code=413, detail="Image too large (max 50MB)")

    submission = create_impact_submission(
        volunteer_address=volunteer_address,
        action_type=action_type,
        urgency_level=urgency_level,
        description=description,
        effort_hours=effort_hours,
        latitude=latitude,
        longitude=longitude,
        poverty_index=poverty_index,
        ipfs_media_cid=ipfs_media_cid,
        beneficiary_zkp_hash=beneficiary_zkp_hash,
    )

    result = evaluator.evaluate(submission, image_bytes=image_bytes)

    oracle_payload = None
    if result.verification_status == VerificationStatus.VERIFIED:
        oracle_payload = evaluator.generate_oracle_payload(result)

    return EvaluationResponse(
        event_id=result.event_id,
        verification_status=result.verification_status.value,
        impact_score=result.impact_score,
        ai_confidence=result.ai_confidence,
        event_hash=result.event_hash,
        oracle_signature=result.oracle_signature,
        oracle_public_key=evaluator.signer.public_key_hex,
        oracle_payload=oracle_payload,
        rejection_reason=result.rejection_reason,
    )
