"use client";

import { useReadContract } from "wagmi";
import { REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";

const BADGE_META = [
  { id: 1, icon: "🌱", name: "First Step",    desc: "Submitted your first impact proof",          tier: "common"    },
  { id: 2, icon: "🤝", name: "Helper",        desc: "Completed 5 verified impact events",          tier: "common"    },
  { id: 3, icon: "⭐", name: "Dedicated",     desc: "Completed 10 verified impact events",         tier: "rare"      },
  { id: 4, icon: "⚔️", name: "Champion",      desc: "Completed 25 verified impact events",         tier: "rare"      },
  { id: 5, icon: "🏆", name: "Legend",        desc: "Completed 50 verified impact events",         tier: "epic"      },
  { id: 6, icon: "🔥", name: "High Impact",   desc: "Achieved impact score 80+ in a single event", tier: "rare"      },
  { id: 7, icon: "💯", name: "Perfect Score", desc: "Achieved a perfect 100 impact score",          tier: "epic"      },
  { id: 8, icon: "🌍", name: "Century",       desc: "Accumulated 10,000+ cumulative impact points", tier: "legendary" },
  { id: 9, icon: "⚡", name: "Titan",         desc: "Accumulated 50,000+ cumulative impact points", tier: "legendary" },
];

const TIER_STYLE: Record<string, { border: string; bg: string; label: string; glow: string }> = {
  common:    { border: "rgba(154,148,144,0.25)", bg: "rgba(154,148,144,0.06)", label: "#9A9490", glow: "none" },
  rare:      { border: "rgba(96,165,250,0.3)",   bg: "rgba(96,165,250,0.07)", label: "#60A5FA", glow: "0 0 12px rgba(96,165,250,0.15)" },
  epic:      { border: "rgba(167,139,250,0.3)",  bg: "rgba(167,139,250,0.07)",label: "#A78BFA", glow: "0 0 16px rgba(167,139,250,0.2)"  },
  legendary: { border: "rgba(201,168,76,0.35)",  bg: "rgba(201,168,76,0.08)", label: "#C9A84C", glow: "0 0 20px rgba(201,168,76,0.2)"   },
};

function formatDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function BadgeCard({ badge, earned, earnedAt }: {
  badge: typeof BADGE_META[0];
  earned: boolean;
  earnedAt: number;
}) {
  const t = TIER_STYLE[badge.tier];
  return (
    <div style={{
      position: "relative",
      borderRadius: "14px",
      padding: "16px",
      border: `1px solid ${earned ? t.border : "rgba(255,255,255,0.04)"}`,
      background: earned ? t.bg : "rgba(255,255,255,0.01)",
      boxShadow: earned ? t.glow : "none",
      opacity: earned ? 1 : 0.38,
      filter: earned ? "none" : "grayscale(1)",
      transition: "all 0.2s",
      cursor: "default",
    }}
    onMouseEnter={e => {
      if (earned) (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
    }}
    >
      {/* Tier label */}
      {earned && (
        <span style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          fontFamily: "monospace",
          fontSize: "9px",
          fontWeight: 700,
          color: t.label,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          opacity: 0.8,
        }}>
          {badge.tier}
        </span>
      )}

      {/* Lock icon if not earned */}
      {!earned && (
        <span style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          fontSize: "11px",
          opacity: 0.4,
        }}>
          🔒
        </span>
      )}

      {/* Icon */}
      <div style={{
        fontSize: "28px",
        marginBottom: "10px",
        lineHeight: 1,
      }}>
        {badge.icon}
      </div>

      {/* Name */}
      <div style={{
        fontFamily: "monospace",
        fontWeight: 700,
        fontSize: "13px",
        color: earned ? "var(--text)" : "var(--text-3)",
        marginBottom: "5px",
      }}>
        {badge.name}
      </div>

      {/* Description */}
      <div style={{
        fontFamily: "monospace",
        fontSize: "10px",
        color: "var(--text-3)",
        lineHeight: 1.5,
        marginBottom: earned && earnedAt ? "10px" : 0,
      }}>
        {badge.desc}
      </div>

      {/* Earned date */}
      {earned && earnedAt > 0 && (
        <div style={{
          fontFamily: "monospace",
          fontSize: "10px",
          color: t.label,
          opacity: 0.8,
        }}>
          ✓ {formatDate(earnedAt)}
        </div>
      )}
    </div>
  );
}

interface Props { address: string; }

export default function Badges({ address }: Props) {
  const { data: badgeIds } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getBadges",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  const { data: allBadges } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getAllBadges",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  const earnedSet = new Set((badgeIds as number[] | undefined)?.map(Number) ?? []);
  const earnedAtMap: Record<number, number> = {};
  if (allBadges) {
    (allBadges as any[]).forEach((b) => {
      earnedAtMap[Number(b.id)] = Number(b.earnedAt);
    });
  }

  const earnedCount = earnedSet.size;

  return (
    <div>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "20px",
        flexWrap: "wrap",
        gap: "10px",
      }}>
        <div>
          <h2 style={{
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: "16px",
            color: "var(--text)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}>
            <span style={{ color: "#C9A84C" }}>◆</span> Achievement Badges
          </h2>
          <p style={{
            fontFamily: "monospace",
            fontSize: "11px",
            color: "var(--text-3)",
            marginTop: "4px",
            letterSpacing: "0.06em",
          }}>
            {earnedCount} / {BADGE_META.length} earned
          </p>
        </div>

        {/* Progress bar */}
        <div style={{ minWidth: "160px" }}>
          <div style={{
            height: "4px",
            borderRadius: "100px",
            background: "rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              borderRadius: "100px",
              width: `${(earnedCount / BADGE_META.length) * 100}%`,
              background: "linear-gradient(90deg, var(--cyan), #C9A84C)",
              transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>
          <div style={{
            fontFamily: "monospace",
            fontSize: "10px",
            color: "var(--text-3)",
            marginTop: "5px",
            textAlign: "right",
          }}>
            {Math.round((earnedCount / BADGE_META.length) * 100)}% complete
          </div>
        </div>
      </div>

      {/* Badge Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: "12px",
      }}>
        {BADGE_META.map((badge) => (
          <BadgeCard
            key={badge.id}
            badge={badge}
            earned={earnedSet.has(badge.id)}
            earnedAt={earnedAtMap[badge.id] ?? 0}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{
        marginTop: "20px",
        display: "flex",
        gap: "16px",
        flexWrap: "wrap",
      }}>
        {Object.entries(TIER_STYLE).map(([tier, s]) => (
          <div key={tier} style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontFamily: "monospace",
            fontSize: "10px",
            color: s.label,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            <div style={{
              width: "8px", height: "8px",
              borderRadius: "2px",
              background: s.bg,
              border: `1px solid ${s.border}`,
            }} />
            {tier}
          </div>
        ))}
      </div>
    </div>
  );
}