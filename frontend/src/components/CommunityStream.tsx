"use client";

import { useState, useEffect, useCallback } from "react";
import { useWriteContract, usePublicClient, useReadContract } from "wagmi";
import { pad } from "viem";
import { CONTRACTS, ACTION_TYPES, URGENCY_LEVELS, getRank } from "../utils/constants";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";
import { motion, AnimatePresence } from "framer-motion";

const getOracleUrl = () => {
    // Langsung ambil dari .env tanpa menebak hostname
    return process.env.NEXT_PUBLIC_ORACLE_URL || "http://localhost:8000";
};

const ORACLE_URL = getOracleUrl();
const ORACLE_KEY = process.env.NEXT_PUBLIC_SATIN_API_KEY || "apex-dev-key";
const POLL_MS = 15_000; // 15 seconds

interface VoteInfo {
    approve: number; reject: number; total: number;
    outcome: string | null; phase: number; phase2_in: number;
    voters?: string[];
}

interface StreamEntry {
    event_id: string;
    volunteer_address: string;
    action_type: string; urgency_level: string;
    description: string;
    latitude: number; longitude: number;
    effort_hours: number; people_helped: number;
    impact_score: number; ai_confidence: number; token_reward: number;
    source: string; image_base64: string | null;
    integrity_warnings: string[];
    needs_community_review: boolean;
    needs_champion_audit?: boolean;
    submitted_at: number;
    vote_info?: VoteInfo;
}

const glassCard: React.CSSProperties = {
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.07)",
    background: "rgba(255,255,255,0.025)",
    overflow: "hidden",
};

const label10: React.CSSProperties = {
    fontSize: "10px", fontFamily: "'JetBrains Mono',monospace",
    fontWeight: 600, letterSpacing: "0.08em",
    color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const,
};

function timeAgo(unix: number) {
    const s = Math.floor(Date.now() / 1000) - unix;
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}

function ActionBadge({ type }: { type: string }) {
    const a = ACTION_TYPES.find(x => x.value === type);
    return (
        <span style={{
            padding: "2px 8px", borderRadius: "6px",
            background: "rgba(0,223,178,0.07)", border: "1px solid rgba(0,223,178,0.18)",
            fontSize: "10px", fontFamily: "'JetBrains Mono',monospace",
            color: "#00dfb2", fontWeight: 700, whiteSpace: "nowrap" as const,
        }}>{a?.emoji} {a?.label ?? type}</span>
    );
}

function UrgencyBadge({ level }: { level: string }) {
    const colors: Record<string, [string, string]> = {
        CRITICAL: ["rgba(124,106,255,0.12)", "#7c6aff"],
        HIGH: ["rgba(255,110,180,0.10)", "#ff6eb4"],
        MEDIUM: ["rgba(255,189,89,0.09)", "#ffbd59"],
        LOW: ["rgba(0,223,178,0.07)", "#00dfb2"],
    };
    const [bg, fg] = colors[level] ?? colors.MEDIUM;
    return (
        <span style={{
            padding: "2px 8px", borderRadius: "6px",
            background: bg, border: `1px solid ${fg}44`,
            fontSize: "10px", fontFamily: "'JetBrains Mono',monospace",
            color: fg, fontWeight: 700,
        }}>{level}</span>
    );
}

function ConfidenceBar({ value }: { value: number }) {
    const pct = Math.round(value * 100);
    const color = pct >= 60 ? "#00dfb2" : pct >= 30 ? "#ffbd59" : "#ff5050";
    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={label10}>AI Confidence</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", fontWeight: 700, color }}>{pct}%</span>
            </div>
            <div style={{ height: "4px", borderRadius: "99px", background: "rgba(255,255,255,0.06)" }}>
                <div style={{ height: "100%", width: `${pct}%`, borderRadius: "99px", background: color, transition: "width 0.6s" }} />
            </div>
        </div>
    );
}

function VotingPanel({
    entry, address, reputationScore, onVoted,
}: { entry: StreamEntry; address: string; reputationScore: number; onVoted: () => void }) {
    const vi = entry.vote_info!;
    const [voting, setVoting] = useState(false);
    const [msg, setMsg] = useState("");
    const [claiming, setClaiming] = useState(false);
    const [claimTx, setClaimTx] = useState("");

    const { writeContractAsync } = useWriteContract();
    const publicClient = usePublicClient();

    const { data: isProcessed } = useReadContract({
        address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
        abi: BENEVOLENCE_VAULT_ABI,
        functionName: "isEventProcessed",
        args: [pad(`0x${entry.event_id.replace(/-/g, "")}` as `0x${string}`, { size: 32 })],
    });

    const isOwner = address.toLowerCase() === entry.volunteer_address.toLowerCase();
    const hasVoted = vi.voters?.map((v: string) => v.toLowerCase()).includes(address.toLowerCase());
    const isChampion = reputationScore >= 500;
    const isChampionAudit = entry.needs_champion_audit;
    const canVote = isChampionAudit ? isChampion : (vi.phase === 2 || isChampion);
    const total = vi.approve + vi.reject || 1;
    const approveP = Math.round((vi.approve / total) * 100);
    const rejectP = 100 - approveP;

    const handleClaim = async () => {
        setClaiming(true);
        setMsg("");
        try {
            // 1. Fetch signed claim payload from oracle
            const res = await fetch(`${ORACLE_URL}/api/v1/vote/claim/${entry.event_id}`, {
                headers: { "X-APEX-Oracle-Key": ORACLE_KEY },
            });
            if (!res.ok) {
                const d = await res.json();
                setMsg(typeof d.detail === "string" ? d.detail : "Claim payload belum siap, coba lagi.");
                return;
            }
            const real = await res.json();
            const ca = real.contract_args;

            // 2. Call releaseReward on-chain
            const hash = await writeContractAsync({
                address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
                abi: BENEVOLENCE_VAULT_ABI,
                functionName: "releaseReward",
                args: [
                    pad(`0x${real.event_id.replace(/-/g, "")}` as `0x${string}`, { size: 32 }),
                    address as `0x${string}`,
                    (ca.beneficiaryAddress ?? address) as `0x${string}`,
                    BigInt(ca.impactScoreScaled), BigInt(ca.tokenRewardWei),
                    pad(`0x${real.zk_proof_hash.replace("0x", "")}` as `0x${string}`, { size: 32 }),
                    pad(`0x${real.event_hash.replace("0x", "")}` as `0x${string}`, { size: 32 }),
                    real.nonce, BigInt(real.expires_at),
                    Number(real.signature.v),
                    real.signature.r as `0x${string}`,
                    real.signature.s as `0x${string}`,
                ],
                gas: 800000n,
            });

            if (publicClient) {
                await publicClient.waitForTransactionReceipt({ hash });
            }
            setClaimTx(hash);
            setMsg(`Reward berhasil diklaim!`);
            onVoted();
        } catch (e: any) {
            setMsg(e.message?.slice(0, 120) || "Klaim gagal");
        } finally {
            setClaiming(false);
        }
    };

    const handleVote = async (vote: "approve" | "reject") => {
        setVoting(true);
        try {
            const res = await fetch(`${ORACLE_URL}/api/v1/vote`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-APEX-Oracle-Key": ORACLE_KEY },
                body: JSON.stringify({
                    event_id: entry.event_id,
                    voter_address: address,
                    vote,
                    reputation_score: reputationScore,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                const detail = data.detail;
                const msg = typeof detail === "string"
                    ? detail
                    : Array.isArray(detail)
                        ? detail.map((e: any) => e.msg || JSON.stringify(e)).join("; ")
                        : "Vote failed";
                setMsg(msg);
                return;
            }
            setMsg(data.outcome ? `Outcome: ${data.outcome.toUpperCase()}` : "Vote recorded!");
            onVoted();
        } catch { setMsg("Network error"); }
        finally { setVoting(false); }
    };

    if (vi.outcome) {
        const approved = vi.outcome === "approved";
        return (
            <div style={{
                padding: "12px 14px", borderRadius: "10px", marginTop: "10px",
                background: approved ? "rgba(0,223,178,0.07)" : "rgba(255,80,80,0.07)",
                border: `1px solid ${approved ? "rgba(0,223,178,0.25)" : "rgba(255,80,80,0.25)"}`,
                display: "flex", flexDirection: "column", gap: "10px",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{
                        width: "8px", height: "8px", borderRadius: "50%",
                        background: approved ? "#00dfb2" : "#ff5050",
                        boxShadow: `0 0 8px ${approved ? "rgba(0,223,178,0.5)" : "rgba(255,80,80,0.5)"}`
                    }} />
                    <div>
                        <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: "12px", color: approved ? "#00dfb2" : "#ff5050" }}>
                            Community {vi.outcome.toUpperCase()}
                        </p>
                        <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>
                            {vi.approve} approve · {vi.reject} reject
                        </p>
                    </div>
                </div>

                {/* Claim Reward — only for the original submitter, only on approved */}
                {approved && isOwner && (
                    <div style={{ marginTop: "4px" }}>
                        {isProcessed || claimTx ? (
                            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600, textAlign: "center", padding: "8px", background: "rgba(255,255,255,0.03)", borderRadius: "8px" }}>
                                Reward Claimed
                            </p>
                        ) : msg ? (
                            <p style={{ fontSize: "11px", color: "#00dfb2", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600, textAlign: "center" }}>{msg}</p>
                        ) : (
                            <button
                                onClick={handleClaim}
                                disabled={claiming}
                                style={{
                                    width: "100%", padding: "10px", borderRadius: "8px", border: "none",
                                    background: claiming ? "rgba(255,189,89,0.06)" : "linear-gradient(90deg,rgba(255,189,89,0.2),rgba(255,110,180,0.15))",
                                    color: "#ffbd59",
                                    fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: "13px", fontWeight: 800,
                                    cursor: claiming ? "not-allowed" : "pointer",
                                    letterSpacing: "0.04em",
                                }}
                            >
                                {claiming ? "⏳ Mengklaim..." : "🏆 Claim Reward"}
                            </button>
                        )}
                    </div>
                )}
                {claimTx && (
                    <p style={{ fontSize: "10px", color: "rgba(0,223,178,0.6)", fontFamily: "'JetBrains Mono',monospace" }}>
                        Tx: {claimTx.slice(0, 20)}…
                    </p>
                )}
            </div>
        );
    }

    return (
        <div style={{
            marginTop: "10px", padding: "12px 14px", borderRadius: "10px",
            background: "rgba(255,189,89,0.05)", border: "1px solid rgba(255,189,89,0.2)",
        }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <p style={{ ...label10, color: "#ffbd59", display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffbd59", boxShadow: "0 0 8px rgba(255,189,89,0.8)" }} />
                    PENDING VERIFICATION
                </p>
                <span style={{
                    padding: "2px 8px", borderRadius: "20px", fontSize: "10px",
                    background: (vi.phase === 1 || isChampionAudit) ? "rgba(124,106,255,0.12)" : "rgba(0,223,178,0.08)",
                    border: `1px solid ${(vi.phase === 1 || isChampionAudit) ? "rgba(124,106,255,0.3)" : "rgba(0,223,178,0.2)"}`,
                    color: (vi.phase === 1 || isChampionAudit) ? "#7c6aff" : "#00dfb2",
                    fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
                }}>
                    {isChampionAudit
                        ? "EXCLUSIVE AUDIT"
                        : vi.phase === 1
                            ? `CHAMPION+ · Terbuka ${Math.ceil(vi.phase2_in / 60)}m lagi`
                            : "Terbuka · Semua Voter"}
                </span>
            </div>

            {/* Progress bar */}
            {vi.total > 0 && (
                <div style={{ display: "flex", height: "5px", borderRadius: "99px", overflow: "hidden", marginBottom: "8px" }}>
                    <div style={{ width: `${approveP}%`, background: "#00dfb2", transition: "width 0.4s" }} />
                    <div style={{ width: `${rejectP}%`, background: "#ff5050", transition: "width 0.4s" }} />
                </div>
            )}
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", marginBottom: "10px" }}>
                {vi.approve} approve · {vi.reject} reject · quorum: 3 suara
            </p>

            {msg ? (
                <p style={{ fontSize: "11px", color: "#00dfb2", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600 }}>{msg}</p>
            ) : isOwner ? (
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono',monospace", textAlign: "center", fontStyle: "italic" }}>
                    Menunggu hasil voting komunitas...
                </p>
            ) : hasVoted ? (
                <p style={{ fontSize: "11px", color: "#00dfb2", fontFamily: "'JetBrains Mono',monospace", textAlign: "center", padding: "8px", background: "rgba(0,223,178,0.08)", borderRadius: "8px" }}>
                    Vote recorded
                </p>
            ) : canVote ? (
                <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => handleVote("approve")} disabled={voting}
                        style={{
                            flex: 1, padding: "8px", borderRadius: "8px", border: "none",
                            background: voting ? "rgba(255,255,255,0.05)" : "rgba(0,223,178,0.12)",
                            color: voting ? "rgba(255,255,255,0.4)" : "#00dfb2",
                            fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: "12px", fontWeight: 700,
                            cursor: voting ? "not-allowed" : "pointer", transition: "all 0.2s"
                        }}>{voting ? "Processing..." : "Approve"}</button>
                    <button onClick={() => handleVote("reject")} disabled={voting}
                        style={{
                            flex: 1, padding: "8px", borderRadius: "8px", border: "none",
                            background: voting ? "rgba(255,255,255,0.05)" : "rgba(255,80,80,0.10)",
                            color: voting ? "rgba(255,255,255,0.4)" : "#ff8080",
                            fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: "12px", fontWeight: 700,
                            cursor: voting ? "not-allowed" : "pointer", transition: "all 0.2s"
                        }}>{voting ? "Processing..." : "Reject"}</button>
                </div>
            ) : (
                <p style={{ fontSize: "11px", color: "rgba(255,189,89,0.6)", fontFamily: "'JetBrains Mono',monospace" }}>
                    {isChampionAudit
                        ? "Voting EKSLUSIF hanya untuk akun dengan reputasi CHAMPION+ (Score ≥ 500)."
                        : `Voting terbuka untuk CHAMPION+ saja saat ini. Tunggu ${Math.ceil(vi.phase2_in / 60)} menit lagi untuk vote bebas.`}
                </p>
            )}
        </div>
    );
}

function StreamCard({ entry, address, reputationScore, onVoted }: {
    entry: StreamEntry; address: string; reputationScore: number; onVoted: () => void;
}) {
    const flagged = entry.needs_community_review;
    const accentBorder = flagged ? "rgba(255,189,89,0.22)" : "rgba(255,255,255,0.07)";
    const [isImageExpanded, setIsImageExpanded] = useState(false);

    return (
        <div style={{
            ...glassCard,
            border: `1px solid ${accentBorder}`,
            boxShadow: flagged ? "0 0 20px rgba(255,189,89,0.06)" : "none",
        }}>
            {/* Gradient top bar */}
            <div style={{
                height: "2px", background: flagged
                    ? "linear-gradient(90deg,#ffbd59,#ff6eb4)"
                    : "linear-gradient(90deg,#00dfb2,#7c6aff)"
            }} />

            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" as const }}>
                        <ActionBadge type={entry.action_type} />
                        <UrgencyBadge level={entry.urgency_level} />
                        {entry.source === "live_capture" && (
                            <span style={{
                                padding: "2px 8px", borderRadius: "6px",
                                background: "rgba(0,223,178,0.05)", border: "1px solid rgba(0,223,178,0.12)",
                                fontSize: "9px", fontFamily: "'JetBrains Mono',monospace",
                                color: "rgba(0,223,178,0.5)", fontWeight: 700,
                                display: "flex", alignItems: "center", gap: "4px"
                            }}><div style={{ width: 4, height: 4, borderRadius: "50%", background: "#00dfb2" }} />LIVE</span>
                        )}
                        {entry.integrity_warnings?.length > 0 && entry.integrity_warnings.map((w, i) => (
                            <span key={i} style={{
                                padding: "2px 8px", borderRadius: "6px",
                                background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.3)",
                                fontSize: "9px", fontFamily: "'JetBrains Mono',monospace",
                                color: "#ff8080", fontWeight: 700,
                            }}>FLAG: {w.replace(/_/g, " ").toUpperCase()}</span>
                        ))}
                    </div>
                    <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", whiteSpace: "nowrap" as const, fontFamily: "'JetBrains Mono',monospace" }}>
                        {timeAgo(entry.submitted_at)}
                    </span>
                </div>

                {/* Photo + description row */}
                <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    {entry.image_base64 ? (
                        <>
                            {/* Expandable Image Thumbnail */}
                            <motion.div
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setIsImageExpanded(true)}
                                style={{ cursor: "zoom-in", flexShrink: 0 }}
                            >
                                <img
                                    src={`data:image/jpeg;base64,${entry.image_base64}`}
                                    alt="Evidence Thumbnail"
                                    style={{
                                        width: "80px", height: "80px", borderRadius: "10px", objectFit: "cover",
                                        border: "1px solid rgba(255,255,255,0.08)",
                                        boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
                                    }}
                                />
                            </motion.div>

                            {/* Fullscreen Image Overlay */}
                            <AnimatePresence>
                                {isImageExpanded && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        onClick={() => setIsImageExpanded(false)}
                                        style={{
                                            position: "fixed", inset: 0, zIndex: 9999,
                                            background: "rgba(3,8,14,0.9)", backdropFilter: "blur(8px)",
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            padding: "20px", cursor: "zoom-out"
                                        }}
                                    >
                                        <motion.img
                                            initial={{ scale: 0.9, y: 20 }}
                                            animate={{ scale: 1, y: 0 }}
                                            exit={{ scale: 0.9, y: 20 }}
                                            transition={{ type: "spring", damping: 25, stiffness: 300 }}
                                            src={`data:image/jpeg;base64,${entry.image_base64}`}
                                            alt="Expanded Evidence"
                                            style={{
                                                maxWidth: "100%", maxHeight: "90vh",
                                                borderRadius: "16px",
                                                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                                                border: "1px solid rgba(255,255,255,0.1)",
                                                objectFit: "contain"
                                            }}
                                            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the image itself
                                        />
                                        <button
                                            onClick={() => setIsImageExpanded(false)}
                                            style={{
                                                position: "absolute", top: "30px", right: "30px",
                                                width: "44px", height: "44px", borderRadius: "50%",
                                                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                                                color: "#fff", fontSize: "20px", display: "flex", alignItems: "center", justifyContent: "center",
                                                cursor: "pointer", backdropFilter: "blur(4px)"
                                            }}
                                        >
                                            ✕
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </>
                    ) : (
                        <div style={{
                            width: "80px", height: "80px", borderRadius: "10px", flexShrink: 0,
                            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono',monospace"
                        }}>NO_IMG</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono',monospace", marginBottom: "4px" }}>
                            {entry.volunteer_address.slice(0, 10)}…{entry.volunteer_address.slice(-8)}
                        </p>
                        <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.6, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                            {entry.description.length > 120 ? entry.description.slice(0, 120) + "…" : entry.description}
                        </p>
                    </div>
                </div>

                {/* Stats row */}
                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" as const, paddingTop: "4px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    {[
                        { label: "Score", value: `${entry.impact_score}/100`, g: "linear-gradient(90deg,#00dfb2,#7c6aff)" },
                        { label: "Reward", value: `${entry.token_reward.toFixed(2)} APEX`, g: "linear-gradient(90deg,#ffbd59,#ff6eb4)" },
                        { label: "Effort", value: `${entry.effort_hours}h`, g: "linear-gradient(90deg,#7c6aff,#ff6eb4)" },
                        { label: "Helped", value: `${entry.people_helped} orang`, g: "linear-gradient(90deg,#00dfb2,#7c6aff)" },
                    ].map(s => (
                        <div key={s.label}>
                            <p style={label10}>{s.label}</p>
                            <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "13px", fontWeight: 700, background: s.g, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginTop: "2px" }}>
                                {s.value}
                            </p>
                        </div>
                    ))}
                    {(entry.latitude !== 0 || entry.longitude !== 0) && (
                        <div>
                            <p style={label10}>Lokasi</p>
                            <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "rgba(255,255,255,0.35)", marginTop: "2px" }}>
                                {entry.latitude.toFixed(3)}, {entry.longitude.toFixed(3)}
                            </p>
                        </div>
                    )}
                </div>

                {/* Confidence bar */}
                <ConfidenceBar value={entry.ai_confidence} />

                {/* Voting panel for flagged */}
                {flagged && entry.vote_info && (
                    <VotingPanel entry={entry} address={address} reputationScore={reputationScore} onVoted={onVoted} />
                )}
            </div>
        </div>
    );
}

export default function CommunityStream({ address, reputationScore }: { address: string; reputationScore: number }) {
    const [items, setItems] = useState<StreamEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(Date.now());
    const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
    const rank = getRank(reputationScore);

    const fetchStream = useCallback(async () => {
        try {
            const res = await fetch(`${ORACLE_URL}/api/v1/stream`, {
                headers: { "X-APEX-Oracle-Key": ORACLE_KEY },
            });
            if (res.ok) {
                const data = await res.json();
                setItems(data.items ?? []);
            }
        } catch { /* silent — oracle might be offline */ }
        finally { setLoading(false); setLastRefresh(Date.now()); }
    }, []);

    useEffect(() => {
        fetchStream();
        const id = setInterval(fetchStream, POLL_MS);
        return () => clearInterval(id);
    }, [fetchStream]);

    const pending = items.filter(i => i.needs_community_review && !i.vote_info?.outcome);

    // Apply filtering and sorting logic
    const filteredItems = items
        .filter(entry => {
            if (filter === "all") return true;
            if (filter === "pending") return entry.needs_community_review && !entry.vote_info?.outcome;
            if (filter === "approved") return entry.vote_info?.outcome === "approved";
            if (filter === "rejected") return entry.vote_info?.outcome === "rejected";
            return true;
        })
        .sort((a, b) => {
            // Sort Strategy 1: Always put pending votes for the community ON TOP
            const aPending = a.needs_community_review && !a.vote_info?.outcome;
            const bPending = b.needs_community_review && !b.vote_info?.outcome;

            if (aPending && !bPending) return -1;
            if (!aPending && bPending) return 1;

            // Sort Strategy 2: Default to newest first (highest timestamp)
            return b.submitted_at - a.submitted_at;
        });

    return (
        <div style={{ maxWidth: "680px" }}>
            {/* Header */}
            <div style={{ marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px" }}>
                <div>
                    <p style={{ fontSize: "10px", textTransform: "uppercase" as const, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, background: "linear-gradient(90deg,#ff6eb4,#ffbd59)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: "6px" }}>
                        Community Stream
                    </p>
                    <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: "22px", color: "#fff" }}>
                        Aktivitas Komunitas
                    </p>
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    {pending.length > 0 && (
                        <div style={{ padding: "6px 12px", borderRadius: "20px", background: "rgba(255,189,89,0.08)", border: "1px solid rgba(255,189,89,0.25)", display: "flex", alignItems: "center", gap: "6px" }}>
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffbd59", boxShadow: "0 0 8px rgba(255,189,89,0.8)" }} />
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#ffbd59", fontFamily: "'JetBrains Mono',monospace" }}>
                                {pending.length} perlu verifikasi
                            </span>
                        </div>
                    )}
                    {/* Rank badge */}
                    <div style={{ padding: "6px 12px", borderRadius: "20px", background: "rgba(124,106,255,0.08)", border: "1px solid rgba(124,106,255,0.2)", display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#7c6aff" }} />
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "#7c6aff", fontFamily: "'JetBrains Mono',monospace" }}>
                            {rank.rank}
                        </span>
                    </div>
                    <button onClick={fetchStream} style={{
                        padding: "6px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)",
                        background: "transparent", color: "rgba(255,255,255,0.4)",
                        fontSize: "11px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace",
                    }}>↻ Refresh</button>
                </div>
            </div>

            {/* Filter Buttons */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px", overflowX: "auto", paddingBottom: "4px" }}>
                {["all", "pending", "approved", "rejected"].map(f => (
                    <button key={f} onClick={() => setFilter(f as any)} style={{
                        padding: "6px 14px", borderRadius: "20px", border: "1px solid",
                        borderColor: filter === f ? "rgba(0,223,178,0.4)" : "rgba(255,255,255,0.1)",
                        background: filter === f ? "rgba(0,223,178,0.1)" : "rgba(255,255,255,0.03)",
                        color: filter === f ? "#00dfb2" : "rgba(255,255,255,0.5)",
                        fontSize: "12px", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600,
                        cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap"
                    }}>
                        {f === "all" ? "Semua" : f === "pending" ? "Butuh Vote" : f === "approved" ? "Disetujui" : "Ditolak"}
                    </button>
                ))}
            </div>

            {/* Live indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#ff5050", boxShadow: "0 0 8px #ff5050", animation: "pulse 2s ease-in-out infinite" }} />
                <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono',monospace" }}>
                    LIVE · Refresh setiap 15 detik · Update terakhir: {new Date(lastRefresh).toLocaleTimeString()}
                </span>
            </div>

            {loading ? (
                <div style={{ textAlign: "center" as const, padding: "60px 0", opacity: 0.4 }}>
                    <div style={{ width: "24px", height: "24px", margin: "0 auto 12px", border: "2px solid #00dfb2", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                    <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>Memuat stream…</p>
                </div>
            ) : filteredItems.length === 0 ? (
                <div style={{
                    padding: "60px 40px", textAlign: "center", borderRadius: "24px",
                    background: "linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
                    border: "1px dashed rgba(255,255,255,0.1)",
                    position: "relative", overflow: "hidden"
                }}>
                    <div style={{ position: "absolute", inset: "-50%", background: "radial-gradient(circle, rgba(124,106,255,0.05) 0%, transparent 60%)", pointerEvents: "none" }} />
                    <div style={{
                        width: "80px", height: "80px", margin: "0 auto 20px", borderRadius: "50%",
                        background: "rgba(124,106,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center",
                        border: "1px solid rgba(124,106,255,0.2)", boxShadow: "0 0 40px rgba(124,106,255,0.1) inset"
                    }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "linear-gradient(135deg,rgba(124,106,255,0.8),transparent)", opacity: 0.5 }} />
                    </div>
                    <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: "18px", color: "rgba(255,255,255,0.8)", marginBottom: "8px", position: "relative" }}>
                        Tidak Ada Aktivitas
                    </p>
                    <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", lineHeight: 1.6, maxWidth: "300px", margin: "0 auto", position: "relative" }}>
                        {filter === "all" ? "Belum ada impact proofs yang dikirimkan oleh komunitas." : "Tidak ada aktivitas yang sesuai dengan filter ini."}
                    </p>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <AnimatePresence mode="popLayout">
                        {filteredItems.map((entry, index) => (
                            <motion.div
                                key={entry.event_id}
                                layout
                                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, filter: "blur(8px)" }}
                                transition={{ duration: 0.3, delay: index * 0.05 }}
                            >
                                <StreamCard entry={entry} address={address} reputationScore={reputationScore} onVoted={fetchStream} />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}

            <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
        </div>
    );
}
