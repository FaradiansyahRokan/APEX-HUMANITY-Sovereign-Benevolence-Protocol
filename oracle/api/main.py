"""
APEX HUMANITY — SATIN Oracle API Gateway
FastAPI server exposing the ImpactEvaluator to the dApp and smart contracts.

v2.0.0 — Autonomous AI Deduction (AAD) Architecture
=====================================================
PERUBAHAN FUNDAMENTAL:
  - User TIDAK LAGI mengisi slider people_helped, effort_hours, action_type, urgency
  - User hanya submit: foto + deskripsi bebas + GPS
  - YOLOv8m + LLaVA yang MENYIMPULKAN semua parameter secara otomatis
  - Reward TIDAK keluar jika total penalty > 0.60 (hard threshold)
  - Reward dihitung dari AI-deduced score, bukan user-claimed score
  - Zero loophole: tidak ada parameter yang bisa dimanipulasi user

v1.3.0 — Parameter Integrity (deprecated, replaced by AAD)
v1.2.0 — Data Integrity Update
v1.1.0 — CORS, Rate limiting, GPSCoordinatesInput
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

# v2.0.0 — Hard reward gate: penalty > ini → reward = 0, tidak ada partial
REWARD_GATE_MAX_PENALTY       = 0.60   # > 60% penalty → no reward at all
PARAM_MANIP_STREAK_BAN        = 3

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
from engine.parameter_validator import ParameterValidator, deduce_parameters_from_ai

load_dotenv()

# ─── Setup ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("satin.api")

ORACLE_API_KEY = os.getenv("ORACLE_API_KEY", "apex-dev-key-change-in-prod")
API_KEY_HEADER = APIKeyHeader(name="X-APEX-Oracle-Key", auto_error=True)

RATE_LIMIT_VERIFY = os.getenv("RATE_LIMIT_VERIFY", "5/minute")
limiter           = Limiter(key_func=get_remote_address)

evaluator       = ImpactEvaluator(private_key_hex=os.getenv("ORACLE_PRIVATE_KEY"))
fraud_detector  = FraudDetector()
param_validator = ParameterValidator()

app = FastAPI(
    title       = "APEX HUMANITY — SATIN Oracle API",
    description = "AI Oracle for Proof of Beneficial Action (PoBA) — AAD v2.0",
    version     = "2.0.0",
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
        warnings_found.append("NO ORACLE_PRIVATE_KEY SET — ephemeral key in use.")
    if not api_key_val or api_key_val == DEFAULT_KEY:
        warnings_found.append("DEFAULT API KEY IN USE.")
    for w in warnings_found:
        log.critical(f"\n{'='*70}\n⚠️  SECURITY WARNING: {w}\n{'='*70}")
    if not warnings_found:
        log.info("✅ Startup validation passed — SATIN AAD v2.0.0 ready.")

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


# ─── Request / Response Models (v2.0 — simplified input) ─────────────────────
class GPSInput(BaseModel):
    latitude:        float
    longitude:       float
    accuracy_meters: float = 10.0


class VerifyImpactRequest(BaseModel):
    """
    v2.0.0 — Input sangat disederhanakan.
    User HANYA mengisi: deskripsi bebas + GPS + foto.
    TIDAK ADA: action_type, urgency_level, effort_hours, people_helped dari user.
    Semua parameter tersebut DIDEDUCED oleh AI.
    """
    # Required
    description:         str            # Deskripsi bebas, natural language
    gps:                 GPSInput
    volunteer_address:   str
    beneficiary_address: str

    # Photo evidence
    image_base64:        Optional[str]  = Field(default=None)
    hash_sha256:         str            = "0" * 64
    ipfs_cid:            str            = "text-only"
    evidence_type:       str            = "image"
    source:              str            = Field(default="gallery", description="'live_capture' | 'gallery'")
    capture_timestamp:   Optional[int]  = Field(default=None)
    country_iso:         str            = "ID"


class ImpactScoreResponse(BaseModel):
    event_id:             str
    status:               str
    impact_score:         float
    ai_confidence:        float
    token_reward:         float
    oracle_address:       str
    zk_proof_hash:        str
    event_hash:           str
    nonce:                str
    issued_at:            int
    expires_at:           int
    score_breakdown:      Dict[str, float]
    signature:            Dict[str, str]
    contract_args:        Dict[str, Any]
    processing_time_ms:   float
    integrity_warnings:   List[str]
    authenticity_penalty: float
    # v2.0 — AI deduced fields (shown to user for transparency)
    ai_deduced:           Dict[str, Any]
    needs_community_review: bool


# ─── Helper: payload → dict ───────────────────────────────────────────────────
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
    return payload_dict, contract_args


# ─── Ban helpers ──────────────────────────────────────────────────────────────
def _record_fraud_attempt(volunteer_address: str, reason: str) -> int:
    addr      = volunteer_address.lower()
    streak_key = f"satin:fraud_streak:{addr}"
    streak     = redis_client.incr(streak_key)
    redis_client.expire(streak_key, 7 * 24 * 3600)
    log.warning(f"[FRAUD_STREAK] {addr} streak={streak} reason={reason}")
    return streak


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status":         "operational",
        "oracle_address": evaluator._signer.oracle_address,
        "version":        "2.0.0-AAD",
        "timestamp":      int(time.time()),
        "architecture":   "Autonomous AI Deduction — no user sliders",
        "features": {
            "aad_enabled":          True,
            "llava_deduction":      True,
            "yolo_triangulation":   True,
            "exif_check":           True,
            "ela_check":            True,
            "reward_gate":          f"penalty > {REWARD_GATE_MAX_PENALTY:.0%} → reward=0",
        }
    }


@app.get("/api/v1/challenge")
async def get_challenge(api_key: str = Security(verify_api_key)) -> Dict[str, Any]:
    now        = int(time.time())
    code       = f"APEX-{secrets.randbelow(9000) + 1000}"
    expires_at = now + 600
    redis_client.setex(f"satin:challenge:{code}", 600, expires_at)
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

    t_start    = time.perf_counter()
    addr_lower = body.volunteer_address.lower()

    # ── Ban check ──────────────────────────────────────────────────────────────
    if redis_client.get(f"satin:banned:{addr_lower}"):
        raise HTTPException(
            status_code=403,
            detail="Address is BANNED due to repeated fraudulent submissions."
        )

    # ── Decode image ───────────────────────────────────────────────────────────
    image_bytes: Optional[bytes] = None
    if body.image_base64:
        try:
            image_bytes = base64.b64decode(body.image_base64)
            log.info(f"[AAD] Image received — {len(image_bytes):,} bytes")
        except Exception as e:
            log.warning(f"Failed to decode image_base64: {e}")

    # ── STEP 1: Run YOLO first (fast, no LLM yet) ─────────────────────────────
    yolo_result: Dict[str, Any] = {}
    if image_bytes:
        try:
            yolo_result = evaluator.cv_verifier.verify_image_from_bytes(image_bytes)
            log.info(
                f"[YOLO] confidence={yolo_result.get('confidence',0):.2%} "
                f"people={yolo_result.get('person_count',0)} "
                f"objects={yolo_result.get('detected_objects',[])} "
            )
        except Exception as e:
            log.warning(f"[YOLO] Failed: {e}")

    # ── STEP 2: Fraud & Sybil Detection ───────────────────────────────────────
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

    # ── STEP 3: AI DEDUCTION — Core AAD engine ────────────────────────────────
    # LLaVA + YOLO menyimpulkan semua parameter. Tidak ada user input untuk scoring.
    log.info(f"[AAD] Starting AI parameter deduction for {addr_lower}...")
    
    deduction = deduce_parameters_from_ai(
        description  = body.description,
        image_bytes  = image_bytes,
        yolo_result  = yolo_result,
        source       = source,
    )

    # ── STEP 4: Validate AI deduction output ─────────────────────────────────
    param_result = param_validator.validate_ai_deduction(deduction)

    if param_result.hard_blocked:
        streak = _record_fraud_attempt(body.volunteer_address, "ai_deduction_fraud")
        if streak >= PARAM_MANIP_STREAK_BAN:
            redis_client.set(f"satin:banned:{addr_lower}", "true")
        raise HTTPException(
            status_code=422,
            detail=f"AI mendeteksi submission tidak valid: {param_result.block_reason}",
        )

    # Combine all penalties
    total_penalty = min(0.85, authenticity_penalty + param_result.total_penalty)

    # ── REWARD GATE: Hard threshold ────────────────────────────────────────────
    # v2.0 FIX: Jika penalty terlalu tinggi, reward = 0 dan masuk community review
    # Tidak ada lagi "kena penalti tapi tetap dapat reward"
    reward_gated = total_penalty >= REWARD_GATE_MAX_PENALTY
    if reward_gated:
        integrity_warnings.append(f"reward_gated_penalty_{total_penalty:.0%}")
        log.warning(
            f"[REWARD_GATE] {addr_lower}: penalty={total_penalty:.0%} "
            f"≥ threshold={REWARD_GATE_MAX_PENALTY:.0%} → reward=0"
        )

    # ── STEP 5: Build Evidence Bundle dari AI-deduced params ──────────────────
    # PENTING: Semua nilai berasal dari AI, bukan user input
    try:
        effective_action_type  = ActionType(deduction.action_type)
    except ValueError:
        effective_action_type  = ActionType.FOOD_DISTRIBUTION

    # Jika CRITICAL tapi AI confidence rendah → downgrade ke HIGH
    effective_urgency = deduction.urgency_level
    if deduction.urgency_level == "CRITICAL" and deduction.confidence < 0.60:
        effective_urgency = "HIGH"
        integrity_warnings.append("urgency_downgraded_low_confidence")

    evidence = EvidenceBundle(
        ipfs_cid            = body.ipfs_cid,
        evidence_type       = body.evidence_type,
        hash_sha256         = body.hash_sha256,
        gps                 = GPSCoordinatesInput(
            latitude        = body.gps.latitude,
            longitude       = body.gps.longitude,
            accuracy_meters = body.gps.accuracy_meters,
        ),
        action_type         = effective_action_type,
        people_helped       = deduction.final_people_helped,   # ← AI deduced
        volunteer_address   = body.volunteer_address,
        beneficiary_address = body.beneficiary_address,
        country_iso         = body.country_iso,
        description         = body.description,
        urgency_level       = effective_urgency,               # ← AI deduced
        effort_hours        = deduction.final_effort_hours,    # ← AI deduced
    )

    # Extra clamp for high-risk submissions
    if is_high_risk:
        evidence.effort_hours  = min(evidence.effort_hours, 1.0)
        evidence.people_helped = min(evidence.people_helped, 2)
        evidence.urgency_level = "LOW"
        integrity_warnings.append("high_risk_params_clamped")

    # Capture timestamp freshness
    if source == "live_capture" and body.capture_timestamp:
        age_ms  = int(time.time() * 1000) - body.capture_timestamp
        age_min = age_ms / 60_000
        if age_min > 15:
            integrity_warnings.append(f"capture_stale_{int(age_min)}min")
            total_penalty = min(1.0, total_penalty + 0.10)

    # ── STEP 6: Oracle Evaluation ──────────────────────────────────────────────
    try:
        payload: OraclePayload = evaluator.evaluate(evidence, image_bytes=image_bytes)

    except EvaluationFailedError as eval_err:
        # Low score → community review
        event_id = str(uuid.uuid4())
        low_score_entry = {
            "event_id":               event_id,
            "volunteer_address":      body.volunteer_address,
            "action_type":            effective_action_type.value,
            "urgency_level":          effective_urgency,
            "description":            body.description,
            "latitude":               body.gps.latitude,
            "longitude":              body.gps.longitude,
            "effort_hours":           deduction.final_effort_hours,
            "people_helped":          deduction.final_people_helped,
            "impact_score":           round(eval_err.impact_score, 2),
            "ai_confidence":          round(eval_err.ai_confidence, 4),
            "token_reward":           0.0,
            "source":                 source,
            "image_base64":           body.image_base64,
            "integrity_warnings":     integrity_warnings + ["impact_below_threshold"],
            "ai_deduced": {
                "action_type":    deduction.action_type,
                "urgency_level":  deduction.urgency_level,
                "people_helped":  deduction.final_people_helped,
                "effort_hours":   deduction.final_effort_hours,
                "confidence":     deduction.confidence,
                "scene_context":  deduction.scene_context,
                "fraud_indicators": deduction.fraud_indicators,
            },
            "needs_community_review": True,
            "needs_champion_audit":   is_high_risk or deduction.urgency_level == "CRITICAL",
            "submitted_at":           int(time.time()),
        }
        redis_client.lpush("satin:stream_store", json.dumps(low_score_entry))
        redis_client.ltrim("satin:stream_store", 0, 99)
        vote_data = {
            "votes":     {},
            "opened_at": int(time.time()),
            "outcome":   None,
            "needs_champion_audit": is_high_risk,
        }
        redis_client.set(f"satin:vote_store:{event_id}", json.dumps(vote_data))
        return {
            "event_id":               event_id,
            "impact_score":           round(eval_err.impact_score, 2),
            "ai_confidence":          round(eval_err.ai_confidence, 4),
            "token_reward":           0.0,
            "integrity_warnings":     low_score_entry["integrity_warnings"],
            "authenticity_penalty":   total_penalty,
            "ai_deduced":             low_score_entry["ai_deduced"],
            "needs_community_review": True,
            "contract_args":          None,
            "processing_time_ms":     round((time.perf_counter() - t_start) * 1000, 2),
        }

    # ── STEP 7: Apply penalty to score ────────────────────────────────────────
    original_score = payload.impact_score
    if total_penalty > 0:
        adjusted_score       = round(original_score * (1.0 - total_penalty), 4)
        payload.impact_score = max(0.0, adjusted_score)
        log.info(
            f"[SCORE] {original_score:.2f} × (1-{total_penalty:.2%}) "
            f"= {payload.impact_score:.2f}"
        )

    # ── STEP 8: Apply Reward Gate ──────────────────────────────────────────────
    # v2.0 FIX: Reward harus nol jika penalty terlalu tinggi
    # Token reward dihitung ulang dari adjusted score, bukan original
    if reward_gated:
        payload.token_reward = 0.0
        log.warning(f"[REWARD_GATE] Token reward set to 0 — submission masuk community review")
    else:
        # Recalculate token reward from adjusted (penalized) score
        score_normalized     = payload.impact_score / 100.0
        payload.token_reward = round(5.0 + (score_normalized ** 1.5) * 45.0, 4)
        payload.token_reward = min(payload.token_reward, 100.0)

    processing_ms = round((time.perf_counter() - t_start) * 1000, 2)

    # ── Community Stream ───────────────────────────────────────────────────────
    needs_review = (
        payload.ai_confidence < COMMUNITY_REVIEW_CONFIDENCE
        or is_high_risk
        or reward_gated
        or len(deduction.fraud_indicators) > 0
    )

    ai_deduced_info = {
        "action_type":      deduction.action_type,
        "urgency_level":    effective_urgency,
        "people_helped":    deduction.final_people_helped,
        "effort_hours":     deduction.final_effort_hours,
        "confidence":       round(deduction.confidence, 3),
        "scene_context":    deduction.scene_context,
        "yolo_person_count": deduction.yolo_person_count,
        "fraud_indicators": deduction.fraud_indicators,
        "reasoning":        deduction.reasoning,
    }

    stream_entry = {
        "event_id":              payload.event_id,
        "volunteer_address":     body.volunteer_address,
        "action_type":           effective_action_type.value,
        "urgency_level":         effective_urgency,
        "description":           body.description,
        "latitude":              body.gps.latitude,
        "longitude":             body.gps.longitude,
        "effort_hours":          deduction.final_effort_hours,
        "people_helped":         deduction.final_people_helped,
        "impact_score":          round(payload.impact_score, 2),
        "ai_confidence":         round(payload.ai_confidence, 4),
        "token_reward":          round(payload.token_reward, 4),
        "source":                source,
        "image_base64":          body.image_base64,
        "integrity_warnings":    integrity_warnings,
        "ai_deduced":            ai_deduced_info,
        "needs_community_review": needs_review,
        "submitted_at":          int(time.time()),
    }
    redis_client.lpush("satin:stream_store", json.dumps(stream_entry))
    redis_client.ltrim("satin:stream_store", 0, 99)

    if needs_review:
        vote_data = {
            "votes":     {},
            "opened_at": int(time.time()),
            "outcome":   None,
            "needs_champion_audit": is_high_risk,
        }
        redis_client.set(f"satin:vote_store:{payload.event_id}", json.dumps(vote_data))

    # Record fraud detector
    fraud_detector.record_sha256(body.hash_sha256, body.volunteer_address)
    fraud_detector.record_submission(body.volunteer_address)

    return {
        **_payload_to_dict(payload),
        "contract_args":          payload.to_contract_args(),
        "processing_time_ms":     processing_ms,
        "integrity_warnings":     integrity_warnings,
        "authenticity_penalty":   total_penalty,
        "ai_deduced":             ai_deduced_info,
        "needs_community_review": needs_review,
    }


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
            redis_client.delete(f"satin:fraud_streak:{vol_addr}")
        elif outcome == "rejected" and stream_entry:
            vol_addr   = stream_entry["volunteer_address"].lower()
            streak_key = f"satin:fraud_streak:{vol_addr}"
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
        payload_dict, contract_args = _build_community_claim_payload(stream_entry)
        vd["claim_payload"]         = payload_dict
        vd["claim_contract_args"]   = contract_args
        redis_client.set(f"satin:vote_store:{event_id}", json.dumps(vd))
    return {**vd["claim_payload"], "contract_args": vd["claim_contract_args"]}


@app.get("/api/v1/oracle/info")
async def oracle_info(_: str = Depends(verify_api_key)) -> Dict[str, Any]:
    return {
        "oracle_address":    evaluator._signer.oracle_address,
        "protocol":          "APEX HUMANITY — SATIN v2.0.0 AAD",
        "architecture":      "Autonomous AI Deduction — user input removed from scoring",
        "supported_actions": ["AI-deduced automatically from photo+description"],
        "rate_limit":        RATE_LIMIT_VERIFY,
        "reward_gate":       f"penalty > {REWARD_GATE_MAX_PENALTY:.0%} → reward=0",
        "integrity_layers": [
            "sha256_exact_dedup",
            "perceptual_hash_sybil",
            "exif_timestamp_validation",
            "ela_manipulation_detection",
            "llava_parameter_deduction",       
            "yolo_person_count_reconciliation",
            "ai_deduction_fraud_indicators",    
            "reward_gate_hard_threshold",       
            "token_reward_from_adjusted_score", 
        ],
    }