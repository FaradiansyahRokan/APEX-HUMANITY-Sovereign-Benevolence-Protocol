"""
APEX HUMANITY — SATIN Oracle API Gateway
FastAPI server exposing the ImpactEvaluator to the dApp and smart contracts.

v1.3.0 — Parameter Integrity Update:
  - ParameterValidator berlapis: hard cap, ratio anomaly, LLM cross-check
  - YOLO person count triangulation vs claimed people_helped
  - Description keyword cross-check per action type
  - Urgency-ActionType compatibility matrix
  - Auto-clamp adjusted parameters sebelum scoring
  - Parameter manipulation auto-ban (3x streak)

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
import json
import redis
from typing import Any, Dict, List, Optional

# ─── Persistent State (Redis) ─────────────────────────────────────────────────
redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
try:
    redis_client.ping()
except redis.ConnectionError:
    pass

# Thresholds
COMMUNITY_REVIEW_CONFIDENCE   = 0.30
CHAMPION_REPUTATION_THRESHOLD = 500
VOTE_PHASE2_DELAY_SEC         = 600
VOTE_QUORUM                   = 3

# ── Parameter Manipulation Streak (beda dari general fraud) ──────────────────
PARAM_MANIP_STREAK_BAN = 3   # 3x parameter manipulation → auto-ban

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
    EvaluationFailedError,
)
from engine.fraud_detector import FraudDetector
from engine.parameter_validator import ParameterValidator

load_dotenv()

# ─── Setup ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("satin.api")

ORACLE_API_KEY = os.getenv("ORACLE_API_KEY", "apex-dev-key-change-in-prod")
API_KEY_HEADER = APIKeyHeader(name="X-APEX-Oracle-Key", auto_error=True)

RATE_LIMIT_VERIFY = os.getenv("RATE_LIMIT_VERIFY", "5/minute")
limiter           = Limiter(key_func=get_remote_address)

evaluator         = ImpactEvaluator(private_key_hex=os.getenv("ORACLE_PRIVATE_KEY"))
fraud_detector    = FraudDetector()
param_validator   = ParameterValidator()   # ← NEW: parameter integrity validator

app = FastAPI(
    title       = "APEX HUMANITY — SATIN Oracle API",
    description = "AI Oracle for Proof of Beneficial Action (PoBA) verification",
    version     = "1.3.0",
    docs_url    = "/docs",
    redoc_url   = "/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ─── Startup Validation ───────────────────────────────────────────────────────
@app.on_event("startup")
async def _startup_validation():
    private_key = os.getenv("ORACLE_PRIVATE_KEY", "")
    api_key_val = os.getenv("ORACLE_API_KEY", "")
    DEFAULT_KEY = "apex-dev-key-change-in-prod"
    warnings_found = []
    if not private_key:
        warnings_found.append(
            "NO ORACLE_PRIVATE_KEY SET — ephemeral key in use. Set before production."
        )
    if not api_key_val or api_key_val == DEFAULT_KEY:
        warnings_found.append(
            f"DEFAULT API KEY IN USE. Set a strong ORACLE_API_KEY before production."
        )
    if not os.getenv("ANTHROPIC_API_KEY"):
        warnings_found.append(
            "ANTHROPIC_API_KEY not set — LLM description cross-validator DISABLED. "
            "Set to enable the most powerful anti-manipulation layer."
        )
    for w in warnings_found:
        log.critical(f"\n{'='*70}\n⚠️  SECURITY WARNING: {w}\n{'='*70}")
    if not warnings_found:
        log.info("✅ Startup validation passed.")

# ─── CORS ─────────────────────────────────────────────────────────────────────
_raw_origins    = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
ALLOWED_ORIGINS: List[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins  = ALLOWED_ORIGINS,
    allow_methods  = ["GET", "POST"],
    allow_headers  = ["*"],
)

# ─── Auth ─────────────────────────────────────────────────────────────────────
async def verify_api_key(api_key: str = Security(API_KEY_HEADER)) -> str:
    if api_key != ORACLE_API_KEY:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid Oracle API key")
    return api_key


# ─── Request / Response Models ────────────────────────────────────────────────
class GPSInput(BaseModel):
    latitude:        float
    longitude:       float
    accuracy_meters: float = 10.0


class VerifyImpactRequest(BaseModel):
    ipfs_cid:            str
    evidence_type:       str           = "image"
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
    source:              str           = Field(default="gallery", description="'live_capture' | 'gallery'")
    capture_timestamp:   Optional[int] = Field(default=None)
    image_base64:        Optional[str] = Field(default=None)


class ImpactScoreResponse(BaseModel):
    event_id:              str
    status:                str
    impact_score:          float
    ai_confidence:         float
    token_reward:          float
    oracle_address:        str
    zk_proof_hash:         str
    event_hash:            str
    nonce:                 str
    issued_at:             int
    expires_at:            int
    score_breakdown:       Dict[str, float]
    signature:             Dict[str, str]
    contract_args:         Dict[str, Any]
    processing_time_ms:    float
    integrity_warnings:    List[str]
    authenticity_penalty:  float
    # v1.3.0 NEW
    parameter_warnings:    List[str]
    parameter_penalty:     float
    adjusted_people_helped: Optional[int]
    adjusted_effort_hours:  Optional[float]
    llm_verdict:           Optional[str]


class BatchVerifyRequest(BaseModel):
    events: List[VerifyImpactRequest] = Field(..., max_items=50)


# ─── Helper: safe OraclePayload → dict ────────────────────────────────────────
def _payload_to_dict(payload: OraclePayload) -> dict:
    return {
        "event_id":        payload.event_id,
        "status":          payload.status.value,
        "impact_score":    payload.impact_score,
        "ai_confidence":   payload.ai_confidence,
        "token_reward":    payload.token_reward,
        "oracle_address":  payload.oracle_address,
        "zk_proof_hash":   payload.zk_proof_hash,
        "event_hash":      payload.event_hash,
        "nonce":           payload.nonce,
        "issued_at":       payload.issued_at,
        "expires_at":      payload.expires_at,
        "score_breakdown": payload.score_breakdown,
        "signature":       payload.signature,
    }


# ─── Community claim payload builder ─────────────────────────────────────────
COMMUNITY_CLAIM_IMPACT_SCORE = 30.0
COMMUNITY_CLAIM_TOKEN_REWARD = round(5.0 + (0.30 ** 1.5) * 45.0, 4)

def _build_community_claim_payload(stream_entry: dict) -> tuple[dict, dict]:
    from eth_abi import encode as abi_encode
    from web3 import Web3
    event_id       = stream_entry["event_id"]
    volunteer_addr = stream_entry["volunteer_address"]
    impact_score   = COMMUNITY_CLAIM_IMPACT_SCORE
    token_reward   = COMMUNITY_CLAIM_TOKEN_REWARD
    impact_scaled  = int(impact_score * 100)
    token_reward_wei = int(token_reward * 10 ** 18)
    now        = int(time.time())
    nonce      = uuid.uuid4().hex
    expires_at = now + 3600
    event_id_hex   = event_id.replace("-", "")
    event_id_bytes = bytes.fromhex(event_id_hex.rjust(64, "0"))
    from engine.impact_evaluator import _keccak256 as _keccak
    zk_proof_hash    = _keccak((volunteer_addr.lower() + event_id).encode())
    canonical_str    = f"community-reviewed::{event_id}::{volunteer_addr.lower()}::{impact_score}"
    event_hash       = _keccak(canonical_str.encode()).hex()
    event_hash_bytes = bytes.fromhex(event_hash)
    vol_addr = Web3.to_checksum_address(volunteer_addr)
    encoded  = abi_encode(
        ["bytes32","address","address","uint256","uint256","bytes32","bytes32","string","uint256"],
        [event_id_bytes, vol_addr, vol_addr, impact_scaled, token_reward_wei,
         zk_proof_hash, event_hash_bytes, nonce, expires_at],
    )
    signing_hash = _keccak(encoded)
    sig = evaluator.signer.sign_payload_hash(signing_hash)
    payload_dict = {
        "event_id":        event_id,
        "status":          "VERIFIED",
        "impact_score":    impact_score,
        "ai_confidence":   0.0,
        "token_reward":    token_reward,
        "oracle_address":  evaluator.signer.oracle_address,
        "zk_proof_hash":   "0x" + zk_proof_hash.hex(),
        "event_hash":      event_hash,
        "nonce":           nonce,
        "issued_at":       now,
        "expires_at":      expires_at,
        "score_breakdown": {
            "community_approved": impact_score,
            "note": f"Fixed minimum grade — community endorsed. Reward: {token_reward} APEX",
        },
        "signature": {"v": sig["v"], "r": sig["r"], "s": sig["s"]},
    }
    contract_args = {
        "impactScoreScaled":  impact_scaled,
        "tokenRewardWei":     str(token_reward_wei),
        "beneficiaryAddress": volunteer_addr,
    }
    log.info(f"[CLAIM] Community payload built for {event_id}: score={impact_score}, reward={token_reward} APEX")
    return payload_dict, contract_args


# ─── Parameter Manipulation Streak Tracking ──────────────────────────────────
def _record_param_manipulation(volunteer_address: str, violation_code: str) -> int:
    """Track parameter manipulation attempts. Returns new streak count."""
    addr      = volunteer_address.lower()
    streak_key = f"satin:param_manip_streak:{addr}"
    streak     = redis_client.incr(streak_key)
    redis_client.expire(streak_key, 7 * 24 * 3600)  # reset if clean for 7 days
    log.warning(
        f"[PARAM_MANIP] {addr} parameter manipulation streak: {streak} "
        f"(violation: {violation_code})"
    )
    return streak


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status":         "operational",
        "oracle_address": evaluator._signer.oracle_address,
        "version":        "1.3.0",
        "timestamp":      int(time.time()),
        "features": {
            "llm_validator": bool(os.getenv("ANTHROPIC_API_KEY")),
            "exif_check":    True,
            "ela_check":     True,
            "param_validator": True,
            "yolo_triangulation": True,
        }
    }


@app.get("/api/v1/challenge", summary="Get Photo Challenge Nonce")
async def get_challenge(api_key: str = Security(verify_api_key)) -> Dict[str, Any]:
    now        = int(time.time())
    code       = f"APEX-{secrets.randbelow(9000) + 1000}"
    expires_at = now + 600
    redis_client.setex(f"satin:challenge:{code}", 600, expires_at)
    log.info(f"[CHALLENGE] Issued: {code}")
    return {
        "code":        code,
        "expires_at":  expires_at,
        "instruction": f"Write '{code}' on paper, hold it clearly visible in your evidence photo.",
        "valid_seconds": 600,
    }


@app.post("/api/v1/verify")
@limiter.limit(RATE_LIMIT_VERIFY)
async def verify_impact(
    request: Request,
    body:    VerifyImpactRequest,
    api_key: str = Security(verify_api_key),
) -> Dict[str, Any]:

    t_start = time.perf_counter()

    # ── Auto-ban check ─────────────────────────────────────────────────────────
    addr_lower = body.volunteer_address.lower()
    if redis_client.get(f"satin:banned:{addr_lower}"):
        raise HTTPException(
            status_code=403,
            detail="Address is BANNED due to repeated fraudulent/manipulative submissions."
        )

    # ── Decode image ───────────────────────────────────────────────────────────
    image_bytes: Optional[bytes] = None
    if body.image_base64:
        try:
            image_bytes = base64.b64decode(body.image_base64)
            log.info(f"Image received — {len(image_bytes):,} bytes")
        except Exception as e:
            log.warning(f"Failed to decode image_base64: {e}")

    # ── Run CV verification early to get YOLO results for param validator ──────
    yolo_result: Dict[str, Any] = {}
    person_count_yolo: Optional[int] = None
    detected_objects: Optional[list] = None

    if image_bytes:
        try:
            yolo_result      = evaluator.cv_verifier.verify_image_from_bytes(image_bytes)
            detected_objects = yolo_result.get("detected_objects", [])
            # Count person detections from raw boxes (more accurate than just presence check)
            # The CV verifier returns detected_objects as a SET (unique), so we use
            # a separate count from the raw result if available, else estimate from presence
            person_count_yolo = yolo_result.get("person_count", 1 if "person" in (detected_objects or []) else 0)
            log.info(
                f"[CV-EARLY] confidence={yolo_result.get('confidence',0):.2%} "
                f"objects={detected_objects} person_count={person_count_yolo}"
            )
        except Exception as e:
            log.warning(f"[CV-EARLY] Early YOLO failed: {e}")

    # ═══════════════════════════════════════════════════════════════════════════
    # LAYER 1: FRAUD / SYBIL DETECTION (unchanged)
    # ═══════════════════════════════════════════════════════════════════════════
    source = body.source or "gallery"
    fraud_result = fraud_detector.check_all(
        volunteer_address = body.volunteer_address,
        hash_sha256       = body.hash_sha256,
        image_bytes       = image_bytes,
        submit_lat        = body.gps.latitude,
        submit_lon        = body.gps.longitude,
        source            = source,
    )
    if not fraud_result["ok"]:
        reason = fraud_result["reason"]
        raise HTTPException(
            status_code=429 if "Rate limit" in reason else 409,
            detail=reason,
        )

    integrity_warnings   = fraud_result.get("warnings", [])
    authenticity_penalty = fraud_result.get("authenticity_penalty", 0.0)
    is_high_risk         = fraud_result.get("is_high_risk", False)

    # ═══════════════════════════════════════════════════════════════════════════
    # LAYER 2: PARAMETER INTEGRITY VALIDATION (NEW v1.3.0)
    # ═══════════════════════════════════════════════════════════════════════════
    description_text = body.description or ""
    param_result = param_validator.validate(
        action_type        = body.action_type.value,
        urgency_level      = body.urgency_level.upper(),
        effort_hours       = body.effort_hours,
        people_helped      = body.people_helped,
        description        = description_text,
        detected_objects   = detected_objects,
        person_count_yolo  = person_count_yolo,
        image_bytes        = image_bytes,
    )

    # Hard block from parameter validation
    if param_result.hard_blocked:
        # Record streak
        streak = _record_param_manipulation(body.volunteer_address, "hard_block")
        if streak >= PARAM_MANIP_STREAK_BAN:
            redis_client.set(f"satin:banned:{addr_lower}", "true")
            log.warning(f"[BAN] {addr_lower} auto-banned after {streak} parameter manipulation attempts")
        raise HTTPException(
            status_code=422,
            detail=f"Parameter Integrity Violation: {param_result.block_reason}",
        )

    # Log and track parameter violations even if not hard-blocked
    if param_result.total_penalty > 0.20:
        streak = _record_param_manipulation(body.volunteer_address, "soft_penalty")
        if streak >= PARAM_MANIP_STREAK_BAN:
            redis_client.set(f"satin:banned:{addr_lower}", "true")
            log.warning(f"[BAN] {addr_lower} auto-banned after {streak} parameter manipulation attempts")

    # Apply adjusted parameters to prevent score gaming
    effective_effort_hours = param_result.adjusted_effort_hours or body.effort_hours
    effective_people_helped = param_result.adjusted_people_helped or body.people_helped

    # Urgency downgrade if urgency was manipulated
    effective_urgency = body.urgency_level
    if "urgency_incompatible_with_action" in param_result.warnings or \
       "critical_urgency_without_context" in param_result.warnings or \
       "critical_urgency_banned_for_action" in param_result.warnings:
        # Downgrade urgency to the highest allowed for this action
        from engine.parameter_validator import ACTION_CONSTRAINTS
        constraint  = ACTION_CONSTRAINTS.get(body.action_type.value.upper(), {})
        allowed_urg = constraint.get("urgency_allowed", ["LOW", "MEDIUM", "HIGH"])
        urgency_rank = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
        max_allowed  = max(allowed_urg, key=lambda x: urgency_rank.get(x, 0))
        if urgency_rank.get(body.urgency_level.upper(), 4) > urgency_rank.get(max_allowed, 3):
            effective_urgency = max_allowed
            integrity_warnings.append(f"urgency_downgraded_to_{max_allowed.lower()}")
            log.warning(
                f"[PARAM] Urgency downgraded: {body.urgency_level} → {effective_urgency} "
                f"(action: {body.action_type.value})"
            )

    # Add parameter warnings to integrity_warnings
    integrity_warnings.extend([f"param_{w}" for w in param_result.warnings])

    # Combine penalties
    total_authenticity_penalty = min(
        0.85,
        authenticity_penalty + param_result.total_penalty
    )

    log.info(
        f"[PARAM_VALIDATOR] action={body.action_type.value} "
        f"penalty={param_result.total_penalty:.0%} "
        f"warnings={param_result.warnings} "
        f"llm_verdict={param_result.llm_verdict}"
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # LAYER 3: HIGH RISK CLAMPING (existing logic, enhanced)
    # ═══════════════════════════════════════════════════════════════════════════
    # Build evidence bundle with ADJUSTED (validated) parameters
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
        people_helped       = effective_people_helped,    # ← ADJUSTED
        volunteer_address   = body.volunteer_address,
        beneficiary_address = body.beneficiary_address,
        country_iso         = body.country_iso,
        description         = description_text,
        urgency_level       = effective_urgency,          # ← ADJUSTED
        effort_hours        = effective_effort_hours,     # ← ADJUSTED
    )

    if is_high_risk:
        log.warning(
            f"[FRAUD] HIGH RISK FLAG! Clamping: "
            f"effort={evidence.effort_hours}→min(1.0), "
            f"people={evidence.people_helped}→min(2), urgency→LOW"
        )
        evidence.effort_hours  = min(evidence.effort_hours, 1.0)
        evidence.people_helped = min(evidence.people_helped, 2)
        evidence.urgency_level = "LOW"
        integrity_warnings.append("high_risk_multipliers_clamped")

    # Capture timestamp freshness
    if body.source == "live_capture" and body.capture_timestamp:
        age_ms  = int(time.time() * 1000) - body.capture_timestamp
        age_min = age_ms / 60_000
        if age_min > 15:
            log.warning(f"[TIMESTAMP] Live capture is {age_min:.1f} min old")
            integrity_warnings.append(f"capture_stale_{int(age_min)}min")
            total_authenticity_penalty = min(1.0, total_authenticity_penalty + 0.10)

    # ═══════════════════════════════════════════════════════════════════════════
    # LAYER 4: ORACLE EVALUATION
    # ═══════════════════════════════════════════════════════════════════════════
    try:
        payload: OraclePayload = evaluator.evaluate(evidence, image_bytes=image_bytes)

    except EvaluationFailedError as eval_err:
        err_msg = str(eval_err)
        if "Insufficient impact" in err_msg:
            log.warning(f"[STREAM] Low score → community review: {err_msg}")
            event_id = str(uuid.uuid4())
            low_score_entry = {
                "event_id":               event_id,
                "volunteer_address":      body.volunteer_address,
                "action_type":            body.action_type,
                "urgency_level":          effective_urgency,
                "description":            description_text,
                "latitude":               body.gps.latitude,
                "longitude":              body.gps.longitude,
                "effort_hours":           effective_effort_hours,
                "people_helped":          effective_people_helped,
                "impact_score":           round(eval_err.impact_score, 2),
                "ai_confidence":          round(eval_err.ai_confidence, 4),
                "token_reward":           0.0,
                "source":                 source,
                "image_base64":           body.image_base64,
                "integrity_warnings":     integrity_warnings + ["impact_below_threshold"],
                "parameter_warnings":     param_result.warnings,
                "needs_community_review": True,
                "needs_champion_audit":   is_high_risk or body.urgency_level == "CRITICAL",
                "submitted_at":           int(time.time()),
            }
            redis_client.lpush("satin:stream_store", json.dumps(low_score_entry))
            redis_client.ltrim("satin:stream_store", 0, 99)
            vote_data = {
                "votes":     {},
                "opened_at": int(time.time()),
                "outcome":   None,
                "needs_champion_audit": is_high_risk or body.urgency_level == "CRITICAL",
            }
            redis_client.set(f"satin:vote_store:{event_id}", json.dumps(vote_data))
            return {
                "event_id":                event_id,
                "impact_score":            round(eval_err.impact_score, 2),
                "ai_confidence":           round(eval_err.ai_confidence, 4),
                "token_reward":            0.0,
                "integrity_warnings":      low_score_entry["integrity_warnings"],
                "authenticity_penalty":    total_authenticity_penalty,
                "parameter_warnings":      param_result.warnings,
                "parameter_penalty":       round(param_result.total_penalty, 3),
                "adjusted_people_helped":  effective_people_helped,
                "adjusted_effort_hours":   effective_effort_hours,
                "llm_verdict":             param_result.llm_verdict,
                "needs_community_review":  True,
                "contract_args":           None,
                "processing_time_ms":      round((time.perf_counter() - t_start) * 1000, 2),
            }
        raise

    # ── Apply parameter penalty to final impact score ─────────────────────────
    # The oracle computed a raw score; we reduce it by total_authenticity_penalty
    if total_authenticity_penalty > 0:
        original_score = payload.impact_score
        # Apply penalty multiplicatively — more intuitive than subtractive
        adjusted_score = round(original_score * (1.0 - total_authenticity_penalty), 4)
        payload.impact_score = max(0.0, adjusted_score)
        log.info(
            f"[SCORE_ADJUST] {original_score:.2f} × (1 - {total_authenticity_penalty:.2%}) "
            f"= {payload.impact_score:.2f}"
        )

    processing_ms = round((time.perf_counter() - t_start) * 1000, 2)

    # ── Community Stream ───────────────────────────────────────────────────────
    needs_champion_audit = is_high_risk or (
        body.urgency_level == "CRITICAL" and payload.ai_confidence < 0.60
    )
    # Flag for community review if: low confidence OR high param penalty OR LLM flagged
    needs_review = (
        payload.ai_confidence < COMMUNITY_REVIEW_CONFIDENCE
        or needs_champion_audit
        or param_result.total_penalty >= 0.30
        or param_result.llm_verdict in ("suspicious", "fabricated")
    )

    stream_entry = {
        "event_id":              payload.event_id,
        "volunteer_address":     body.volunteer_address,
        "action_type":           body.action_type,
        "urgency_level":         effective_urgency,
        "description":           description_text,
        "latitude":              body.gps.latitude,
        "longitude":             body.gps.longitude,
        "effort_hours":          effective_effort_hours,
        "people_helped":         effective_people_helped,
        "impact_score":          round(payload.impact_score, 2),
        "ai_confidence":         round(payload.ai_confidence, 4),
        "token_reward":          round(payload.token_reward, 4),
        "source":                source,
        "image_base64":          body.image_base64 if body.image_base64 else None,
        "integrity_warnings":    integrity_warnings,
        "parameter_warnings":    param_result.warnings,
        "llm_verdict":           param_result.llm_verdict,
        "needs_community_review": needs_review,
        "needs_champion_audit":  needs_champion_audit,
        "submitted_at":          int(time.time()),
    }
    redis_client.lpush("satin:stream_store", json.dumps(stream_entry))
    redis_client.ltrim("satin:stream_store", 0, 99)

    if needs_review:
        vote_data = {
            "votes":     {},
            "opened_at": int(time.time()),
            "outcome":   None,
            "needs_champion_audit": needs_champion_audit,
        }
        redis_client.set(f"satin:vote_store:{payload.event_id}", json.dumps(vote_data))

    # Record successful submission
    fraud_detector.record_sha256(body.hash_sha256, body.volunteer_address)
    fraud_detector.record_submission(body.volunteer_address)
    # Reset parameter manipulation streak on clean submission
    if param_result.total_penalty < 0.10:
        redis_client.delete(f"satin:param_manip_streak:{addr_lower}")

    return {
        **_payload_to_dict(payload),
        "contract_args":           payload.to_contract_args(),
        "processing_time_ms":      processing_ms,
        "integrity_warnings":      integrity_warnings,
        "authenticity_penalty":    total_authenticity_penalty,
        "parameter_warnings":      param_result.warnings,
        "parameter_penalty":       round(param_result.total_penalty, 3),
        "adjusted_people_helped":  effective_people_helped,
        "adjusted_effort_hours":   effective_effort_hours,
        "llm_verdict":             param_result.llm_verdict,
        "needs_community_review":  needs_review,
    }


@app.post("/api/v1/verify/batch", summary="Batch Verify Impact Events")
async def batch_verify(
    request: Request,
    body:    BatchVerifyRequest,
    api_key: str = Depends(verify_api_key),
) -> Dict[str, Any]:
    results = []
    for event in body.events:
        try:
            response = await verify_impact(request, event, api_key)
            results.append({"success": True, "data": response})
        except HTTPException as e:
            results.append({"success": False, "error": e.detail})
    return {"total": len(results), "results": results}


# ─── Community Stream ─────────────────────────────────────────────────────────
@app.get("/api/v1/stream")
async def get_stream(api_key: str = Security(verify_api_key)) -> Dict[str, Any]:
    feed_raw = redis_client.lrange("satin:stream_store", 0, 49)
    feed     = [json.loads(item) for item in feed_raw]
    enriched = []
    for entry in feed:
        e   = dict(entry)
        eid = e["event_id"]
        vd_raw = redis_client.get(f"satin:vote_store:{eid}")
        if vd_raw:
            vd      = json.loads(vd_raw)
            votes   = vd["votes"]
            approve = sum(1 for v in votes.values() if v == "approve")
            reject  = sum(1 for v in votes.values() if v == "reject")
            age_sec = int(time.time()) - vd["opened_at"]
            e["vote_info"] = {
                "approve":   approve,
                "reject":    reject,
                "total":     len(votes),
                "outcome":   vd["outcome"],
                "phase":     1 if age_sec < VOTE_PHASE2_DELAY_SEC else 2,
                "phase2_in": max(0, VOTE_PHASE2_DELAY_SEC - age_sec),
                "voters":    list(votes.keys()),
            }
        enriched.append(e)
    return {"count": len(enriched), "items": enriched}


class VoteRequest(BaseModel):
    event_id:         str
    voter_address:    str
    vote:             str
    reputation_score: float


@app.post("/api/v1/vote")
async def cast_vote(body: VoteRequest, api_key: str = Security(verify_api_key)) -> Dict[str, Any]:
    eid    = body.event_id
    vd_raw = redis_client.get(f"satin:vote_store:{eid}")
    if not vd_raw:
        raise HTTPException(status_code=404, detail="Submission not flagged for community review.")
    vd = json.loads(vd_raw)
    if body.vote not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="vote must be 'approve' or 'reject'.")
    if vd["outcome"]:
        raise HTTPException(status_code=409, detail=f"Voting concluded: {vd['outcome']}.")

    reputation_score = body.reputation_score
    _rpc_url     = os.getenv("APEX_RPC_URL", "")
    _ledger_addr = os.getenv("REPUTATION_LEDGER_ADDRESS", "")
    if _rpc_url and _ledger_addr:
        try:
            from web3 import Web3 as _Web3
            _LEDGER_ABI = [{"inputs":[{"internalType":"address","name":"volunteer","type":"address"}],"name":"getReputation","outputs":[{"internalType":"uint256","name":"cumulativeScore","type":"uint256"},{"internalType":"uint256","name":"eventCount","type":"uint256"},{"internalType":"uint256","name":"lastUpdatedAt","type":"uint256"},{"internalType":"uint256","name":"rank","type":"uint256"}],"stateMutability":"view","type":"function"}]
            _w3       = _Web3(_Web3.HTTPProvider(_rpc_url, request_kwargs={"timeout": 5}))
            _contract = _w3.eth.contract(address=_Web3.to_checksum_address(_ledger_addr), abi=_LEDGER_ABI)
            cumulative, _, _, _ = _contract.functions.getReputation(_Web3.to_checksum_address(body.voter_address)).call()
            reputation_score = cumulative / 100.0
        except Exception as rpc_err:
            log.warning(f"[VOTE] On-chain rep check failed: {rpc_err}")

    needs_champion_audit = vd.get("needs_champion_audit", False)
    age_sec = int(time.time()) - vd["opened_at"]
    if needs_champion_audit:
        if reputation_score < CHAMPION_REPUTATION_THRESHOLD:
            raise HTTPException(status_code=403, detail=f"Exclusive Audit: CHAMPION+ only (rep ≥ {CHAMPION_REPUTATION_THRESHOLD}).")
    else:
        if age_sec < VOTE_PHASE2_DELAY_SEC and reputation_score < CHAMPION_REPUTATION_THRESHOLD:
            phase2_in = VOTE_PHASE2_DELAY_SEC - age_sec
            raise HTTPException(status_code=403, detail=f"Phase 1: CHAMPION+ only. Open voting in {phase2_in//60}m {phase2_in%60}s.")

    voter = body.voter_address.lower()
    feed_raw     = redis_client.lrange("satin:stream_store", 0, -1)
    stream_entry = None
    for item in feed_raw:
        entry = json.loads(item)
        if entry["event_id"] == eid:
            stream_entry = entry
            break
    if stream_entry and voter == stream_entry["volunteer_address"].lower():
        raise HTTPException(status_code=403, detail="You cannot vote on your own submission.")
    if voter in vd["votes"]:
        raise HTTPException(status_code=409, detail="Already voted.")

    vd["votes"][voter] = body.vote
    votes   = vd["votes"]
    approve = sum(1 for v in votes.values() if v == "approve")
    reject  = sum(1 for v in votes.values() if v == "reject")
    outcome = None
    if len(votes) >= VOTE_QUORUM:
        outcome = "approved" if approve > reject else "rejected"
        vd["outcome"] = outcome
        if outcome == "approved" and "claim_payload" not in vd and stream_entry:
            try:
                payload_dict, contract_args = _build_community_claim_payload(stream_entry)
                vd["claim_payload"]       = payload_dict
                vd["claim_contract_args"] = contract_args
            except Exception as ce:
                log.error(f"[VOTE] Failed to build claim payload: {ce}")
            vol_addr = stream_entry["volunteer_address"].lower()
            redis_client.delete(f"satin:reject_streak:{vol_addr}")
            redis_client.delete(f"satin:param_manip_streak:{vol_addr}")
        elif outcome == "rejected" and stream_entry:
            vol_addr   = stream_entry["volunteer_address"].lower()
            streak_key = f"satin:reject_streak:{vol_addr}"
            streak     = redis_client.incr(streak_key)
            redis_client.expire(streak_key, 7 * 24 * 3600)
            if streak >= 3:
                redis_client.set(f"satin:banned:{vol_addr}", "true")
                log.warning(f"[BAN] {vol_addr} banned after 3 community rejections")
    redis_client.set(f"satin:vote_store:{eid}", json.dumps(vd))
    return {"event_id": eid, "your_vote": body.vote, "approve": approve, "reject": reject, "total": len(votes), "outcome": outcome}


@app.get("/api/v1/vote/claim/{event_id}")
async def get_claim(event_id: str, api_key: str = Security(verify_api_key)) -> Dict[str, Any]:
    vd_raw = redis_client.get(f"satin:vote_store:{event_id}")
    if not vd_raw:
        raise HTTPException(status_code=404, detail="Event not found.")
    vd = json.loads(vd_raw)
    if vd.get("outcome") != "approved":
        raise HTTPException(status_code=409, detail=f"Vote outcome: '{vd.get('outcome')}', not 'approved'.")
    if "claim_payload" not in vd:
        feed_raw     = redis_client.lrange("satin:stream_store", 0, -1)
        stream_entry = None
        for item in feed_raw:
            entry = json.loads(item)
            if entry["event_id"] == event_id:
                stream_entry = entry
                break
        if not stream_entry:
            raise HTTPException(status_code=503, detail="Stream entry not found.")
        try:
            payload_dict, contract_args = _build_community_claim_payload(stream_entry)
            vd["claim_payload"]         = payload_dict
            vd["claim_contract_args"]   = contract_args
            redis_client.set(f"satin:vote_store:{event_id}", json.dumps(vd))
        except Exception as ce:
            raise HTTPException(status_code=503, detail=f"Cannot generate claim: {ce}")
    return {**vd["claim_payload"], "contract_args": vd["claim_contract_args"]}


@app.get("/api/v1/oracle/info")
async def oracle_info(_: str = Depends(verify_api_key)) -> Dict[str, Any]:
    return {
        "oracle_address":      evaluator._signer.oracle_address,
        "protocol":            "APEX HUMANITY — SATIN v1.3.0",
        "supported_actions":   [a.value for a in ActionType],
        "rate_limit":          RATE_LIMIT_VERIFY,
        "allowed_origins":     ALLOWED_ORIGINS,
        "score_weights":       {"urgency": 0.35, "difficulty": 0.25, "reach": 0.20, "authenticity": 0.20},
        "base_token_reward":   100.0,
        "min_score_threshold": 30.0,
        "signing_algorithm":   "ECDSA secp256k1",
        "llm_validator":       bool(os.getenv("ANTHROPIC_API_KEY")),
        "integrity_layers": [
            "sha256_exact_dedup",
            "perceptual_hash_sybil",
            "exif_timestamp_validation",
            "exif_gps_mismatch_detection",
            "ela_manipulation_detection",
            "live_capture_timestamp_freshness",
            "param_action_constraint_matrix",       # NEW v1.3.0
            "param_effort_people_ratio_check",      # NEW v1.3.0
            "param_urgency_action_compatibility",   # NEW v1.3.0
            "param_description_keyword_validation", # NEW v1.3.0
            "param_yolo_person_count_triangulation",# NEW v1.3.0
            "param_llm_cross_validator",            # NEW v1.3.0
        ],
    }