"use client";

import { useReadContract } from "wagmi";
import { REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";

const BADGES = [
  { id: 1, icon: "🌱", name: "First Step",   desc: "Submitted your first impact proof",          tier: "common"    },
  { id: 2, icon: "🤝", name: "Helper",       desc: "Completed 5 verified impact events",         tier: "common"    },
  { id: 3, icon: "⭐", name: "Dedicated",    desc: "Completed 10 verified impact events",        tier: "rare"      },
  { id: 4, icon: "⚔️", name: "Champion",    desc: "Completed 25 verified impact events",        tier: "rare"      },
  { id: 5, icon: "🏆", name: "Legend",       desc: "Completed 50 verified impact events",        tier: "epic"      },
  { id: 6, icon: "🔥", name: "High Impact",  desc: "Impact score 80+ in a single event",         tier: "rare"      },
  { id: 7, icon: "💯", name: "Perfect",      desc: "Achieved a perfect 100 impact score",        tier: "epic"      },
  { id: 8, icon: "🌍", name: "Century",      desc: "10,000+ cumulative impact points",           tier: "legendary" },
  { id: 9, icon: "⚡", name: "Titan",        desc: "50,000+ cumulative impact points",           tier: "legendary" },
];

const TIERS: Record<string, { gradient: string; glow: string; bg: string; border: string; label: string }> = {
  common:    { gradient: "linear-gradient(135deg,#8899aa,#aabbcc)", glow: "rgba(160,180,200,0.15)", bg: "rgba(160,180,200,0.06)", border: "rgba(160,180,200,0.12)", label: "Common"    },
  rare:      { gradient: "linear-gradient(135deg,#00dfb2,#7c6aff)", glow: "rgba(0,223,178,0.2)",   bg: "rgba(0,223,178,0.06)",   border: "rgba(0,223,178,0.18)",   label: "Rare"      },
  epic:      { gradient: "linear-gradient(135deg,#7c6aff,#ff6eb4)", glow: "rgba(124,106,255,0.2)", bg: "rgba(124,106,255,0.06)", border: "rgba(124,106,255,0.2)",  label: "Epic"      },
  legendary: { gradient: "linear-gradient(135deg,#ffbd59,#ff6eb4)", glow: "rgba(255,189,89,0.25)", bg: "rgba(255,189,89,0.07)",  border: "rgba(255,189,89,0.22)",  label: "Legendary" },
};

function fmtDate(ts: number) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function BadgeCard({ b, earned, at }: { b: typeof BADGES[0]; earned: boolean; at: number }) {
  const t = TIERS[b.tier];
  return (
    <div style={{
      borderRadius: "14px",
      padding: "16px 14px 14px",
      border: `1px solid ${earned ? t.border : "rgba(255,255,255,0.04)"}`,
      background: earned ? t.bg : "rgba(255,255,255,0.01)",
      opacity: earned ? 1 : 0.35,
      filter: earned ? "none" : "grayscale(1)",
      display: "flex", flexDirection: "column",
      alignItems: "center", textAlign: "center", gap: "9px",
      transition: "transform 0.2s ease, box-shadow 0.2s ease",
      cursor: "default",
      position: "relative",
      overflow: "hidden",
    }}
      onMouseEnter={e => {
        if (!earned) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "translateY(-3px)";
        el.style.boxShadow = `0 8px 30px ${t.glow}`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      {/* Glow sweep */}
      {earned && (
        <div style={{
          position: "absolute", top: "-20px", left: "50%", transform: "translateX(-50%)",
          width: "80px", height: "80px", borderRadius: "50%",
          background: t.glow, filter: "blur(20px)",
          pointerEvents: "none",
        }} />
      )}

      {/* Tier chip top right */}
      <span style={{
        position: "absolute", top: "8px", right: "8px",
        fontSize: "8px", fontWeight: 800,
        fontFamily: "'JetBrains Mono',monospace",
        background: earned ? t.gradient : "none",
        WebkitBackgroundClip: earned ? "text" : undefined,
        WebkitTextFillColor: earned ? "transparent" : undefined,
        color: earned ? "transparent" : "rgba(255,255,255,0.2)",
        textTransform: "uppercase", letterSpacing: "0.07em",
      }}>{earned ? t.label : "🔒"}</span>

      {/* Earned dot */}
      {earned && (
        <div style={{
          position: "absolute", top: "10px", left: "12px",
          width: "5px", height: "5px", borderRadius: "50%",
          background: t.gradient,
          boxShadow: `0 0 6px ${t.glow}`,
        }} />
      )}

      {/* Icon */}
      <div style={{
        width: "50px", height: "50px", borderRadius: "50%",
        background: earned
          ? `radial-gradient(circle, ${t.bg} 0%, transparent 70%)`
          : "rgba(255,255,255,0.03)",
        border: `1px solid ${earned ? t.border : "rgba(255,255,255,0.05)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "22px", marginTop: "8px",
        position: "relative",
      }}>{b.icon}</div>

      <p style={{
        fontFamily: "'Plus Jakarta Sans',sans-serif",
        fontSize: "12px", fontWeight: 700,
        color: earned ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.25)",
      }}>{b.name}</p>

      <p style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: "9px", color: "rgba(255,255,255,0.25)",
        lineHeight: 1.5, flex: 1,
      }}>{b.desc}</p>

      {earned && at > 0 && (
        <span style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: "9px",
          background: t.gradient,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          padding: "2px 8px", borderRadius: "5px",
          background2: t.bg, border: `1px solid ${t.border}`,
        } as any}>✓ {fmtDate(at)}</span>
      )}
    </div>
  );
}

export default function Badges({ address }: { address: string }) {
  const { data: ids } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getBadges",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });
  const { data: all } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getAllBadges",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  const earned = new Set((ids as number[] | undefined)?.map(Number) ?? []);
  const atMap: Record<number, number> = {};
  if (all) (all as any[]).forEach(b => { atMap[Number(b.id)] = Number(b.earnedAt); });

  const n   = earned.size;
  const pct = Math.round((n / BADGES.length) * 100);

  return (
    <div>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        marginBottom: "28px", gap: "16px", flexWrap: "wrap",
      }}>
        <div>
          <p style={{
            fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em",
            fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
            background: "linear-gradient(90deg,#ffbd59,#ff6eb4)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            marginBottom: "6px",
          }}>Achievement Badges</p>
          <p style={{
            fontFamily: "'Plus Jakarta Sans',sans-serif",
            fontWeight: 800, fontSize: "22px", color: "#fff",
          }}>
            {n}<span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400, fontSize: "16px" }}> / {BADGES.length} Unlocked</span>
          </p>
        </div>

        {/* Progress pill */}
        <div style={{
          padding: "10px 16px", borderRadius: "12px",
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
          minWidth: "180px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>Progress</span>
            <span style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", fontWeight: 700,
              background: "linear-gradient(90deg,#00dfb2,#7c6aff)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>{pct}%</span>
          </div>
          <div style={{ height: "5px", borderRadius: "3px", background: "rgba(255,255,255,0.06)" }}>
            <div style={{
              height: "100%", borderRadius: "3px", width: `${pct}%`,
              background: "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59,#ff6eb4)",
              transition: "width 0.6s ease",
              boxShadow: "0 0 8px rgba(0,223,178,0.35)",
            }} />
          </div>
        </div>
      </div>

      {/* Tier legend */}
      <div style={{
        display: "flex", gap: "20px", flexWrap: "wrap",
        marginBottom: "20px", paddingBottom: "18px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        {Object.entries(TIERS).map(([key, t]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <div style={{
              width: "10px", height: "10px", borderRadius: "3px",
              background: t.gradient,
              boxShadow: `0 0 6px ${t.glow}`,
            }} />
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{t.label}</span>
          </div>
        ))}
      </div>

      {/* Badge grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
        gap: "10px",
      }}>
        {BADGES.map(b => (
          <BadgeCard key={b.id} b={b} earned={earned.has(b.id)} at={atMap[b.id] ?? 0} />
        ))}
      </div>
    </div>
  );
}