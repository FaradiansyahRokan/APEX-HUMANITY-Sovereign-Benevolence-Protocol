"use client";

import { useState } from "react";
import { useReadContract } from "wagmi";
import { REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS, getRank } from "../utils/constants";

interface Entry { address: string; score: number; rank: number; }

const PODIUM_STYLES = [
  // Silver (2nd)
  { gradient: "linear-gradient(135deg,#9ab,#cde)", glow: "rgba(180,200,220,0.2)", bg: "rgba(180,200,220,0.05)", border: "rgba(180,200,220,0.15)", medal: "🥈", height: "70px" },
  // Gold (1st)
  { gradient: "linear-gradient(135deg,#ffbd59,#ff6eb4)", glow: "rgba(255,189,89,0.3)", bg: "rgba(255,189,89,0.07)", border: "rgba(255,189,89,0.25)", medal: "🥇", height: "88px" },
  // Bronze (3rd)
  { gradient: "linear-gradient(135deg,#d08040,#e09858)", glow: "rgba(210,140,80,0.2)", bg: "rgba(210,140,80,0.05)", border: "rgba(210,140,80,0.15)", medal: "🥉", height: "58px" },
];

export default function Leaderboard() {
  const [page, setPage] = useState(0);
  const PAGE = 10;

  const { data: total } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getLeaderboardLength",
    query: { refetchInterval: 10_000 },
  });
  const { data: pageData, isLoading } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getLeaderboardPage",
    args: [BigInt(page * PAGE), BigInt(PAGE)],
    query: { refetchInterval: 10_000 },
  });
  const { data: globalStats } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getGlobalStats",
    query: { refetchInterval: 10_000 },
  });

  const addrs  = (pageData as any)?.[0] ?? [];
  const scores = (pageData as any)?.[1] ?? [];
  const totalN = Number(total ?? 0);
  const pages  = Math.ceil(totalN / PAGE);

  const entries: Entry[] = addrs.map((a: string, i: number) => ({
    address: a, score: Number(scores[i] ?? 0n), rank: page * PAGE + i + 1,
  })).sort((a: Entry, b: Entry) => b.score - a.score);

  const podium = [entries[1], entries[0], entries[2]]; // silver, gold, bronze

  return (
    <div style={{ maxWidth: "800px" }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "28px", flexWrap: "wrap", gap: "12px",
      }}>
        <div>
          <p style={{
            fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em",
            fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
            background: "linear-gradient(90deg,#7c6aff,#ff6eb4)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            marginBottom: "6px",
          }}>Reputation Leaderboard</p>
          <p style={{
            fontFamily: "'Plus Jakarta Sans',sans-serif",
            fontWeight: 800, fontSize: "22px", color: "#fff",
          }}>
            {totalN > 0
              ? <>{totalN.toLocaleString()} <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400, fontSize: "16px" }}>volunteers ranked</span></>
              : "Global Rankings"
            }
          </p>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "6px 13px", borderRadius: "99px",
          background: "rgba(0,223,178,0.06)", border: "1px solid rgba(0,223,178,0.15)",
        }}>
          <div style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: "#00dfb2", boxShadow: "0 0 8px #00dfb2",
            animation: "pulse 2s ease-in-out infinite",
          }} />
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "9px", fontWeight: 700, color: "#00dfb2", letterSpacing: "0.14em" }}>LIVE · 10s</span>
        </div>
      </div>

      {/* Global stats */}
      {globalStats && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "24px" }}>
          {[
            { label: "Total Volunteers",      value: Number((globalStats as any)[0]).toLocaleString(),     gradient: "linear-gradient(135deg,#7c6aff,#ff6eb4)" },
            { label: "Total Impact Generated", value: (Number((globalStats as any)[1]) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 }), gradient: "linear-gradient(135deg,#00dfb2,#7c6aff)" },
          ].map(s => (
            <div key={s.label} style={{
              padding: "16px 20px", borderRadius: "14px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              position: "relative", overflow: "hidden",
            }}>
              <div style={{ position: "absolute", inset: 0, opacity: 0.05, background: s.gradient }} />
              <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.07em" }}>{s.label}</p>
              <p style={{
                fontFamily: "'JetBrains Mono',monospace", fontSize: "22px", fontWeight: 700,
                background: s.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{
              height: "52px", borderRadius: "12px",
              background: `rgba(255,255,255,${0.025 - i * 0.004})`,
              border: "1px solid rgba(255,255,255,0.04)",
            }} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && entries.length === 0 && (
        <div style={{
          padding: "80px 24px", textAlign: "center",
          borderRadius: "16px", border: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.02)",
        }}>
          <p style={{ fontSize: "36px", opacity: 0.06, marginBottom: "14px" }}>⛓️</p>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", marginBottom: "5px" }}>No volunteers yet</p>
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>Submit your first impact proof</p>
        </div>
      )}

      {/* Podium — page 0 with 3+ entries */}
      {!isLoading && entries.length >= 3 && page === 0 && (
        <div style={{ marginBottom: "16px" }}>
          {/* Podium bars base */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr 1fr", gap: "8px", alignItems: "end" }}>
            {[
              { entry: podium[0], sIdx: 0 },
              { entry: podium[1], sIdx: 1 },
              { entry: podium[2], sIdx: 2 },
            ].map(({ entry, sIdx }) => {
              if (!entry) return null;
              const s   = PODIUM_STYLES[sIdx];
              const rep = getRank(entry.score / 100);
              const isCenter = sIdx === 1;
              return (
                <div key={entry.address} style={{
                  padding: isCenter ? "22px 16px" : "18px 14px",
                  borderRadius: "16px",
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", textAlign: "center", gap: "9px",
                  position: "relative", overflow: "hidden",
                  transform: isCenter ? "translateY(-6px)" : "none",
                  boxShadow: isCenter ? `0 8px 40px ${s.glow}` : "none",
                }}>
                  {isCenter && (
                    <div style={{
                      position: "absolute", top: "-30px", left: "50%", transform: "translateX(-50%)",
                      width: "120px", height: "120px", borderRadius: "50%",
                      background: s.glow, filter: "blur(30px)",
                      pointerEvents: "none",
                    }} />
                  )}
                  <span style={{ fontSize: isCenter ? "28px" : "22px", position: "relative" }}>{s.medal}</span>
                  <div style={{ position: "relative" }}>
                    <p style={{
                      fontSize: "12px", fontWeight: 700,
                      background: s.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                      marginBottom: "3px",
                    }}>{rep.icon} {rep.rank}</p>
                    <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>
                      {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                    </p>
                  </div>
                  <p style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: isCenter ? "18px" : "14px", fontWeight: 700,
                    background: s.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    position: "relative",
                  }}>
                    {(entry.score / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table */}
      {!isLoading && entries.length > 0 && (
        <div style={{
          borderRadius: "16px",
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
          overflow: "hidden",
        }}>
          {/* Rainbow top */}
          <div style={{ height: "1px", background: "linear-gradient(90deg,#7c6aff,#ff6eb4,#ffbd59,transparent)" }} />

          {/* Header */}
          <div style={{
            display: "grid", gridTemplateColumns: "52px 1fr 120px 110px",
            padding: "11px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            background: "rgba(255,255,255,0.02)",
          }}>
            {["RANK", "VOLUNTEER", "TIER", "SCORE"].map((h, i) => (
              <p key={h} style={{
                fontSize: "9px", fontWeight: 700,
                color: "rgba(255,255,255,0.25)", letterSpacing: "0.12em",
                textAlign: i === 3 ? "right" : "left",
                fontFamily: "'JetBrains Mono',monospace",
              }}>{h}</p>
            ))}
          </div>

          {/* Rows */}
          {entries.map((e, i) => {
            const rep    = getRank(e.score / 100);
            const medals = ["🥇", "🥈", "🥉"];
            const isTop  = e.rank <= 3;
            const scoreGrad = e.rank === 1
              ? "linear-gradient(135deg,#ffbd59,#ff6eb4)"
              : e.rank <= 3
              ? "linear-gradient(135deg,#00dfb2,#7c6aff)"
              : "none";
            return (
              <div key={e.address}
                style={{
                  display: "grid", gridTemplateColumns: "52px 1fr 120px 110px",
                  padding: "12px 18px", alignItems: "center",
                  borderBottom: i < entries.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                  transition: "background 0.12s",
                  position: "relative",
                }}
                onMouseEnter={ev => (ev.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
                onMouseLeave={ev => (ev.currentTarget as HTMLDivElement).style.background = "transparent"}
              >
                {/* Rank number / medal */}
                <p style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: isTop ? "16px" : "13px", fontWeight: 700,
                  color: "rgba(255,255,255,0.3)",
                }}>{isTop ? medals[e.rank - 1] : `#${e.rank}`}</p>

                <p style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "12px", color: "rgba(255,255,255,0.6)",
                }}>{e.address.slice(0, 10)}…{e.address.slice(-6)}</p>

                <span style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "10px", fontWeight: 600,
                  padding: "3px 9px", borderRadius: "6px",
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                  color: "rgba(255,255,255,0.5)", display: "inline-block",
                }}>{rep.icon} {rep.rank}</span>

                <p style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "14px", fontWeight: 800,
                  textAlign: "right",
                  background: scoreGrad !== "none" ? scoreGrad : "none",
                  WebkitBackgroundClip: scoreGrad !== "none" ? "text" : undefined,
                  WebkitTextFillColor: scoreGrad !== "none" ? "transparent" : undefined,
                  color: scoreGrad === "none" ? "rgba(255,255,255,0.7)" : "transparent",
                }}>
                  {(e.score / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </p>
              </div>
            );
          })}

          {/* Pagination */}
          {pages > 1 && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 18px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              background: "rgba(255,255,255,0.02)",
            }}>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono',monospace" }}>
                {page + 1} / {pages} · {totalN} entries
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                {[
                  { label: "← Prev", dis: page === 0,           fn: () => setPage(p => p - 1) },
                  { label: "Next →", dis: page >= pages - 1,    fn: () => setPage(p => p + 1) },
                ].map(b => (
                  <button key={b.label} onClick={b.fn} disabled={b.dis}
                    style={{
                      padding: "6px 14px", borderRadius: "8px",
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                      fontSize: "11px", color: "rgba(255,255,255,0.5)",
                      opacity: b.dis ? 0.3 : 1, cursor: b.dis ? "not-allowed" : "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { if (!b.dis) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; }}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(0.7)}}`}</style>
    </div>
  );
}