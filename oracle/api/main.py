"""
APEX HUMANITY — SATIN Oracle API Gateway
FastAPI server exposing the ImpactEvaluator to the dApp and smart contracts.
"""

import hashlib
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field, validator

from engine.impact_evaluator import (
    ActionType,
    EvidenceBundle,
    GPSCoordinates,
    ImpactEvaluator,
    OraclePayload,
    VerificationStatus,
)

# ─── Setup ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("satin.api")

ORACLE_API_KEY = os.getenv("ORACLE_API_KEY", "apex-dev-key-change-in-prod")
API_KEY_HEADER = APIKeyHeader(name="X-APEX-Oracle-Key", auto_error=True)

app = FastAPI(
    title="APEX HUMANITY — SATIN Oracle API",
    description="AI Oracle for Proof of Beneficial Action (PoBA) verification",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# Singleton evaluator instance
evaluator = ImpactEvaluator(private_key_hex=os.getenv("ORACLE_PRIVATE_KEY"))


# ─── Auth ─────────────────────────────────────────────────────────────────────
async def verify_api_key(api_key: str = Security(API_KEY_HEADER)) -> str:
    if api_key != ORACLE_API_KEY:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid Oracle API key")
    return api_key


# ─── Request / Response Models ────────────────────────────────────────────────
class GPSInput(BaseModel):
    latitude:         float = Field(..., ge=-90,  le=90)
    longitude:        float = Field(..., ge=-180, le=180)
    altitude:         float = Field(0.0)
    accuracy_meters:  float = Field(10.0, le=100)
    timestamp_unix:   Optional[int] = None

class VerifyImpactRequest(BaseModel):
    ipfs_cid:            str = Field(..., min_length=10, description="IPFS CID of evidence")
    evidence_type:       str = Field("image", description="image | video | iot_data | document")
    hash_sha256:         str = Field(..., min_length=64, max_length=64)
    gps:                 GPSInput
    action_type:         ActionType
    people_helped:       int = Field(..., ge=1, le=1_000_000)
    volunteer_address:   str = Field(..., min_length=42, max_length=42)
    beneficiary_address: str = Field(..., min_length=42, max_length=42)
    country_iso:         str = Field("DEFAULT", max_length=3)
    description:         Optional[str] = Field(None, max_length=2000)

    @validator("volunteer_address", "beneficiary_address")
    def validate_evm_address(cls, v: str) -> str:
        if not v.startswith("0x") or len(v) != 42:
            raise ValueError("Must be a valid EVM address (0x + 40 hex chars)")
        return v.lower()


class ImpactScoreResponse(BaseModel):
    event_id:           str
    status:             VerificationStatus
    impact_score:       float
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


class HealthResponse(BaseModel):
    status:         str
    oracle_address: str
    version:        str
    timestamp:      int


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="operational",
        oracle_address=evaluator._signer.oracle_address,
        version="1.0.0",
        timestamp=int(time.time()),
    )


@app.post(
    "/api/v1/verify",
    response_model=ImpactScoreResponse,
    summary="Verify an Impact Event",
    description=(
        "Submit an impact evidence bundle for AI verification. "
        "Returns a signed oracle payload ready for BenevolenceVault.releaseReward()."
    ),
)
async def verify_impact(
    request: VerifyImpactRequest,
    _: str = Depends(verify_api_key),
) -> ImpactScoreResponse:
    start_ms = time.time() * 1000

    gps = GPSCoordinates(
        latitude        = request.gps.latitude,
        longitude       = request.gps.longitude,
        altitude        = request.gps.altitude,
        accuracy_meters = request.gps.accuracy_meters,
        timestamp_unix  = request.gps.timestamp_unix or int(time.time()),
    )
    evidence = EvidenceBundle(
        ipfs_cid            = request.ipfs_cid,
        evidence_type       = request.evidence_type,
        hash_sha256         = request.hash_sha256,
        gps                 = gps,
        action_type         = request.action_type,
        people_helped       = request.people_helped,
        volunteer_address   = request.volunteer_address,
        beneficiary_address = request.beneficiary_address,
        country_iso         = request.country_iso,
        description         = request.description,
    )

    try:
        payload: OraclePayload = evaluator.evaluate(evidence)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Validation error: {e}")
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=f"Insufficient impact: {e}")

    elapsed = round(time.time() * 1000 - start_ms, 2)

    return ImpactScoreResponse(
        event_id           = payload.event_id,
        status             = payload.status,
        impact_score       = payload.impact_score,
        token_reward       = payload.token_reward,
        oracle_address     = payload.oracle_address,
        zk_proof_hash      = payload.zk_proof_hash,
        event_hash         = payload.event_hash,
        nonce              = payload.nonce,
        issued_at          = payload.issued_at,
        expires_at         = payload.expires_at,
        score_breakdown    = payload.score_breakdown,
        signature          = payload.signature,
        contract_args      = payload.to_contract_args(),
        processing_time_ms = elapsed,
    )


@app.post(
    "/api/v1/verify/batch",
    summary="Batch Verify Impact Events",
)
async def batch_verify(
    request: BatchVerifyRequest,
    _: str = Depends(verify_api_key),
) -> Dict[str, Any]:
    results = []
    for event in request.events:
        try:
            response = await verify_impact(event, _)
            results.append({"success": True, "data": response.dict()})
        except HTTPException as e:
            results.append({"success": False, "error": e.detail})
    return {"total": len(results), "results": results}


@app.get(
    "/api/v1/oracle/info",
    summary="Oracle Identity Information",
)
async def oracle_info(_: str = Depends(verify_api_key)) -> Dict[str, Any]:
    return {
        "oracle_address": evaluator._signer.oracle_address,
        "protocol":       "APEX HUMANITY — SATIN v1.0.0",
        "supported_actions": [a.value for a in ActionType],
        "score_weights":  {
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
