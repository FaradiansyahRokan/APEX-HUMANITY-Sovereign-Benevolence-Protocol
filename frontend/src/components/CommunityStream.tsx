"use client";

import { useState, useEffect, useCallback } from "react";
import { useWriteContract, usePublicClient, useReadContract } from "wagmi";
import { pad } from "viem";
import { CONTRACTS, ACTION_TYPES, URGENCY_LEVELS, getRank } from "../utils/constants";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";

const ORACLE_URL = process.env.NEXT_PUBLIC_ORACLE_URL || "http://localhost:8000";
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
    const canVote = vi.phase === 2 || isChampion;
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
            setMsg(`✅ Reward berhasil diklaim!`);
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
            setMsg(data.outcome ? `✅ Outcome: ${data.outcome.toUpperCase()}` : "Vote recorded!");
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
                    <span style={{ fontSize: "16px" }}>{approved ? "✅" : "❌"}</span>
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
                                Reward Claimed ✅
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
                <p style={{ ...label10, color: "#ffbd59" }}>
                    ⚠️ SATIN Ragu — Butuh Verifikasi Komunitas
                </p>
                <span style={{
                    padding: "2px 8px", borderRadius: "20px", fontSize: "10px",
                    background: vi.phase === 1 ? "rgba(124,106,255,0.12)" : "rgba(0,223,178,0.08)",
                    border: `1px solid ${vi.phase === 1 ? "rgba(124,106,255,0.3)" : "rgba(0,223,178,0.2)"}`,
                    color: vi.phase === 1 ? "#7c6aff" : "#00dfb2",
                    fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
                }}>
                    {vi.phase === 1
                        ? `⚔️ CHAMPION+ · Terbuka ${Math.ceil(vi.phase2_in / 60)}m lagi`
                        : "🌐 Semua Voter"}
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
                    ✅ Kamu sudah memberikan vote
                </p>
            ) : canVote ? (
                <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => handleVote("approve")} disabled={voting}
                        style={{
                            flex: 1, padding: "8px", borderRadius: "8px", border: "none",
                            background: "rgba(0,223,178,0.12)", color: "#00dfb2",
                            fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: "12px", fontWeight: 700,
                            cursor: voting ? "not-allowed" : "pointer",
                        }}>✅ Approve</button>
                    <button onClick={() => handleVote("reject")} disabled={voting}
                        style={{
                            flex: 1, padding: "8px", borderRadius: "8px", border: "none",
                            background: "rgba(255,80,80,0.10)", color: "#ff8080",
                            fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: "12px", fontWeight: 700,
                            cursor: voting ? "not-allowed" : "pointer",
                        }}>❌ Reject</button>
                </div>
            ) : (
                <p style={{ fontSize: "11px", color: "rgba(255,189,89,0.6)", fontFamily: "'JetBrains Mono',monospace" }}>
                    Voting terbuka untuk CHAMPION+ saja saat ini. Tunggu {Math.ceil(vi.phase2_in / 60)} menit lagi untuk vote bebas.
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
                            }}>📷 LIVE</span>
                        )}
                    </div>
                    <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", whiteSpace: "nowrap" as const, fontFamily: "'JetBrains Mono',monospace" }}>
                        {timeAgo(entry.submitted_at)}
                    </span>
                </div>

                {/* Photo + description row */}
                <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    {entry.image_base64 ? (
                        <img
                            src={`data:image/jpeg;base64,${entry.image_base64}`}
                            alt="Evidence"
                            style={{ width: "80px", height: "80px", borderRadius: "10px", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.08)" }}
                        />
                    ) : (
                        <div style={{
                            width: "80px", height: "80px", borderRadius: "10px", flexShrink: 0,
                            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px",
                        }}>📝</div>
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
                        <div style={{ padding: "6px 12px", borderRadius: "20px", background: "rgba(255,189,89,0.08)", border: "1px solid rgba(255,189,89,0.25)" }}>
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#ffbd59", fontFamily: "'JetBrains Mono',monospace" }}>
                                ⚠️ {pending.length} perlu verifikasi
                            </span>
                        </div>
                    )}
                    {/* Rank badge */}
                    <div style={{ padding: "6px 12px", borderRadius: "20px", background: "rgba(124,106,255,0.08)", border: "1px solid rgba(124,106,255,0.2)" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "#7c6aff", fontFamily: "'JetBrains Mono',monospace" }}>
                            ⚔️ {rank.rank}
                        </span>
                    </div>
                    <button onClick={fetchStream} style={{
                        padding: "6px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)",
                        background: "transparent", color: "rgba(255,255,255,0.4)",
                        fontSize: "11px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace",
                    }}>↻ Refresh</button>
                </div>
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
                    <div style={{ fontSize: "24px", marginBottom: "8px" }}>⏳</div>
                    <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>Memuat stream…</p>
                </div>
            ) : items.length === 0 ? (
                <div style={{ textAlign: "center" as const, padding: "60px 0", opacity: 0.4 }}>
                    <div style={{ fontSize: "32px", marginBottom: "10px" }}>🌊</div>
                    <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: "15px", color: "rgba(255,255,255,0.5)", marginBottom: "6px" }}>Belum ada aktivitas</p>
                    <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.25)" }}>Submit proof pertamamu untuk memulai stream komunitas</p>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {items.map(entry => (
                        <StreamCard key={entry.event_id} entry={entry} address={address} reputationScore={reputationScore} onVoted={fetchStream} />
                    ))}
                </div>
            )}

            <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }
      `}</style>
        </div>
    );
}
