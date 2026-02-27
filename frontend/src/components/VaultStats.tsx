"use client";

import { useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { BENEVOLENCE_VAULT_ABI, REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";
import { useEffect, useRef } from "react";

function AnimNum({ to, dec = 0 }: { to: number; dec?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  useEffect(() => {
    if (!ref.current || to === prev.current) return;
    const s = prev.current, e = to, t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 1200, 1);
      const ease = 1 - Math.pow(1 - p, 4);
      if (ref.current) ref.current.textContent = (s + (e - s) * ease).toLocaleString("en-US", { maximumFractionDigits: dec });
      if (p < 1) requestAnimationFrame(tick); else prev.current = e;
    };
    requestAnimationFrame(tick);
  }, [to, dec]);
  return <span ref={ref}>{to.toLocaleString("en-US", { maximumFractionDigits: dec })}</span>;
}

const STAT_STYLES = [
  { gradient: "linear-gradient(135deg,#00dfb2,#7c6aff)", glow: "rgba(0,223,178,0.25)", icon: "⛓️" },
  { gradient: "linear-gradient(135deg,#7c6aff,#ff6eb4)", glow: "rgba(124,106,255,0.25)", icon: "🧑‍🤝‍🧑" },
  { gradient: "linear-gradient(135deg,#ffbd59,#ff6eb4)", glow: "rgba(255,189,89,0.25)", icon: "⚡" },
  { gradient: "linear-gradient(135deg,#7c6aff,#00dfb2)", glow: "rgba(124,106,255,0.2)", icon: "💫" },
];

export default function VaultStats() {
  const { data } = useReadContracts({
    contracts: [
      { address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`, abi: BENEVOLENCE_VAULT_ABI, functionName: "getStats" },
      { address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`, abi: REPUTATION_LEDGER_ABI, functionName: "getGlobalStats" },
    ],
    query: { refetchInterval: 8_000 },
  });

  const vault = data?.[0]?.result as readonly [bigint, bigint, bigint, bigint] | undefined;
  const global = data?.[1]?.result as readonly [bigint, bigint] | undefined;

  const stats = [
    { label: "Events Verified", value: vault ? Number(vault[2]) : null, dec: 0 },
    { label: "Volunteers",       value: global ? Number(global[0]) : null, dec: 0 },
    { label: "APEX Distributed", value: vault ? Number(formatUnits(vault[1], 18)) : null, dec: 2 },
    { label: "Total Impact",     value: global ? Number(global[1]) / 100 : null, dec: 0 },
  ];

  return (
    <div style={{
      borderTop: "1px solid rgba(255,255,255,0.05)",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      background: "rgba(3,8,14,0.7)",
      backdropFilter: "blur(20px)",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Rainbow line top */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: "1px",
        background: "linear-gradient(90deg, #00dfb2, #7c6aff, #ffbd59, #ff6eb4, #00dfb2)",
      }} />

      <div style={{
        maxWidth: "var(--mw)", margin: "0 auto",
        padding: "0 40px",
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr) auto",
        alignItems: "stretch",
      }}>
        {stats.map((s, i) => {
          const style = STAT_STYLES[i];
          return (
            <div key={s.label} style={{
              padding: "22px 0",
              paddingRight: i < stats.length - 1 ? "28px" : 0,
              paddingLeft: i > 0 ? "28px" : 0,
              borderRight: i < stats.length - 1 ? "1px solid rgba(255,255,255,0.05)" : undefined,
              position: "relative",
            }}>
              {/* Glow blob */}
              <div style={{
                position: "absolute", top: "50%", left: "20px",
                transform: "translateY(-50%)",
                width: "60px", height: "60px", borderRadius: "50%",
                background: style.glow,
                filter: "blur(20px)",
                pointerEvents: "none",
              }} />

              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", position: "relative" }}>
                <div style={{
                  width: "26px", height: "26px", borderRadius: "7px",
                  background: style.gradient,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "12px",
                  boxShadow: `0 2px 12px ${style.glow}`,
                }}>
                  {style.icon}
                </div>
                <span style={{
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontSize: "10px", fontWeight: 600,
                  color: "rgba(255,255,255,0.4)",
                  letterSpacing: "0.08em", textTransform: "uppercase",
                }}>{s.label}</span>
              </div>

              <p style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "24px", fontWeight: 700,
                background: s.value !== null ? style.gradient : "none",
                WebkitBackgroundClip: s.value !== null ? "text" : undefined,
                WebkitTextFillColor: s.value !== null ? "transparent" : undefined,
                color: s.value !== null ? "transparent" : "rgba(255,255,255,0.2)",
                letterSpacing: "-0.03em", lineHeight: 1,
                position: "relative",
              }}>
                {s.value !== null
                  ? <AnimNum to={s.value} dec={s.dec} />
                  : <span style={{ fontSize: "16px" }}>—</span>
                }
              </p>
            </div>
          );
        })}

        {/* Live badge */}
        <div style={{
          display: "flex", alignItems: "center",
          paddingLeft: "28px",
          borderLeft: "1px solid rgba(255,255,255,0.05)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "6px 12px", borderRadius: "99px",
            background: "rgba(0,223,178,0.08)",
            border: "1px solid rgba(0,223,178,0.2)",
          }}>
            <div style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: "#00dfb2",
              boxShadow: "0 0 8px #00dfb2",
              animation: "pulse 2s ease-in-out infinite",
            }} />
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "9px", fontWeight: 700,
              color: "#00dfb2", letterSpacing: "0.15em",
            }}>LIVE</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}