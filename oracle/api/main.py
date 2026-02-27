"""
APEX HUMANITY — SATIN Oracle API Gateway
FastAPI server exposing the ImpactEvaluator to the dApp and smart contracts.

v1.2.0 — Data Integrity Update:
  - GET /api/v1/challenge  — challenge nonce endpoint for photo verification
  - EXIF validation passed to fraud_detector (timestamp + GPS mismatch)
  - ELA analysis result surfaced in response as integrity_warnings
  - source field in request (live_capture | gallery) — live gets bonus score

v1.1.0 Changes:
  - CORS allow_origins from ALLOWED_ORIGINS env var
  - Rate limiting via slowapi
  - GPSCoordinatesInput rename
"""

import base64
import logging
import os
import secrets
import time
import uuid
from typing import Any, Dict, List, Optional

# ─── In-memory challenge nonce store ──────────────────────────────────────────
# { nonce_code: expires_at_unix }
_challenge_store: dict[str, int] = {}

from fastapi import Depends, FastAPI, HTTPException, Request, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from engine.impact_evaluator import (
    ActionType,
    EvidenceBundle,
    GPSCoordinatesInput,
    ImpactEvaluator,
    OraclePayload,
    VerificationStatus,
)
from engine.fraud_detector import FraudDetector

load_dotenv()

# ─── Setup ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("satin.api")

ORACLE_API_KEY = os.getenv("ORACLE_API_KEY", "apex-dev-key-change-in-prod")
API_KEY_HEADER = APIKeyHeader(name="X-APEX-Oracle-Key", auto_error=True)

# ─── Rate Limiter ─────────────────────────────────────────────────────────────
# Limit configurable via env: e.g. RATE_LIMIT_VERIFY="10/minute"
RATE_LIMIT_VERIFY = os.getenv("RATE_LIMIT_VERIFY", "5/minute")
limiter = Limiter(key_func=get_remote_address)

# FIX: single evaluator instance
evaluator = ImpactEvaluator(private_key_hex=os.getenv("ORACLE_PRIVATE_KEY"))

# Fraud/Sybil detection
fraud_detector = FraudDetector()

app = FastAPI(
    title="APEX HUMANITY — SATIN Oracle API",
    description="AI Oracle for Proof of Beneficial Action (PoBA) verification",
    version="1.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── Rate limit error handler ─────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ─── CORS ─────────────────────────────────────────────────────────────────────
# FIX: Read allowed origins from env var — defaults to localhost only.
# In production, set: ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
ALLOWED_ORIGINS: List[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]
log.info(f"CORS allowed origins: {ALLOWED_ORIGINS}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
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
    urgency_level:       str           = "HIGH"
    effort_hours:        float         = 8.0
    # Data integrity fields (v1.2.0)
    source:            str           = Field(default="gallery", description="'live_capture' | 'gallery'")
    capture_timestamp: Optional[int] = Field(default=None, description="Unix ms timestamp of live camera capture")
    image_base64:      Optional[str] = Field(
        default=None,
        description="Base64-encoded image/video proof.",
    )


class ImpactScoreResponse(BaseModel):
    event_id:            str
    status:              str
    impact_score:        float
    ai_confidence:       float
    token_reward:        float
    oracle_address:      str
    zk_proof_hash:       str
    event_hash:          str
    nonce:               str
    issued_at:           int
    expires_at:          int
    score_breakdown:     Dict[str, float]
    signature:           Dict[str, str]
    contract_args:       Dict[str, Any]
    processing_time_ms:  float
    integrity_warnings:  List[str]          # EXIF / ELA / GPS flags
    authenticity_penalty: float             # 0.0-0.6, already applied to score


class BatchVerifyRequest(BaseModel):
    events: List[VerifyImpactRequest] = Field(..., max_items=50)


# ─── Helper: safe OraclePayload → dict ────────────────────────────────────────
def _payload_to_dict(payload: OraclePayload) -> dict:
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
        "version":        "1.2.0",
        "timestamp":      int(time.time()),
    }


@app.get("/api/v1/challenge", summary="Get Photo Challenge Nonce")
async def get_challenge(api_key: str = Security(verify_api_key)) -> Dict[str, Any]:
    """
    Returns a short-lived nonce (e.g. 'APEX-4829') that the user must
    write on a piece of paper and hold in the evidence photo.
    Valid for 10 minutes. Oracle will check for it via OCR if EasyOCR is installed.
    """
    # Prune expired
    now = int(time.time())
    expired = [k for k, exp in _challenge_store.items() if exp < now]
    for k in expired:
        _challenge_store.pop(k, None)

    code       = f"APEX-{secrets.randbelow(9000) + 1000}"  # APEX-1000 to APEX-9999
    expires_at = now + 600  # 10 minutes
    _challenge_store[code] = expires_at

    log.info(f"[CHALLENGE] Issued: {code} (expires {expires_at})")
    return {
        "code":       code,
        "expires_at": expires_at,
        "instruction": f"Write '{code}' on a piece of paper and hold it clearly "
                        f"visible in your evidence photo before capturing.",
        "valid_seconds": 600,
    }


@app.post("/api/v1/verify", response_model=ImpactScoreResponse)
@limiter.limit(RATE_LIMIT_VERIFY)
async def verify_impact(
    request:  Request,                          # required by slowapi
    body:     VerifyImpactRequest,
    api_key:  str = Security(verify_api_key),
):
    t_start = time.perf_counter()

    # Decode base64 image if sent from frontend
    image_bytes: Optional[bytes] = None
    if body.image_base64:
        try:
            image_bytes = base64.b64decode(body.image_base64)
            log.info(f"Image received — {len(image_bytes):,} bytes")
        except Exception as e:
            log.warning(f"Failed to decode image_base64: {e} — continuing without image")
            image_bytes = None
    else:
        log.info("No image_base64 in request — text/GPS-only submission")

    # Build EvidenceBundle
    evidence = EvidenceBundle(
        ipfs_cid            = body.ipfs_cid,
        evidence_type       = body.evidence_type,
        hash_sha256         = body.hash_sha256,
        gps                 = GPSCoordinatesInput(
            latitude        = body.gps.latitude,
            longitude       = body.gps.longitude,
            accuracy_meters = body.gps.accuracy_meters,
        ),
        action_type         = body.action_type,
        people_helped       = body.people_helped,
        volunteer_address   = body.volunteer_address,
        beneficiary_address = body.beneficiary_address,
        country_iso         = body.country_iso,
        description         = body.description,
        urgency_level       = body.urgency_level,
        effort_hours        = body.effort_hours,
    )

    try:
        # ── Fraud / Sybil / Integrity checks ──────────────────────────────────
        fraud_result = fraud_detector.check_all(
            volunteer_address = body.volunteer_address,
            hash_sha256       = body.hash_sha256,
            image_bytes       = image_bytes,
            submit_lat        = body.gps.latitude,
            submit_lon        = body.gps.longitude,
            source            = body.source,
        )
        if not fraud_result["ok"]:
            reason = fraud_result["reason"]
            raise HTTPException(
                status_code = 429 if "Rate limit" in reason else 409,
                detail       = reason,
            )

        integrity_warnings   = fraud_result.get("warnings", [])
        authenticity_penalty = fraud_result.get("authenticity_penalty", 0.0)

        # ── Capture timestamp freshness check (live_capture only) ──────────────
        if body.source == "live_capture" and body.capture_timestamp:
            age_ms  = int(time.time() * 1000) - body.capture_timestamp
            age_min = age_ms / 60_000
            if age_min > 15:
                log.warning(f"[TIMESTAMP] Live capture is {age_min:.1f} min old")
                integrity_warnings.append(f"capture_stale_{int(age_min)}min")
                authenticity_penalty = min(1.0, authenticity_penalty + 0.10)
            else:
                log.info(f"[TIMESTAMP] Live capture fresh: {age_min:.1f} min old")

        payload: OraclePayload = evaluator.evaluate(evidence, image_bytes=image_bytes)

        processing_ms = round((time.perf_counter() - t_start) * 1000, 2)

        # ── Record successful submission for future dedup ──────────────────────
        fraud_detector.record_sha256(body.hash_sha256, body.volunteer_address)
        fraud_detector.record_submission(body.volunteer_address)

        return {
            **_payload_to_dict(payload),
            "contract_args":       payload.to_contract_args(),
            "processing_time_ms":  processing_ms,
            "integrity_warnings":  integrity_warnings,
            "authenticity_penalty": authenticity_penalty,
        }

    except Exception as e:
        log.error(f"Evaluation failed: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/verify/batch", summary="Batch Verify Impact Events")
async def batch_verify(
    request:  Request,
    body:     BatchVerifyRequest,
    api_key:  str = Depends(verify_api_key),
) -> Dict[str, Any]:
    results = []
    for event in body.events:
        try:
            response = await verify_impact(request, event, api_key)
            results.append({"success": True, "data": response})
        except HTTPException as e:
            results.append({"success": False, "error": e.detail})
    return {"total": len(results), "results": results}


@app.get("/api/v1/oracle/info", summary="Oracle Identity Information")
async def oracle_info(_: str = Depends(verify_api_key)) -> Dict[str, Any]:
    return {
        "oracle_address":      evaluator._signer.oracle_address,
        "protocol":            "APEX HUMANITY — SATIN v1.2.0",
        "supported_actions":   [a.value for a in ActionType],
        "rate_limit":          RATE_LIMIT_VERIFY,
        "allowed_origins":     ALLOWED_ORIGINS,
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
        "integrity_layers": [
            "sha256_exact_dedup",
            "perceptual_hash_sybil",
            "exif_timestamp_validation",
            "exif_gps_mismatch_detection",
            "ela_manipulation_detection",
            "live_capture_timestamp_freshness",
        ],
    }