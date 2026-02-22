"use client";

import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { REPUTATION_LEDGER_ABI, IMPACT_TOKEN_ABI } from "../utils/abis";
import { CONTRACTS, getRank, REPUTATION_RANKS } from "../utils/constants";

interface Props { address: string; reputationScore: number; }

const colorVars: Record<string, { accent: string; border: string; bg: string }> = {
  gray:    { accent: "#9A9490", border: "rgba(154,148,144,0.2)", bg: "rgba(154,148,144,0.05)" },
  blue:    { accent: "#60A5FA", border: "rgba(96,165,250,0.2)",  bg: "rgba(96,165,250,0.05)"  },
  purple:  { accent: "#A78BFA", border: "rgba(167,139,250,0.2)", bg: "rgba(167,139,250,0.05)" },
  gold:    { accent: "#C9A84C", border: "rgba(201,168,76,0.25)", bg: "rgba(201,168,76,0.06)"  },
  rainbow: { accent: "#00D4FF", border: "rgba(0,212,255,0.25)",  bg: "rgba(0,212,255,0.06)"   },
};

export default function ReputationCard({ address, reputationScore }: Props) {
  const rank       = getRank(reputationScore);
  const cv         = colorVars[rank.color] ?? colorVars.gray;
  const rankIdx    = REPUTATION_RANKS.findIndex((r) => r.rank === rank.rank);
  const nextRank   = REPUTATION_RANKS[rankIdx + 1];
  const progress   = nextRank
    ? Math.min(((reputationScore - rank.threshold) / (nextRank.threshold - rank.threshold)) * 100, 100)
    : 100;

  const { data: repData } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getReputation",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  const { data: goodBalance } = useReadContract({
    address: CONTRACTS.GOOD_TOKEN as `0x${string}`,
    abi: IMPACT_TOKEN_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  const { data: totalSupply } = useReadContract({
    address: CONTRACTS.GOOD_TOKEN as `0x${string}`,
    abi: IMPACT_TOKEN_ABI,
    functionName: "totalSupply",
  });

  const { data: history } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getScoreHistory",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  const cumScore = repData ? Number((repData as any)[0]) / 100 : reputationScore;
  const eventCount  = repData ? Number((repData as any)[1]) : 0;
  const lastUpdated = repData ? Number((repData as any)[2]) : 0;

  const goodFmt = goodBalance
    ? Number(formatUnits(goodBalance as bigint, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";

  const ownershipPct = goodBalance && totalSupply && (totalSupply as bigint) > 0n
    ? ((Number(goodBalance as bigint) / Number(totalSupply as bigint)) * 100).toFixed(3)
    : "0.000";

  const scoreHistory = (history as any[]) ?? [];
  const recent = [...scoreHistory].reverse().slice(0, 5);
  const lastActive = lastUpdated > 0
    ? new Date(lastUpdated * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Never";

  return (
    <div className="space-y-3">

      {/* ── Identity Card ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: cv.bg, border: `1px solid ${cv.border}` }}>

        {/* Top stripe */}
        <div className="h-0.5 w-full" style={{
          background: `linear-gradient(90deg, transparent, ${cv.accent}, transparent)`
        }} />

        <div className="p-6">
          {/* Header row */}
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl"
                style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${cv.border}` }}>
                {rank.icon}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-base" style={{ color: "var(--text)" }}>{rank.rank}</span>
                  <span className="mono text-xs px-2 py-0.5 rounded-full"
                    style={{ background: cv.bg, border: `1px solid ${cv.border}`, color: cv.accent, letterSpacing: "0.08em" }}>
                    {rank.description}
                  </span>
                </div>
                <p className="mono text-xs" style={{ color: "var(--text-3)" }}>
                  {address.slice(0, 10)}...{address.slice(-8)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold" style={{ color: cv.accent, textShadow: `0 0 20px ${cv.border}` }}>
                {cumScore.toLocaleString("en-US")}
              </p>
              <p className="text-xs mono" style={{ color: "var(--text-3)" }}>impact points</p>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: "Events",       value: eventCount.toString(),  color: "var(--text)" },
              { label: "GOOD Tokens",  value: goodFmt,                color: "var(--emerald)" },
              { label: "Token Share",  value: `${ownershipPct}%`,     color: "var(--cyan)" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl p-3 text-center"
                style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)" }}>
                <p className="font-bold text-lg" style={{ color: s.color }}>{s.value}</p>
                <p className="text-xs mono mt-0.5" style={{ color: "var(--text-3)" }}>{s.label}</p>
              </div>
            ))}
          </div>

          <p className="mono text-xs mb-4" style={{ color: "var(--text-3)" }}>
            Last active: <span style={{ color: "var(--text-2)" }}>{lastActive}</span>
          </p>

          {/* Progress bar */}
          {nextRank ? (
            <div>
              <div className="flex justify-between mono text-xs mb-2" style={{ color: "var(--text-3)" }}>
                <span>Next: {nextRank.icon} {nextRank.rank}</span>
                <span>{cumScore.toLocaleString("en-US")} / {nextRank.threshold.toLocaleString("en-US")}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${cv.accent}, var(--cyan))` }} />
              </div>
              <p className="mono text-xs mt-1.5" style={{ color: "var(--text-3)" }}>
                {(nextRank.threshold - cumScore).toLocaleString("en-US")} pts remaining
              </p>
            </div>
          ) : (
            <div className="text-center py-2.5 rounded-xl mono text-xs"
              style={{ background: "var(--gold-dim)", border: "1px solid rgba(201,168,76,0.2)", color: "var(--gold)", letterSpacing: "0.08em" }}>
              ⚡ MAXIMUM RANK — APEX OF HUMANITY
            </div>
          )}
        </div>
      </div>

      {/* ── GOOD Token Card ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold text-sm" style={{ color: "var(--text)" }}>GOOD Token Balance</p>
          <div className="flex items-center gap-1.5 mono text-xs px-2.5 py-1 rounded-full"
            style={{ background: "var(--emerald-dim)", border: "1px solid rgba(16,217,136,0.15)", color: "var(--emerald)" }}>
            <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: "var(--emerald)" }} />
            LIVE
          </div>
        </div>

        <div className="flex items-end gap-2 mb-4">
          <span className="text-4xl font-bold num-green">{goodFmt}</span>
          <span className="mono text-sm pb-1" style={{ color: "var(--text-3)" }}>GOOD</span>
        </div>

        {totalSupply && (totalSupply as bigint) > 0n && (
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)" }}>
            <div className="flex justify-between mono text-xs mb-1.5" style={{ color: "var(--text-3)" }}>
              <span>Share of total supply</span>
              <span style={{ color: "var(--emerald)" }}>{ownershipPct}%</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full"
                style={{ width: `${Math.min(parseFloat(ownershipPct) * 20, 100)}%`,
                  background: "linear-gradient(90deg, var(--emerald), var(--cyan))" }} />
            </div>
            <p className="mono text-xs mt-1.5" style={{ color: "var(--text-3)" }}>
              Total: {Number(formatUnits(totalSupply as bigint, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 })} GOOD
            </p>
          </div>
        )}
      </div>

      {/* ── Activity History ─────────────────────────────────────────────────── */}
      {recent.length > 0 ? (
        <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="font-semibold text-sm mb-4" style={{ color: "var(--text)" }}>Recent Activity</p>
          <div className="space-y-2">
            {recent.map((e: any, i: number) => {
              const score = Number(e.score ?? 0);
              const ts    = Number(e.timestamp ?? 0);
              const date  = ts > 0 ? new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
              return (
                <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                  style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cyan)" }} />
                    <span className="mono text-xs" style={{ color: "var(--text-2)" }}>{date}</span>
                  </div>
                  <span className="mono text-xs font-semibold num-cyan">+{(score / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} pts</span>
                </div>
              );
            })}
          </div>
          <p className="mono text-xs mt-3 text-center" style={{ color: "var(--text-3)" }}>
            {scoreHistory.length} events recorded on-chain
          </p>
        </div>
      ) : eventCount === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-2xl mb-2">◎</p>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>No events yet</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Submit your first impact proof</p>
        </div>
      ) : null}
    </div>
  );
}