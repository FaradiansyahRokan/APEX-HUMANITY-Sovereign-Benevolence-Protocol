"use client";

import { useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { BENEVOLENCE_VAULT_ABI, REPUTATION_LEDGER_ABI, IMPACT_TOKEN_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";
import { useEffect, useRef } from "react";

function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);

  useEffect(() => {
    if (!ref.current || value === prev.current) return;
    const start = prev.current;
    const end = value;
    const duration = 800;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * ease;
      if (ref.current) {
        ref.current.textContent = current.toLocaleString("en-US", {
          maximumFractionDigits: decimals,
        });
      }
      if (progress < 1) requestAnimationFrame(tick);
      else prev.current = end;
    };

    requestAnimationFrame(tick);
  }, [value, decimals]);

  return (
    <span ref={ref}>
      {value.toLocaleString("en-US", { maximumFractionDigits: decimals })}
    </span>
  );
}

const STAT_CONFIG = [
  {
    key: "events",
    label: "Events Verified",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 7L5.5 10.5L12 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    color: "#00D4FF",
    glow: "rgba(0,212,255,0.15)",
  },
  {
    key: "volunteers",
    label: "Volunteers",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2 12c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    color: "#E8E0D5",
    glow: "rgba(232,224,213,0.1)",
  },
  {
    key: "distributed",
    label: "GOOD Distributed",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <polygon points="7,1 9,5.5 14,6 10.5,9.5 11.5,14 7,11.5 2.5,14 3.5,9.5 0,6 5,5.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
      </svg>
    ),
    color: "#C9A84C",
    glow: "rgba(201,168,76,0.15)",
  },
  {
    key: "circulating",
    label: "Circulating Supply",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 7a5 5 0 0 1 9.9-1M12 7a5 5 0 0 1-9.9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M11 3.5L12 7l-2.5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    color: "#10D988",
    glow: "rgba(16,217,136,0.15)",
  },
];

export default function VaultStats() {
  const { data } = useReadContracts({
    contracts: [
      { address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`, abi: BENEVOLENCE_VAULT_ABI, functionName: "getStats" },
      { address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`, abi: REPUTATION_LEDGER_ABI, functionName: "getGlobalStats" },
      { address: CONTRACTS.GOOD_TOKEN as `0x${string}`, abi: IMPACT_TOKEN_ABI, functionName: "circulatingSupply" },
    ],
    query: { refetchInterval: 8_000 },
  });

  const vault  = data?.[0]?.result as readonly [bigint, bigint, bigint, bigint] | undefined;
  const global = data?.[1]?.result as readonly [bigint, bigint] | undefined;
  const circ   = data?.[2]?.result as bigint | undefined;

  const stats = {
    events:      vault  ? Number(vault[2])                                        : null,
    volunteers:  global ? Number(global[0])                                       : null,
    distributed: vault  ? Number(formatUnits(vault[1], 18))                       : null,
    circulating: circ   ? Number(formatUnits(circ as bigint, 18))                 : null,
  };

  return (
    <div style={{
      position: "relative",
      borderTop: "1px solid rgba(255,255,255,0.04)",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      background: "rgba(4,4,10,0.7)",
      backdropFilter: "blur(12px)",
      overflow: "hidden",
    }}>

      {/* Subtle top gradient line */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "1px",
        background: "linear-gradient(90deg, transparent 0%, rgba(0,212,255,0.3) 25%, rgba(201,168,76,0.3) 75%, transparent 100%)",
      }} />

      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "0 24px" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr) auto",
          alignItems: "stretch",
        }}>

          {STAT_CONFIG.map((cfg, i) => {
            const value = stats[cfg.key as keyof typeof stats];
            const isLast = i === STAT_CONFIG.length - 1;

            return (
              <div key={cfg.key} style={{
                position: "relative",
                padding: "14px 20px",
                borderRight: !isLast ? "1px solid rgba(255,255,255,0.04)" : "none",
                transition: "background 0.2s",
                cursor: "default",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.background = cfg.glow;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
              >
                {/* Label row */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "6px",
                  color: cfg.color,
                  opacity: 0.6,
                  letterSpacing: "0.08em",
                }}>
                  {cfg.icon}
                  <span style={{
                    fontSize: "10px",
                    fontFamily: "monospace",
                    textTransform: "uppercase",
                    fontWeight: 500,
                  }}>
                    {cfg.label}
                  </span>
                </div>

                {/* Value */}
                <div style={{
                  fontFamily: "monospace",
                  fontWeight: 700,
                  fontSize: "18px",
                  color: value !== null ? cfg.color : "rgba(255,255,255,0.15)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1,
                }}>
                  {value !== null ? (
                    <AnimatedNumber
                      value={value}
                      decimals={["distributed", "circulating"].includes(cfg.key) ? 2 : 0}
                    />
                  ) : (
                    <span style={{ fontSize: "14px", opacity: 0.3 }}>——</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Live badge */}
          <div style={{
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            borderLeft: "1px solid rgba(255,255,255,0.04)",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 10px",
              borderRadius: "100px",
              border: "1px solid rgba(16,217,136,0.2)",
              background: "rgba(16,217,136,0.05)",
            }}>
              <div style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: "#10D988",
                boxShadow: "0 0 6px #10D988",
                animation: "pulse 2s infinite",
              }} />
              <span style={{
                fontFamily: "monospace",
                fontSize: "10px",
                fontWeight: 600,
                color: "#10D988",
                letterSpacing: "0.1em",
              }}>LIVE</span>
            </div>
          </div>

        </div>
      </div>

      {/* Bottom gradient line */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "1px",
        background: "linear-gradient(90deg, transparent 0%, rgba(201,168,76,0.2) 50%, transparent 100%)",
      }} />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}