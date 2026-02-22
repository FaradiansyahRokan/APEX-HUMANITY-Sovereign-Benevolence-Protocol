"""
APEX HUMANITY — SATIN Oracle API Gateway
FastAPI server exposing the ImpactEvaluator to the dApp and smart contracts.

v1.0.1 Fixes:
  - Removed duplicate evaluator instantiation
  - image_base64 field added to VerifyImpactRequest — image now decoded and
    forwarded to evaluator.evaluate(image_bytes=...) correctly
  - Replaced asdict(payload) with safe manual serialization to avoid
    dataclass private-field issues
"""

import base64
import hashlib
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from engine.impact_evaluator import (
    ActionType,
    EvidenceBundle,
    GPSCoordinates,
    ImpactEvaluator,
    OraclePayload,
    VerificationStatus,
)

load_dotenv()

# ─── Setup ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("satin.api")

ORACLE_API_KEY = os.getenv("ORACLE_API_KEY", "apex-dev-key-change-in-prod")
API_KEY_HEADER = APIKeyHeader(name="X-APEX-Oracle-Key", auto_error=True)

# FIX: single evaluator instance
evaluator = ImpactEvaluator(private_key_hex=os.getenv("ORACLE_PRIVATE_KEY"))

app = FastAPI(
    title="APEX HUMANITY — SATIN Oracle API",
    description="AI Oracle for Proof of Beneficial Action (PoBA) verification",
    version="1.0.1",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Auth ─────────────────────────────────────────────────────────────────────
async def verify_api_key(api_key: str = Security(API_KEY_HEADER)) -> str:
    if api_key != ORACLE_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid Oracle API key",
        )
    return api_key


# ─── Request / Response Models ────────────────────────────────────────────────
class GPSInput(BaseModel):
    latitude:        float
    longitude:       float
    accuracy_meters: float = 10.0


class VerifyImpactRequest(BaseModel):
    ipfs_cid:            str
    evidence_type:       str = "image"
    hash_sha256:         str
    gps:                 GPSInput
    action_type:         ActionType
    people_helped:       int
    volunteer_address:   str
    beneficiary_address: str
    country_iso:         str           = "ID"
    description:         Optional[str] = None
    # FIX: urgency and effort now passed from the form
    urgency_level:       str           = "HIGH"
    effort_hours:        float         = 8.0
    # FIX: image dikirim sebagai base64 string dari frontend
    # Jika None → text/GPS-only submission (tetap valid)
    image_base64:        Optional[str] = Field(
        default=None,
        description="Base64-encoded image/video proof. Optional — submission "
                    "is valid without it, but image boosts the impact score.",
    )


class ImpactScoreResponse(BaseModel):
    event_id:           str
    status:             str
    impact_score:       float
    ai_confidence:      float
    token_reward:       float
    oracle_address:     str
    zk_proof_hash:      str
    event_hash:         str
    nonce:              str
    issued_at:          int
    expires_at:         int
    score_breakdown:    Dict[str, float]
    signature:          Dict[str, str]
    contract_args:      Dict[str, Any]
    processing_time_ms: float


class BatchVerifyRequest(BaseModel):
    events: List[VerifyImpactRequest] = Field(..., max_items=50)


# ─── Helper: safe OraclePayload → dict ────────────────────────────────────────
def _payload_to_dict(payload: OraclePayload) -> dict:
    """
    FIX: asdict() on a dataclass with private fields (leading underscore) can
    cause KeyError / unexpected output. We serialise manually instead.
    """
    return {
        "event_id":       payload.event_id,
        "status":         payload.status.value,
        "impact_score":   payload.impact_score,
        "ai_confidence":  payload.ai_confidence,
        "token_reward":   payload.token_reward,
        "oracle_address": payload.oracle_address,
        "zk_proof_hash":  payload.zk_proof_hash,
        "event_hash":     payload.event_hash,
        "nonce":          payload.nonce,
        "issued_at":      payload.issued_at,
        "expires_at":     payload.expires_at,
        "score_breakdown": payload.score_breakdown,
        "signature":      payload.signature,
    }


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status":         "operational",
        "oracle_address": evaluator._signer.oracle_address,
        "version":        "1.0.1",
        "timestamp":      int(time.time()),
    }


@app.post("/api/v1/verify", response_model=ImpactScoreResponse)
async def verify_impact(
    request: VerifyImpactRequest,
    api_key: str = Security(verify_api_key),
):
    t_start = time.perf_counter()

    # FIX: decode base64 image jika dikirim dari frontend
    image_bytes: Optional[bytes] = None
    if request.image_base64:
        try:
            image_bytes = base64.b64decode(request.image_base64)
            log.info(f"Image received — {len(image_bytes):,} bytes")
        except Exception as e:
            log.warning(f"Failed to decode image_base64: {e} — continuing without image")
            image_bytes = None
    else:
        log.info("No image_base64 in request — text/GPS-only submission")

    # Build EvidenceBundle
    evidence = EvidenceBundle(
        ipfs_cid            = request.ipfs_cid,
        evidence_type       = request.evidence_type,
        hash_sha256         = request.hash_sha256,
        gps                 = GPSCoordinates(
            latitude        = request.gps.latitude,
            longitude       = request.gps.longitude,
            accuracy_meters = request.gps.accuracy_meters,
        ),
        action_type         = request.action_type,
        people_helped       = request.people_helped,
        volunteer_address   = request.volunteer_address,
        beneficiary_address = request.beneficiary_address,
        country_iso         = request.country_iso,
        description         = request.description,
        urgency_level       = request.urgency_level,   # FIX
        effort_hours        = request.effort_hours,    # FIX
    )

    try:
        # FIX: image_bytes sekarang diteruskan ke evaluator
        payload: OraclePayload = evaluator.evaluate(evidence, image_bytes=image_bytes)

        processing_ms = round((time.perf_counter() - t_start) * 1000, 2)

        return {
            **_payload_to_dict(payload),
            "contract_args":      payload.to_contract_args(),
            "processing_time_ms": processing_ms,
        }

    except Exception as e:
        log.error(f"Evaluation failed: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/verify/batch", summary="Batch Verify Impact Events")
async def batch_verify(
    request:  BatchVerifyRequest,
    api_key: str = Depends(verify_api_key),
) -> Dict[str, Any]:
    results = []
    for event in request.events:
        try:
            response = await verify_impact(event, api_key)
            results.append({"success": True, "data": response})
        except HTTPException as e:
            results.append({"success": False, "error": e.detail})
    return {"total": len(results), "results": results}


@app.get("/api/v1/oracle/info", summary="Oracle Identity Information")
async def oracle_info(_: str = Depends(verify_api_key)) -> Dict[str, Any]:
    return {
        "oracle_address":      evaluator._signer.oracle_address,
        "protocol":            "APEX HUMANITY — SATIN v1.0.1",
        "supported_actions":   [a.value for a in ActionType],
        "score_weights": {
            "urgency":      0.35,
            "difficulty":   0.25,
            "reach":        0.20,
            "authenticity": 0.20,
        },
        "base_token_reward":   100.0,
        "min_score_threshold": 30.0,
        "signing_algorithm":   "ECDSA secp256k1",
        "zk_proof_scheme":     "commitment_v1 (Groth16 in prod)",
    }