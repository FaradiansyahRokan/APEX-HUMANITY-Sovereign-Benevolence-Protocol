"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, useBalance } from "wagmi"; // <-- Tambahkan useBalance
import { ConnectButton } from "@rainbow-me/rainbowkit";
// IMPACT_TOKEN_ABI dihapus karena sudah tidak dipakai
import { REPUTATION_LEDGER_ABI } from "@/utils/abis";
import { CONTRACTS } from "@/utils/constants";
import SubmitImpactForm from "@/components/SubmitImpactForm";
import ReputationCard from "@/components/ReputationCard";
import Leaderboard from "@/components/Leaderboard";
import VaultStats from "@/components/VaultStats";
import ImpactFeed from "@/components/Impactfeed";
import Badges from "@/components/Badges";
import P2PTransfer from "@/components/P2ptransfer";
import CommunityStream from "@/components/CommunityStream";
import ErrorBoundary from "@/components/ErrorBoundary";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";

// Helper component for counting up numbers smoothly
function AnimatedNumber({ value, isFloat = false }: { value: number, isFloat?: boolean }) {
  const mv = useMotionValue(0);
  const formatted = useTransform(mv, (latest) => {
    if (isFloat) return latest.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return Math.round(latest).toLocaleString();
  });

  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.5, ease: "easeOut" });
    return controls.stop;
  }, [value, mv]);

  return <motion.span>{formatted}</motion.span>;
}

type TabId = "submit" | "profile" | "feed" | "badges" | "leaderboard" | "transfer" | "stream";

const TABS: { id: TabId; label: string; color: string }[] = [
  { id: "submit", label: "Submit Proof", color: "var(--mi)" },
  { id: "profile", label: "My Profile", color: "var(--vi)" },
  { id: "stream", label: "🔴 Community Stream", color: "#ff6eb4" },
  { id: "feed", label: "Impact Feed", color: "var(--mi)" },
  { id: "badges", label: "Badges", color: "var(--go)" },
  { id: "leaderboard", label: "Leaderboard", color: "var(--vi)" },
  { id: "transfer", label: "P2P Transfer", color: "var(--mi)" },
];

/* ─── Hex chain background SVG ─── */
function ChainGrid() {
  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden",
      pointerEvents: "none", zIndex: 0,
    }}>
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="hexgrid" width="70" height="60.6" patternUnits="userSpaceOnUse">
            <polygon points="35,3 67,20 67,54 35,71 3,54 3,20"
              fill="none" stroke="rgba(124,106,255,0.07)" strokeWidth="0.8" />
          </pattern>
          {/* Offset row */}
          <pattern id="hexgrid2" x="35" y="30.3" width="70" height="60.6" patternUnits="userSpaceOnUse">
            <polygon points="35,3 67,20 67,54 35,71 3,54 3,20"
              fill="none" stroke="rgba(0,223,162,0.05)" strokeWidth="0.8" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hexgrid)" opacity="1" />
        <rect width="100%" height="100%" fill="url(#hexgrid2)" opacity="1" />
      </svg>
      {/* Fade mask so grid only appears subtly */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 70% 60% at 50% 40%, transparent 20%, var(--void) 80%)",
      }} />
    </div>
  );
}

/* ─── Logo ─── */
function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div style={{
        width: "34px", height: "34px", borderRadius: "10px",
        background: "linear-gradient(135deg, var(--vi), var(--mi))",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 0 20px var(--vi-glow)", flexShrink: 0,
      }}>
        {/* Chain-link inspired mark */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 4.5C6 3.12 7.12 2 8.5 2H12C13.38 2 14.5 3.12 14.5 4.5C14.5 5.88 13.38 7 12 7H10.5"
            stroke="white" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M10 11.5C10 12.88 8.88 14 7.5 14H4C2.62 14 1.5 12.88 1.5 11.5C1.5 10.12 2.62 9 4 9H5.5"
            stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.75" />
          <line x1="6.5" y1="8" x2="9.5" y2="8" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.5" />
        </svg>
      </div>
      <div>
        <p style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 800, fontSize: "13.5px",
          letterSpacing: "0.06em", color: "var(--t0)", lineHeight: 1,
        }}>APEX HUMANITY</p>
        <p className="label" style={{ marginTop: "3px", letterSpacing: "0.1em" }}>PoBA Protocol · v2</p>
      </div>
    </div>
  );
}

/* ─── Three hero orbs decorative ─── */
function HeroOrbs() {
  return (
    <>
      {/* Violet orb — left */}
      <div style={{
        position: "absolute", top: "10%", left: "-5%",
        width: "380px", height: "380px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(124,106,255,0.14) 0%, transparent 70%)",
        filter: "blur(40px)", pointerEvents: "none",
      }} />
      {/* Mint orb — right */}
      <div style={{
        position: "absolute", top: "5%", right: "-8%",
        width: "340px", height: "340px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(0,223,162,0.11) 0%, transparent 70%)",
        filter: "blur(40px)", pointerEvents: "none",
      }} />
      {/* Gold orb — bottom center */}
      <div style={{
        position: "absolute", bottom: "-10%", left: "50%", transform: "translateX(-50%)",
        width: "300px", height: "200px", borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(255,189,89,0.08) 0%, transparent 70%)",
        filter: "blur(40px)", pointerEvents: "none",
      }} />
    </>
  );
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<TabId>("submit");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // 1. Fetch Reputation dari L1 Contract
  const { data: repData } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI, functionName: "getReputation",
    args: address ? [address] : ["0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: 8_000 },
  });

  // 2. Fetch Saldo Koin Native APEX L1 menggunakan useBalance
  const { data: nativeBalance } = useBalance({
    address: address as `0x${string}`,
    query: { enabled: !!address, refetchInterval: 8_000 },
  });

  if (!mounted) return null;

  const score = repData ? Number((repData as any)[0]) / 100 : 0;

  // Format saldo koin native APEX
  const apexFmt = nativeBalance
    ? Number(nativeBalance.formatted).toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";

  return (
    <div style={{ minHeight: "100vh", background: "var(--void)" }}>

      {/* ═══ Header ═══ */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100,
        height: "var(--hh)",
        background: "rgba(3,8,14,0.80)",
        backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)",
        borderBottom: "1px solid var(--b0)",
      }}>
        <div style={{
          maxWidth: "var(--mw)", margin: "0 auto",
          height: "100%", padding: "0 40px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <Logo />
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {isConnected && nativeBalance !== undefined && (
              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "6px 14px", borderRadius: "var(--r1)",
                background: "var(--go-dim)", border: "1px solid var(--go-edge)",
              }}>
                <span style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "12px", fontWeight: 500, color: "var(--go)",
                }}>
                  {apexFmt}<span style={{ color: "rgba(255,189,89,0.5)", marginLeft: "5px" }}>APEX</span>
                </span>
              </div>
            )}
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* ═══ Hero ═══ */}
      <section style={{
        position: "relative", overflow: "hidden",
        paddingTop: "96px", paddingBottom: "80px",
      }}>
        <ChainGrid />
        <HeroOrbs />

        <div style={{
          maxWidth: "var(--mw)", margin: "0 auto",
          padding: "0 40px",
          display: "flex", flexDirection: "column",
          alignItems: "center", textAlign: "center",
          gap: "26px", position: "relative", zIndex: 2,
        }}>
          {/* Pill badge */}
          <div className="rise" style={{
            display: "inline-flex", alignItems: "center", gap: "9px",
            padding: "6px 16px", borderRadius: "99px",
            background: "var(--g1)",
            border: "1px solid var(--mi-edge)",
          }}>
            <span className="dot dot-mi" style={{ width: "6px", height: "6px" }} />
            <span className="label" style={{ color: "var(--mi)", letterSpacing: "0.12em" }}>
              Live on APEX Local L1 · SATIN Oracle
            </span>
          </div>

          {/* Headline */}
          <h1 className="display rise rise-1" style={{ maxWidth: "640px" }}>
            Proof of&nbsp;<br />
            <span className="jewel-text">Beneficial Action.</span>
          </h1>

          {/* Sub */}
          <p className="rise rise-2" style={{
            fontSize: "16px", color: "var(--t1)",
            maxWidth: "460px", lineHeight: 1.75, fontWeight: 400,
          }}>
            The world's first protocol where your most valuable asset is the number of lives
            you've changed — verified by AI, immortalized on-chain.
          </p>


        </div>
      </section>

      {/* ═══ VaultStats ═══ */}
      <VaultStats />

      {/* ═══ App (connected) ═══ */}
      {isConnected ? (
        <div style={{
          maxWidth: "var(--mw)", margin: "0 auto",
          padding: "48px 40px 120px",
        }}>
          {/* User identity card */}
          <div className="rise" style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center", gap: "20px",
            padding: "18px 24px", borderRadius: "var(--r3)",
            background: "linear-gradient(135deg, var(--vi-deep) 0%, var(--g1) 60%, var(--mi-deep) 100%)",
            border: "1px solid var(--b0)", marginBottom: "32px",
          }}>
            {/* Avatar */}
            <div style={{
              width: "42px", height: "42px", borderRadius: "12px",
              background: "linear-gradient(135deg, var(--vi-dim), var(--mi-dim))",
              border: "1px solid var(--vi-edge)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="5.5" r="2.8" stroke="var(--vi)" strokeWidth="1.5" />
                <path d="M2 16c0-3.87 3.13-7 7-7s7 3.13 7 7" stroke="var(--vi)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>

            <div>
              <p className="label" style={{ marginBottom: "4px" }}>
                {address!.slice(0, 10)}…{address!.slice(-10)}
              </p>
              <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--t0)" }}>
                Impact Score:{" "}
                <span style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  color: "var(--mi)",
                  textShadow: "0 0 16px var(--mi-glow)",
                }}><AnimatedNumber value={score} /></span>
              </p>
            </div>

            <div style={{ textAlign: "right" }}>
              <p className="label" style={{ marginBottom: "4px" }}>APEX Balance</p>
              <p style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: "18px", fontWeight: 600,
                color: "var(--go)",
                textShadow: "0 0 16px var(--go-glow)",
              }}><AnimatedNumber value={nativeBalance ? Number(nativeBalance.formatted) : 0} isFloat={true} /></p>
            </div>
          </div>

          {/* Tab Bar */}
          <div style={{
            display: "flex",
            borderBottom: "1px solid var(--b0)",
          }}>
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  position: "relative",
                  padding: "13px 20px",
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: "13px",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontWeight: active ? 700 : 400,
                  color: active ? "var(--t0)" : "var(--t2)",
                  transition: "color 0.15s",
                  whiteSpace: "nowrap",
                }}>
                  {t.label}
                  {active && <span className="tab-underline" />}
                </button>
              );
            })}
          </div>

          <div style={{ paddingTop: "40px", minHeight: "60vh" }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
              >
                <ErrorBoundary context={tab}>
                  {tab === "submit" && <SubmitImpactForm />}
                  {tab === "profile" && <div style={{ maxWidth: "520px" }}><ReputationCard address={address!} reputationScore={score} /></div>}
                  {tab === "stream" && <CommunityStream address={address!} reputationScore={score} />}
                  {tab === "feed" && <ImpactFeed />}
                  {tab === "badges" && <Badges address={address!} />}
                  {tab === "leaderboard" && <Leaderboard />}
                  {tab === "transfer" && <P2PTransfer address={address!} />}
                </ErrorBoundary>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      ) : (
        /* ─── Not connected ─── */
        <div style={{
          maxWidth: "var(--mw)", margin: "0 auto",
          padding: "60px 40px 120px",
          display: "flex", justifyContent: "center",
        }}>
          <div className="float" style={{
            maxWidth: "420px", width: "100%",
            padding: "48px 40px", borderRadius: "var(--r5)",
            background: "var(--g1)", border: "1px solid var(--b0)",
            display: "flex", flexDirection: "column",
            alignItems: "center", gap: "24px", textAlign: "center",
            position: "relative", overflow: "hidden",
            boxShadow: "0 40px 80px rgba(0,0,0,0.4)",
          }}>
            {/* Inner glow */}
            <div style={{
              position: "absolute", top: "-40%", left: "50%", transform: "translateX(-50%)",
              width: "350px", height: "250px", borderRadius: "50%",
              background: "radial-gradient(ellipse, rgba(124,106,255,0.1) 0%, transparent 70%)",
              pointerEvents: "none",
            }} />

            {/* Icon */}
            <div style={{
              width: "56px", height: "56px", borderRadius: "16px",
              background: "linear-gradient(135deg, var(--vi-dim), var(--mi-dim))",
              border: "1px solid var(--vi-edge)",
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative",
              boxShadow: "0 0 24px var(--vi-glow)",
            }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="3" y="10" width="16" height="12" rx="2.5" stroke="var(--vi)" strokeWidth="1.6" />
                <path d="M7.5 10V8.5a3.5 3.5 0 017 0V10" stroke="var(--vi)" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="11" cy="15.5" r="1.8" fill="var(--vi)" />
              </svg>
            </div>

            <div>
              <p style={{
                fontFamily: "'Plus Jakarta Sans',sans-serif",
                fontWeight: 700, fontSize: "18px", color: "var(--t0)", marginBottom: "9px",
              }}>Connect to Start</p>
              <p style={{ fontSize: "14px", color: "var(--t1)", lineHeight: 1.7 }}>
                Connect your wallet to submit impact proofs, earn APEX tokens,
                and build your on-chain Reputation Capital.
              </p>
            </div>

            <ConnectButton />

            {/* Feature row */}
            <div style={{
              display: "flex", gap: "16px",
              paddingTop: "12px",
              borderTop: "1px solid var(--b0)",
              width: "100%", justifyContent: "center", flexWrap: "wrap",
            }}>
              {[
                { icon: "🔮", text: "AI-Verified" },
                { icon: "🔒", text: "ZK-Protected" },
                { icon: "⛓️", text: "On-Chain" },
              ].map(f => (
                <div key={f.text} style={{
                  display: "flex", alignItems: "center", gap: "6px",
                }}>
                  <span style={{ fontSize: "12px" }}>{f.icon}</span>
                  <p className="label" style={{ color: "var(--t2)", letterSpacing: "0.06em" }}>{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Footer ═══ */}
      <footer style={{
        borderTop: "1px solid var(--b0)",
        padding: "28px 40px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: "12px",
      }}>
        <p className="label">© 2026 Apex Humanity Protocol</p>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span className="dot dot-mi" style={{ width: "4px", height: "4px" }} />
          <p className="label">SATIN Oracle · ZKP Shield · APEX Local Subnet</p>
        </div>
      </footer>
    </div>
  );
}