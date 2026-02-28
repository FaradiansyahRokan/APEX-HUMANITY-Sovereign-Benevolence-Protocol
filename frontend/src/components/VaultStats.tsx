"use client";

import { useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { BENEVOLENCE_VAULT_ABI, REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";
import { useEffect, useRef } from "react";

// ─── Number Animation ──────────────────────────────────────────────────
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

// ─── Custom Animated SVGs (Fisika & Jaringan Vektor) ───────────────────
const IconVerified = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path className="svg-draw" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="url(#grad1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path className="svg-pulse" d="M9 12l2 2 4-4" stroke="url(#grad1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconVolunteers = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="7" r="3" stroke="url(#grad2)" strokeWidth="1.5" className="svg-float" />
    <circle cx="6" cy="17" r="3" stroke="url(#grad2)" strokeWidth="1.5" className="svg-float" style={{ animationDelay: "0.4s" }} />
    <circle cx="18" cy="17" r="3" stroke="url(#grad2)" strokeWidth="1.5" className="svg-float" style={{ animationDelay: "0.8s" }} />
    <path d="M10.5 9.5l-3 4.5M13.5 9.5l3 4.5M8.5 17h7" stroke="url(#grad2)" strokeWidth="1.5" strokeDasharray="3 3" className="svg-flow" />
  </svg>
);

const IconApex = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path className="svg-draw" d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="url(#grad3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path className="svg-glow-core" d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="url(#grad3)" opacity="0.3" />
  </svg>
);

const IconImpact = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <ellipse cx="12" cy="12" rx="10" ry="4" stroke="url(#grad4)" strokeWidth="1.5" transform="rotate(45 12 12)" className="svg-orbit" />
    <ellipse cx="12" cy="12" rx="10" ry="4" stroke="url(#grad4)" strokeWidth="1.5" transform="rotate(-45 12 12)" className="svg-orbit-reverse" />
    <circle cx="12" cy="12" r="2" fill="url(#grad4)" className="svg-pulse" />
  </svg>
);

// ─── Konfigurasi Gaya Vektor ───────────────────────────────────────────
const STAT_STYLES = [
  { colors: ["#00dfb2", "#7c6aff"], glow: "rgba(0,223,178,0.25)", icon: <IconVerified /> },
  { colors: ["#7c6aff", "#ff6eb4"], glow: "rgba(124,106,255,0.25)", icon: <IconVolunteers /> },
  { colors: ["#ffbd59", "#ff6eb4"], glow: "rgba(255,189,89,0.25)", icon: <IconApex /> },
  { colors: ["#7c6aff", "#00dfb2"], glow: "rgba(124,106,255,0.2)", icon: <IconImpact /> },
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
    { label: "Volunteers", value: global ? Number(global[0]) : null, dec: 0 },
    { label: "APEX Distributed", value: vault ? Number(formatUnits(vault[1], 18)) : null, dec: 2 },
    { label: "Total Impact", value: global ? Number(global[1]) / 100 : null, dec: 0 },
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
      {/* ─── Definisi SVG Gradients ─── */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          {STAT_STYLES.map((st, i) => (
            <linearGradient key={i} id={`grad${i + 1}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={st.colors[0]} />
              <stop offset="100%" stopColor={st.colors[1]} />
            </linearGradient>
          ))}
        </defs>
      </svg>

      {/* Rainbow line top */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: "1px",
        background: "linear-gradient(90deg, #00dfb2, #7c6aff, #ffbd59, #ff6eb4, #00dfb2)",
        backgroundSize: "200% 100%",
        animation: "slideGradient 4s linear infinite"
      }} />

      <div className="stats-grid" style={{
        maxWidth: "var(--mw)", margin: "0 auto",
        padding: "0 20px", display: "grid", alignItems: "stretch",
      }}>
        {stats.map((s, i) => {
          const style = STAT_STYLES[i];
          const gradText = `linear-gradient(135deg, ${style.colors[0]}, ${style.colors[1]})`;
          return (
            <div key={s.label} className="cyber-stat-card" style={{
              padding: "22px 0",
              position: "relative",
              cursor: "default",
            }}>
              {/* Glow blob - Diperluas dan merespons CSS hover */}
              <div className="cyber-glow" style={{
                position: "absolute", top: "50%", left: "20px",
                transform: "translateY(-50%)",
                width: "60px", height: "60px", borderRadius: "50%",
                background: style.glow,
                filter: "blur(20px)",
                pointerEvents: "none",
                transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
              }} />

              <div className="stat-header" style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", position: "relative" }}>
                {/* Frame Ikon Cyberpunk */}
                <div className="cyber-icon-box" style={{
                  width: "32px", height: "32px", borderRadius: "8px",
                  background: `linear-gradient(135deg, ${style.colors[0]}15, ${style.colors[1]}15)`,
                  border: `1px solid ${style.colors[0]}40`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: `0 2px 12px ${style.glow}, inset 0 0 8px ${style.glow}`,
                  transition: "all 0.3s ease",
                }}>
                  {style.icon}
                </div>
                <span style={{
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontSize: "10px", fontWeight: 700,
                  color: "rgba(255,255,255,0.5)",
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  transition: "color 0.3s ease",
                }} className="cyber-label">{s.label}</span>
              </div>

              <p style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 700,
                background: s.value !== null ? gradText : "none",
                WebkitBackgroundClip: s.value !== null ? "text" : undefined,
                WebkitTextFillColor: s.value !== null ? "transparent" : undefined,
                color: s.value !== null ? "transparent" : "rgba(255,255,255,0.2)",
                lineHeight: 1,
                position: "relative",
                transition: "transform 0.3s ease",
              }} className="cyber-value">
                {s.value !== null
                  ? <AnimNum to={s.value} dec={s.dec} />
                  : <span style={{ fontSize: "16px", letterSpacing: "2px" }}>WAIT...</span>
                }
              </p>
            </div>
          );
        })}

      </div>

      {/* ─── CSS Keyframes & Micro-Interactions ─── */}
      <style>{`
        /* Animasi SVGs */
        .svg-draw { stroke-dasharray: 100; stroke-dashoffset: 100; animation: drawLine 3s ease forwards; }
        .svg-pulse { animation: sysPulse 2s infinite alternate; }
        .svg-glow-core { animation: coreGlow 2s ease-in-out infinite alternate; }
        .svg-orbit { transform-origin: center; animation: orbitSpin 6s linear infinite; }
        .svg-orbit-reverse { transform-origin: center; animation: orbitSpinRev 8s linear infinite; }
        .svg-float { animation: floatingNode 3s ease-in-out infinite alternate; }
        .svg-flow { animation: dashFlow 20s linear infinite; }

        @keyframes drawLine { to { stroke-dashoffset: 0; } }
        @keyframes orbitSpin { 100% { transform: rotate(405deg); } }
        @keyframes orbitSpinRev { 100% { transform: rotate(-405deg); } }
        @keyframes floatingNode { 0% { transform: translateY(-1px); } 100% { transform: translateY(1px); } }
        @keyframes dashFlow { to { stroke-dashoffset: -100; } }
        @keyframes coreGlow { 0% { opacity: 0.2; transform: scale(0.95); } 100% { opacity: 0.6; transform: scale(1.05); } }
        
        @keyframes sysPulse {
          0%, 100% { opacity: 1; transform: scale(1); filter: brightness(1); }
          50% { opacity: 0.4; transform: scale(0.85); filter: brightness(0.5); }
        }
        @keyframes slideGradient {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }

        /* CSS Desktop/Tablet */
        .cyber-value {
          font-size: 26px;
          letter-spacing: -0.04em;
          padding-left: 42px; /* Seimbang dengan lebar ikon (32px + 10px gap) */
        }
        .stats-grid {
          grid-template-columns: repeat(4, 1fr) auto;
        }

        @media (max-width: 1000px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr); padding-bottom: 20px; }
          .cyber-stat-card { border-bottom: 1px solid rgba(255,255,255,0.05); }
        }
        
        /* 📱 Khusus Tampilan Mobile (Centering & Redesign) */
        @media (max-width: 600px) {
          .stats-grid {
            grid-template-columns: repeat(2, 1fr); 
            gap: 16px; 
            padding: 24px 16px;
          }
          .cyber-stat-card {
            padding: 16px 10px !important;
            border: 1px solid rgba(255,255,255,0.03) !important;
            background: rgba(255,255,255,0.015);
            border-radius: 16px;
            display: flex;
            flex-direction: column;
            align-items: center; /* Rata tengah */
            text-align: center;
          }
          .stat-header {
            justify-content: center;
            margin-bottom: 12px !important;
            gap: 6px !important;
          }
          .cyber-icon-box {
            width: 20px !important; height: 20px !important;
            border-radius: 6px !important;
          }
          .cyber-icon-box svg {
            width: 12px; height: 12px;
          }
          .cyber-glow {
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
          }
          .cyber-label {
            font-size: 9px !important;
            letter-spacing: 0.08em !important;
          }
          .cyber-value {
            font-size: 20px !important;
            padding-left: 0 !important; /* Hilangkan padding supaya rata tengah murni */
          }
          
        }

        /* Interaksi Hover (Cyber-Stat-Card) */
        .cyber-stat-card:hover .cyber-glow {
          width: 90px;
          height: 90px;
          opacity: 0.8;
          filter: blur(25px);
        }
        .cyber-stat-card:hover .cyber-icon-box {
          transform: translateY(-2px) scale(1.05);
          border-color: rgba(255,255,255,0.4);
        }
        .cyber-stat-card:hover .cyber-label {
          color: rgba(255,255,255,0.9);
        }
        .cyber-stat-card:hover .cyber-value {
          transform: translateX(2px);
        }
      `}</style>
    </div>
  );
}