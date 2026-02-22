"use client";

import { useState } from "react";
import { useReadContract } from "wagmi";
import { REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS, getRank } from "../utils/constants";

interface LeaderEntry { address: string; score: number; rank: number; }

function Skeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 rounded-xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="w-6 h-3 rounded animate-pulse" style={{ background: "var(--border2)" }} />
          <div className="flex-1 h-3 rounded animate-pulse" style={{ background: "var(--border2)" }} />
          <div className="w-16 h-3 rounded animate-pulse" style={{ background: "var(--border2)" }} />
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div className="py-24 text-center">
      <p className="text-4xl mb-4">◎</p>
      <p className="font-semibold" style={{ color: "var(--text-2)" }}>No volunteers yet</p>
      <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Submit your first impact proof to start the leaderboard</p>
    </div>
  );
}

const PODIUM_STYLES = [
  { medal: "🥇", accent: "var(--gold)",    border: "rgba(201,168,76,0.2)",  bg: "rgba(201,168,76,0.05)"  },
  { medal: "🥈", accent: "#94A3B8",        border: "rgba(148,163,184,0.2)", bg: "rgba(148,163,184,0.04)" },
  { medal: "🥉", accent: "#CD7F32",        border: "rgba(205,127,50,0.2)",  bg: "rgba(205,127,50,0.04)"  },
];

export default function Leaderboard() {
  const [filter, setFilter] = useState<"all" | "weekly" | "monthly">("all");
  const [page, setPage]     = useState(0);
  const PAGE_SIZE           = 10;

  const { data: totalLength } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getLeaderboardLength",
  });

  const { data: pageData, isLoading } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getLeaderboardPage",
    args: [BigInt(page * PAGE_SIZE), BigInt(PAGE_SIZE)],
    query: { refetchInterval: 10_000 },
  });

  const { data: globalStats } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getGlobalStats",
    query: { refetchInterval: 10_000 },
  });

  const addresses: readonly string[] = (pageData as any)?.[0] ?? [];
  const scores:    readonly bigint[]  = (pageData as any)?.[1] ?? [];
  const total      = Number(totalLength ?? 0);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const entries: LeaderEntry[] = addresses
    .map((addr, i) => ({ address: addr, score: Number(scores[i] ?? 0n), rank: page * PAGE_SIZE + i + 1 }))
    .sort((a, b) => b.score - a.score);

  const maxScore = entries[0]?.score ?? 1;
  const top3     = entries.slice(0, 3);

  return (
    <div className="max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-lg" style={{ color: "var(--text)" }}>◆ Reputation Leaderboard</h2>
          <p className="mono text-xs mt-1" style={{ color: "var(--text-3)" }}>
            {total > 0 ? `${total} verified volunteer${total !== 1 ? "s" : ""} on-chain` : "Live from ReputationLedger contract"}
          </p>
        </div>

        {/* Filter */}
        <div className="flex gap-0.5 p-0.5 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          {(["all", "weekly", "monthly"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-4 py-1.5 mono text-xs rounded-lg transition-all"
              style={{
                background: filter === f ? "var(--surface2)" : "transparent",
                color:      filter === f ? "var(--text)"     : "var(--text-3)",
                border:     filter === f ? "1px solid var(--border2)" : "1px solid transparent",
              }}>
              {f === "all" ? "All Time" : f === "weekly" ? "7 Days" : "30 Days"}
            </button>
          ))}
        </div>
      </div>

      {/* Global Stats */}
{globalStats && (
  <div className="grid grid-cols-2 gap-3 mb-6">
    {[
      { 
        label: "Total Volunteers", 
        value: Number((globalStats as any)[0]).toLocaleString("en-US"), 
        color: "var(--cyan)" 
      },
      { 
        label: "Total Impact Generated",
        // FIX: Dibagi 100 dan tambahkan desimal agar presisi
        value: (Number((globalStats as any)[1]) / 100).toLocaleString("en-US", { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        }), 
        color: "var(--gold)" 
      },
    ].map((s) => (
      <div key={s.label} className="rounded-xl p-4 text-center"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <p className="text-2xl font-bold mono" style={{ color: s.color }}>{s.value}</p>
        <p className="mono text-xs mt-1" style={{ color: "var(--text-3)" }}>{s.label}</p>
      </div>
    ))}
  </div>
)}

      {/* States */}
      {isLoading && <Skeleton />}
      {!isLoading && entries.length === 0 && <Empty />}

      {/* Podium */}
      {!isLoading && top3.length >= 3 && page === 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {top3.map((entry, i) => {
            const p   = PODIUM_STYLES[i];
            const rep = getRank(entry.score / 100);
            return (
              <div key={entry.address} className="rounded-2xl p-4 text-center"
                style={{ background: p.bg, border: `1px solid ${p.border}` }}>
                <div className="text-2xl mb-2">{p.medal}</div>
                <p className="font-bold text-xs mb-1" style={{ color: p.accent }}>{rep.icon} {rep.rank}</p>
                <p className="mono text-xs mb-3" style={{ color: "var(--text-3)" }}>
                  {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
                </p>
                <p className="text-xl font-bold mono" style={{ color: p.accent }}>
                  {entry.score.toLocaleString("en-US")}
                </p>
                <p className="mono text-xs mt-0.5" style={{ color: "var(--text-3)" }}>pts</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      {!isLoading && entries.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-5 py-3 mono text-xs"
            style={{ borderBottom: "1px solid var(--border)", color: "var(--text-3)", letterSpacing: "0.08em" }}>
            <div className="col-span-1">#</div>
            <div className="col-span-5">VOLUNTEER</div>
            <div className="col-span-3">TIER</div>
            <div className="col-span-3 text-right">SCORE</div>
          </div>

          {/* Rows */}
          {entries.map((entry, i) => {
            const rep = getRank(entry.score / 100);
            const barW = maxScore > 0 ? (entry.score / maxScore) * 100 : 0;
            const isTop = entry.rank <= 3;
            return (
              <div key={entry.address}
                className="group grid grid-cols-12 gap-2 px-5 py-3.5 items-center relative transition-colors"
                style={{
                  borderBottom: i < entries.length - 1 ? "1px solid var(--border)" : "none",
                  background: "transparent",
                }}>
                {/* Score bar bg */}
                <div className="absolute inset-y-0 left-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ width: `${barW}%`, background: "rgba(0,212,255,0.025)", pointerEvents: "none" }} />

                <div className="col-span-1 mono text-xs font-bold"
                  style={{ color: isTop ? "var(--gold)" : "var(--text-3)" }}>
                  {entry.rank <= 3 ? ["🥇","🥈","🥉"][entry.rank - 1] : `#${entry.rank}`}
                </div>
                <div className="col-span-5 mono text-xs" style={{ color: "var(--text-2)" }}>
                  {entry.address.slice(0, 8)}...{entry.address.slice(-6)}
                </div>
                <div className="col-span-3">
                  <span className="mono text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
                    {rep.icon} {rep.rank}
                  </span>
                </div>
                <div className="col-span-3 text-right mono text-sm font-bold" style={{ color: "var(--cyan)" }}>
                  {(entry.score / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3"
              style={{ borderTop: "1px solid var(--border)" }}>
              <span className="mono text-xs" style={{ color: "var(--text-3)" }}>
                {page + 1} / {totalPages} · {total} entries
              </span>
              <div className="flex gap-2">
                {[{ label: "← Prev", dis: page === 0, fn: () => setPage(p => p - 1) },
                  { label: "Next →", dis: page >= totalPages - 1, fn: () => setPage(p => p + 1) }].map((btn) => (
                  <button key={btn.label} onClick={btn.fn} disabled={btn.dis}
                    className="mono text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      color: btn.dis ? "var(--text-3)" : "var(--text-2)",
                      opacity: btn.dis ? 0.4 : 1,
                      cursor: btn.dis ? "not-allowed" : "pointer",
                    }}>
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Live footer */}
          <div className="px-5 py-2.5 flex items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
            <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: "var(--emerald)" }} />
            <span className="mono text-xs" style={{ color: "var(--text-3)" }}>Live on-chain · refreshes every 10s</span>
          </div>
        </div>
      )}
    </div>
  );
}