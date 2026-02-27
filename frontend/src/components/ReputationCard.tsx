"use client";

import { useReadContract, useBalance } from "wagmi";
import { REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS, getRank, REPUTATION_RANKS } from "../utils/constants";

interface Props { address: string; reputationScore: number; }

const glassCard: React.CSSProperties = {
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(255,255,255,0.03)",
  backdropFilter: "blur(12px)",
  overflow: "hidden",
};

export default function ReputationCard({ address, reputationScore }: Props) {
  const rank = getRank(reputationScore);
  const rIdx = REPUTATION_RANKS.findIndex(r => r.rank === rank.rank);
  const next = REPUTATION_RANKS[rIdx + 1];
  const pct = next
    ? Math.min(((reputationScore - rank.threshold) / (next.threshold - rank.threshold)) * 100, 100)
    : 100;

  const { data: rep } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getReputation",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  const { data: apexBalance } = useBalance({
    address: address as `0x${string}`,
    query: { refetchInterval: 8_000 },
  });

  const { data: hist } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getScoreHistory",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  const score   = rep ? Number((rep as any)[0]) / 100 : reputationScore;
  const events  = rep ? Number((rep as any)[1]) : 0;
  const lastUpd = rep ? Number((rep as any)[2]) : 0;

  const apexFmt = apexBalance
    ? Number(apexBalance.formatted).toLocaleString("en-US", { maximumFractionDigits: 4 })
    : "0";

  const history  = (hist as any[]) ?? [];
  const recent   = [...history].reverse().slice(0, 5);
  const lastDate = lastUpd > 0
    ? new Date(lastUpd * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Never";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

      {/* ── Hero identity card ── */}
      <div style={{ ...glassCard, position: "relative" }}>
        {/* Rainbow top border */}
        <div style={{ height: "2px", background: "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59,#ff6eb4)" }} />

        {/* Ambient glow */}
        <div style={{
          position: "absolute", top: "-30px", right: "-30px",
          width: "160px", height: "160px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,106,255,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        <div style={{ padding: "24px" }}>
          {/* Rank + address row */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", marginBottom: "24px" }}>
            <div style={{
              width: "56px", height: "56px", borderRadius: "16px",
              background: "linear-gradient(135deg, rgba(124,106,255,0.2), rgba(0,223,178,0.2))",
              border: "1px solid rgba(124,106,255,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "26px", flexShrink: 0,
              boxShadow: "0 4px 20px rgba(124,106,255,0.2)",
            }}>{rank.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <p style={{
                  fontFamily: "'Plus Jakarta Sans',sans-serif",
                  fontWeight: 800, fontSize: "16px", color: "#fff",
                }}>{rank.rank}</p>
                <span style={{
                  padding: "2px 8px", borderRadius: "99px",
                  background: "rgba(0,223,178,0.1)", border: "1px solid rgba(0,223,178,0.2)",
                  fontSize: "9px", fontWeight: 700, color: "#00dfb2",
                  fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em",
                }}>VERIFIED</span>
              </div>
              <p style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: "11px", color: "rgba(255,255,255,0.3)",
              }}>{address.slice(0, 10)}…{address.slice(-8)}</p>
            </div>
            {/* Score big */}
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <p style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: "32px", fontWeight: 800,
                background: "linear-gradient(135deg,#00dfb2,#7c6aff)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                letterSpacing: "-0.03em", lineHeight: 1,
                filter: "drop-shadow(0 0 12px rgba(0,223,178,0.4))",
              }}>{score.toLocaleString("en-US")}</p>
              <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "3px" }}>impact pts</p>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
            {[
              { label: "Events Completed", value: events.toString(), gradient: "linear-gradient(135deg,#00dfb2,#7c6aff)", glow: "rgba(0,223,178,0.2)" },
              { label: "APEX Balance",      value: apexFmt,           gradient: "linear-gradient(135deg,#ffbd59,#ff6eb4)", glow: "rgba(255,189,89,0.2)" },
            ].map(s => (
              <div key={s.label} style={{
                padding: "14px",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", inset: 0, opacity: 0.06,
                  background: s.gradient,
                }} />
                <p style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "20px", fontWeight: 700,
                  background: s.gradient,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                  lineHeight: 1, marginBottom: "6px",
                }}>{s.value}</p>
                <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Last active */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", borderRadius: "10px",
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
            marginBottom: "18px",
          }}>
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Last Active</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{lastDate}</span>
          </div>

          {/* Rank progress */}
          {next ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "12px" }}>{next.icon}</span>
                  <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Next: {next.rank}</span>
                </div>
                <span style={{
                  fontFamily: "'JetBrains Mono',monospace", fontSize: "11px",
                  color: "#00dfb2", fontWeight: 600,
                }}>{(next.threshold - score).toLocaleString()} pts away</span>
              </div>
              {/* Progress bar */}
              <div style={{
                height: "6px", borderRadius: "3px",
                background: "rgba(255,255,255,0.06)",
                position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, height: "100%",
                  width: `${pct}%`,
                  background: "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59)",
                  borderRadius: "3px",
                  transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
                  boxShadow: "0 0 10px rgba(0,223,178,0.4)",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
                <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono',monospace" }}>{pct.toFixed(1)}%</span>
                <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono',monospace" }}>to {next.rank}</span>
              </div>
            </div>
          ) : (
            <div style={{
              textAlign: "center", padding: "12px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, rgba(255,189,89,0.1), rgba(255,110,180,0.1))",
              border: "1px solid rgba(255,189,89,0.2)",
            }}>
              <p style={{ fontSize: "11px", fontWeight: 800, color: "#ffbd59", letterSpacing: "0.1em" }}>
                ⚡ APEX OF HUMANITY — MAX RANK
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── APEX Balance card ── */}
      <div style={{ ...glassCard }}>
        <div style={{ height: "2px", background: "linear-gradient(90deg,#ffbd59,#ff6eb4,transparent)" }} />
        <div style={{ padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.09em" }}>
              Native APEX Balance
            </p>
            <p style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: "28px", fontWeight: 700,
              background: "linear-gradient(135deg,#ffbd59,#ff6eb4)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              letterSpacing: "-0.02em", lineHeight: 1,
            }}>{apexFmt}</p>
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", marginTop: "5px" }}>
              Native L1 coin · gas & transactions
            </p>
          </div>
          <div style={{
            width: "48px", height: "48px", borderRadius: "14px",
            background: "linear-gradient(135deg, rgba(255,189,89,0.15), rgba(255,110,180,0.15))",
            border: "1px solid rgba(255,189,89,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "22px",
          }}>⚡</div>
        </div>
      </div>

      {/* ── Recent activity ── */}
      {recent.length > 0 && (
        <div style={{ ...glassCard }}>
          <div style={{ height: "2px", background: "linear-gradient(90deg,#7c6aff,transparent)" }} />
          <div style={{ padding: "18px 22px" }}>
            <p style={{
              fontSize: "10px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
              letterSpacing: "0.09em", marginBottom: "14px", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600,
            }}>Recent Activity</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {recent.map((e: any, i: number) => {
                const s  = Number(e.score ?? 0), ts = Number(e.timestamp ?? 0);
                const d  = ts > 0 ? new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
                const op = 1 - i * 0.15;
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 14px", borderRadius: "10px",
                    background: "rgba(255,255,255,0.025)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    opacity: op,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{
                        width: "6px", height: "6px", borderRadius: "50%",
                        background: "linear-gradient(135deg,#7c6aff,#00dfb2)",
                        flexShrink: 0,
                      }} />
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>{d}</span>
                    </div>
                    <span style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: "12px", fontWeight: 700,
                      color: "#00dfb2",
                    }}>+{(s / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} pts</span>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: "12px" }}>
              {history.length} total events on-chain
            </p>
          </div>
        </div>
      )}

      {recent.length === 0 && events === 0 && (
        <div style={{
          ...glassCard,
          padding: "44px 20px", textAlign: "center",
        }}>
          <p style={{ fontSize: "30px", opacity: 0.08, marginBottom: "12px" }}>⛓️</p>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>No activity yet</p>
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>Submit your first impact proof to begin</p>
        </div>
      )}
    </div>
  );
}