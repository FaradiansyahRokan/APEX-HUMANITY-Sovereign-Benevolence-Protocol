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
_challenge_store: dict[str, int] = {}

# ─── Community Stream store ───────────────────────────────────────────────────
# Keeps the last 100 verified submissions for the live feed.
_stream_store: list[dict] = []

# ─── Community Vote store ─────────────────────────────────────────────────────
# { event_id: { "votes": {addr: "approve"|"reject"}, "opened_at": unix, "outcome": None|"approved"|"rejected" } }
_vote_store: dict[str, dict] = {}

# Thresholds
COMMUNITY_REVIEW_CONFIDENCE = 0.30   # ai_confidence below this → flagged
CHAMPION_REPUTATION_THRESHOLD = 500  # minimum score for Phase 1 voting
VOTE_PHASE2_DELAY_SEC = 600           # 10 min before voting opens to all
VOTE_QUORUM = 3                       # minimum votes needed for outcome

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


# ─── Startup Validation ───────────────────────────────────────────────────────
@app.on_event("startup")
async def _startup_validation():
    """v1.2.0 — Check critical env vars at boot, not silently at runtime."""
    import os as _os  # local re-import for clarity

    private_key = _os.getenv("ORACLE_PRIVATE_KEY", "")
    api_key_val = _os.getenv("ORACLE_API_KEY", "")
    DEFAULT_KEY = "apex-dev-key-change-in-prod"

    warnings_found = []

    if not private_key:
        warnings_found.append(
            "NO ORACLE_PRIVATE_KEY SET — A RANDOM EPHEMERAL KEY IS BEING USED! "
            "The oracle address will change on every restart. "
            "Set ORACLE_PRIVATE_KEY in oracle/.env before going to production."
        )

    if not api_key_val or api_key_val == DEFAULT_KEY:
        warnings_found.append(
            f"DEFAULT API KEY IN USE ('{DEFAULT_KEY}'). "
            "Anyone who knows this default can submit arbitrary payloads. "
            "Set a strong ORACLE_API_KEY in oracle/.env before going to production."
        )

    for w in warnings_found:
        log.critical(f"\n{'='*70}\n⚠️  SECURITY WARNING: {w}\n{'='*70}")

    if not warnings_found:
        log.info("✅ Startup validation passed. Oracle key and API key are configured.")

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


# ─── Community claim payload builder ──────────────────────────────────────────
# Community-approved submissions get a fixed minimum reward to be transparent
# and fair, without re-running the evaluator with fake inflated values.
#
#   Impact score : 30.0 (minimum passing grade — community endorsement)
#   Token reward : 5.0 + (0.30^1.5) * 45.0 ≈ 12.4 APEX
#   Rationale    : Community vote is considered equivalent to the minimum
#                  oracle verification threshold. Fair and consistent.
#
COMMUNITY_CLAIM_IMPACT_SCORE = 30.0
COMMUNITY_CLAIM_TOKEN_REWARD = round(5.0 + (0.30 ** 1.5) * 45.0, 4)  # ≈ 12.4 APEX

def _build_community_claim_payload(stream_entry: dict) -> tuple[dict, dict]:
    """Build a directly-signed oracle payload for a community-approved submission.
    Returns (payload_dict, contract_args_dict)."""
    import hashlib as _hashlib
    from eth_abi import encode as abi_encode
    from web3 import Web3

    event_id         = stream_entry["event_id"]
    volunteer_addr   = stream_entry["volunteer_address"]
    impact_score     = COMMUNITY_CLAIM_IMPACT_SCORE
    token_reward     = COMMUNITY_CLAIM_TOKEN_REWARD
    impact_scaled    = int(impact_score * 100)      # 3000
    token_reward_wei = int(token_reward * 10 ** 18)

    now        = int(time.time())
    nonce      = uuid.uuid4().hex
    expires_at = now + 3600

    # Derive hashes consistent with evaluator pipeline
    event_id_hex   = event_id.replace("-", "")
    event_id_bytes = bytes.fromhex(event_id_hex.rjust(64, "0"))

    from engine.impact_evaluator import _keccak256 as _keccak
    zk_proof_hash = _keccak((volunteer_addr.lower() + event_id).encode())

    canonical_str = f"community-reviewed::{event_id}::{volunteer_addr.lower()}::{impact_score}"
    event_hash    = _keccak(canonical_str.encode()).hex()
    event_hash_bytes = bytes.fromhex(event_hash)

    # Build signing hash identical to BenevolenceVault._buildSigningHash()
    vol_addr = Web3.to_checksum_address(volunteer_addr)
    encoded = abi_encode(
        ["bytes32","address","address","uint256","uint256","bytes32","bytes32","string","uint256"],
        [event_id_bytes, vol_addr, vol_addr,
         impact_scaled, token_reward_wei,
         zk_proof_hash, event_hash_bytes,
         nonce, expires_at],
    )
    signing_hash = _keccak(encoded)
    sig = evaluator.signer.sign_payload_hash(signing_hash)

    payload_dict = {
        "event_id":        event_id,
        "status":          "VERIFIED",
        "impact_score":    impact_score,
        "ai_confidence":   0.0,   # was flagged — set to 0 for transparency
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


@app.post("/api/v1/verify")
@limiter.limit(RATE_LIMIT_VERIFY)
async def verify_impact(
    request:  Request,                          # required by slowapi
    body:     VerifyImpactRequest,
    api_key:  str = Security(verify_api_key),
) -> Dict[str, Any]:

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

        # ── Evaluate (may raise for low score OR low confidence) ──────────────
        try:
            payload: OraclePayload = evaluator.evaluate(evidence, image_bytes=image_bytes)
        except RuntimeError as eval_err:
            err_msg = str(eval_err)
            if "Insufficient impact" in err_msg:
                # Score too low for contract — route to community review
                log.warning(f"[STREAM] Low score → community review: {err_msg}")
                event_id = str(uuid.uuid4())
                low_score_entry = {
                    "event_id":               event_id,
                    "volunteer_address":      body.volunteer_address,
                    "action_type":            body.action_type,
                    "urgency_level":          body.urgency_level,
                    "description":            body.description or "",
                    "latitude":               body.gps.latitude,
                    "longitude":              body.gps.longitude,
                    "effort_hours":           body.effort_hours,
                    "people_helped":          body.people_helped,
                    "impact_score":           0.0,
                    "ai_confidence":          0.0,
                    "token_reward":           0.0,
                    "source":                 body.source,
                    "image_base64":           body.image_base64,
                    "integrity_warnings":     integrity_warnings + ["impact_below_threshold"],
                    "needs_community_review": True,
                    "submitted_at":           int(time.time()),
                }
                _stream_store.append(low_score_entry)
                if len(_stream_store) > 100:
                    _stream_store.pop(0)
                _vote_store[event_id] = {
                    "votes":     {},
                    "opened_at": int(time.time()),
                    "outcome":   None,
                }
                # Return a minimal response so frontend shows community review state
                return {
                    "event_id":               event_id,
                    "impact_score":           0.0,
                    "ai_confidence":          0.0,
                    "token_reward":           0.0,
                    "integrity_warnings":     low_score_entry["integrity_warnings"],
                    "authenticity_penalty":   authenticity_penalty,
                    "needs_community_review": True,
                    "contract_args":          None,
                    "processing_time_ms":     round((time.perf_counter() - t_start) * 1000, 2),
                }
            raise  # re-raise other RuntimeErrors

        processing_ms = round((time.perf_counter() - t_start) * 1000, 2)



        # ── Append to Community Stream ──────────────────────────────────────────
        needs_review = payload.ai_confidence < COMMUNITY_REVIEW_CONFIDENCE
        stream_entry = {
            "event_id":           payload.event_id,
            "volunteer_address":  body.volunteer_address,
            "action_type":        body.action_type,
            "urgency_level":      body.urgency_level,
            "description":        body.description or "",
            "latitude":           body.gps.latitude,
            "longitude":          body.gps.longitude,
            "effort_hours":       body.effort_hours,
            "people_helped":      body.people_helped,
            "impact_score":       round(payload.impact_score, 2),
            "ai_confidence":      round(payload.ai_confidence, 4),
            "token_reward":       round(payload.token_reward, 4),
            "source":             body.source,
            "image_base64":       body.image_base64 if body.image_base64 else None,
            "integrity_warnings": integrity_warnings,
            "needs_community_review": needs_review,
            "submitted_at":       int(time.time()),
        }
        _stream_store.append(stream_entry)
        if len(_stream_store) > 100:
            _stream_store.pop(0)

        if needs_review:
            _vote_store[payload.event_id] = {
                "votes":      {},
                "opened_at": int(time.time()),
                "outcome":   None,
            }
            log.info(f"[STREAM] Submission flagged for community review: {payload.event_id} (confidence={payload.ai_confidence:.2f})")

        fraud_detector.record_sha256(body.hash_sha256, body.volunteer_address)
        fraud_detector.record_submission(body.volunteer_address)

        return {
            **_payload_to_dict(payload),
            "contract_args":          payload.to_contract_args(),
            "processing_time_ms":     processing_ms,
            "integrity_warnings":     integrity_warnings,
            "authenticity_penalty":   authenticity_penalty,
            "needs_community_review": needs_review,  # skip contract call if True
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


# ─── Community Stream ─────────────────────────────────────────────────────────

@app.get("/api/v1/stream", summary="Community Activity Stream")
async def get_stream(api_key: str = Security(verify_api_key)) -> Dict[str, Any]:
    """Returns the last 50 verified submissions, most recent first."""
    feed = list(reversed(_stream_store[-50:]))
    # Attach vote info to flagged entries
    enriched = []
    for entry in feed:
        e = dict(entry)
        eid = e["event_id"]
        if eid in _vote_store:
            vd = _vote_store[eid]
            votes = vd["votes"]
            approve = sum(1 for v in votes.values() if v == "approve")
            reject  = sum(1 for v in votes.values() if v == "reject")
            age_sec = int(time.time()) - vd["opened_at"]
            e["vote_info"] = {
                "approve":    approve,
                "reject":     reject,
                "total":      len(votes),
                "outcome":    vd["outcome"],
                "phase":      1 if age_sec < VOTE_PHASE2_DELAY_SEC else 2,
                "phase2_in":  max(0, VOTE_PHASE2_DELAY_SEC - age_sec),
                "voters":     list(votes.keys()),
            }
        enriched.append(e)
    return {"count": len(enriched), "items": enriched}


class VoteRequest(BaseModel):
    event_id:         str
    voter_address:    str
    vote:             str   # "approve" | "reject"
    reputation_score: float  # passed from frontend (read from ReputationLedger)


@app.post("/api/v1/vote", summary="Community Vote on Flagged Submission")
async def cast_vote(
    body:    VoteRequest,
    api_key: str = Security(verify_api_key),
) -> Dict[str, Any]:
    eid = body.event_id
    if eid not in _vote_store:
        raise HTTPException(status_code=404, detail="Submission not flagged for community review.")

    if body.vote not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="vote must be 'approve' or 'reject'.")

    vd = _vote_store[eid]
    if vd["outcome"]:
        raise HTTPException(status_code=409, detail=f"Voting already concluded: {vd['outcome']}.")

    # ── v1.2.0 FIX: Verify reputation on-chain, don't trust frontend ─────────
    reputation_score = body.reputation_score   # fallback
    _rpc_url     = os.getenv("APEX_RPC_URL", "")
    _ledger_addr = os.getenv("REPUTATION_LEDGER_ADDRESS", "")

    if _rpc_url and _ledger_addr:
        try:
            from web3 import Web3 as _Web3
            _LEDGER_ABI = [
                {
                    "inputs": [{"internalType": "address", "name": "volunteer", "type": "address"}],
                    "name": "getReputation",
                    "outputs": [
                        {"internalType": "uint256", "name": "cumulativeScore",  "type": "uint256"},
                        {"internalType": "uint256", "name": "eventCount",        "type": "uint256"},
                        {"internalType": "uint256", "name": "lastUpdatedAt",     "type": "uint256"},
                        {"internalType": "uint256", "name": "rank",              "type": "uint256"},
                    ],
                    "stateMutability": "view",
                    "type": "function",
                }
            ]
            _w3 = _Web3(_Web3.HTTPProvider(_rpc_url, request_kwargs={"timeout": 5}))
            _contract = _w3.eth.contract(
                address=_Web3.to_checksum_address(_ledger_addr),
                abi=_LEDGER_ABI,
            )
            cumulative, _, _, _ = _contract.functions.getReputation(
                _Web3.to_checksum_address(body.voter_address)
            ).call()
            # cumulative is scaled ×100 on-chain — convert to display units
            reputation_score = cumulative / 100.0
            log.info(
                f"[VOTE] On-chain reputation for {body.voter_address}: "
                f"{reputation_score:.2f} (raw={cumulative})"
            )
        except Exception as rpc_err:
            log.warning(
                f"[VOTE] On-chain reputation check failed ({rpc_err}). "
                "Falling back to frontend-supplied score. "
                "Set APEX_RPC_URL + REPUTATION_LEDGER_ADDRESS to enable on-chain check."
            )
    else:
        log.warning(
            "[VOTE] APEX_RPC_URL or REPUTATION_LEDGER_ADDRESS not set — "
            "using frontend-supplied reputation score (less secure). "
            "Set these env vars to enable on-chain verification."
        )

    # Phase eligibility (against verified reputation)
    age_sec = int(time.time()) - vd["opened_at"]
    if age_sec < VOTE_PHASE2_DELAY_SEC and reputation_score < CHAMPION_REPUTATION_THRESHOLD:
        phase2_in = VOTE_PHASE2_DELAY_SEC - age_sec
        raise HTTPException(
            status_code=403,
            detail=f"Phase 1: only CHAMPION+ (reputation ≥ {CHAMPION_REPUTATION_THRESHOLD}) may vote. "
                   f"Open voting in {phase2_in // 60}m {phase2_in % 60}s."
        )

    # Prevent self-voting
    voter = body.voter_address.lower()
    stream_entry = next((e for e in _stream_store if e["event_id"] == eid), None)
    if stream_entry and voter == stream_entry["volunteer_address"].lower():
        raise HTTPException(status_code=403, detail="You cannot vote on your own submission.")

    if voter in vd["votes"]:
        raise HTTPException(status_code=409, detail="You have already voted on this submission.")

    vd["votes"][voter] = body.vote
    log.info(f"[VOTE] {voter} voted '{body.vote}' on {eid} (phase={'1' if age_sec < VOTE_PHASE2_DELAY_SEC else '2'})")

    # Check quorum
    votes    = vd["votes"]
    approve  = sum(1 for v in votes.values() if v == "approve")
    reject   = sum(1 for v in votes.values() if v == "reject")
    outcome  = None
    if len(votes) >= VOTE_QUORUM:
        outcome = "approved" if approve > reject else "rejected"
        vd["outcome"] = outcome
        log.info(f"[VOTE] Quorum reached for {eid}: {outcome} ({approve}✅/{reject}❌)")

        if outcome == "approved" and "claim_payload" not in vd:
            # ── Build community claim payload with fixed minimum reward ──────
            stream_entry = next((e for e in _stream_store if e["event_id"] == eid), None)
            if stream_entry:
                try:
                    payload_dict, contract_args = _build_community_claim_payload(stream_entry)
                    vd["claim_payload"]       = payload_dict
                    vd["claim_contract_args"] = contract_args
                except Exception as ce:
                    log.error(f"[VOTE] Failed to generate claim payload for {eid}: {ce}")

    return {
        "event_id":  eid,
        "your_vote": body.vote,
        "approve":   approve,
        "reject":    reject,
        "total":     len(votes),
        "outcome":   outcome,
    }


@app.get("/api/v1/vote/claim/{event_id}", summary="Get Claim Payload for Approved Submission")
async def get_claim(
    event_id: str,
    api_key:  str = Security(verify_api_key),
) -> Dict[str, Any]:
    """Returns the oracle-signed payload for an approved community submission so the frontend can call releaseReward."""
    vd = _vote_store.get(event_id)
    if not vd:
        raise HTTPException(status_code=404, detail="Event not found in vote store.")
    if vd.get("outcome") != "approved":
        raise HTTPException(status_code=409, detail=f"Vote outcome is '{vd.get('outcome')}', not 'approved'.")

    # ── Lazy generation: build community claim payload on-demand ─────────────
    if "claim_payload" not in vd:
        stream_entry = next((e for e in _stream_store if e["event_id"] == event_id), None)
        if not stream_entry:
            raise HTTPException(status_code=503, detail="Stream entry not found — server may have restarted.")
        try:
            payload_dict, contract_args  = _build_community_claim_payload(stream_entry)
            vd["claim_payload"]          = payload_dict
            vd["claim_contract_args"]    = contract_args
        except Exception as ce:
            log.error(f"[CLAIM] Failed to generate claim payload for {event_id}: {ce}")
            raise HTTPException(status_code=503, detail=f"Could not generate claim payload: {ce}")

    return {
        **vd["claim_payload"],
        "contract_args": vd["claim_contract_args"],
    }



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