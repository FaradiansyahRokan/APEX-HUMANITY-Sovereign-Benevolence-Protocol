"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";
import { motion, AnimatePresence } from "framer-motion";

interface FeedEv {
  eventId: string; volunteer: string;
  impactScore: number; tokenReward: number;
  txHash: string; blockNumber: bigint; timestamp: number;
}

function ago(ts: number): string {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function ScoreBadge({ score }: { score: number }) {
  const high = score >= 80;
  const mid = score >= 60 && score < 80;
  const gradient = high ? "linear-gradient(135deg,#00dfb2,#7c6aff)"
    : mid ? "linear-gradient(135deg,#7c6aff,#ff6eb4)"
      : "linear-gradient(135deg,#667788,#889aaa)";
  const glow = high ? "rgba(0,223,178,0.25)" : mid ? "rgba(124,106,255,0.25)" : "transparent";

  return (
    <div style={{
      width: "46px", height: "46px", borderRadius: "12px",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", flexShrink: 0,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", inset: 0, opacity: 0.15, background: gradient,
      }} />
      <span style={{
        fontFamily: "'JetBrains Mono',monospace", fontSize: "13px", fontWeight: 800,
        background: gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        lineHeight: 1, position: "relative",
        filter: `drop-shadow(0 0 4px ${glow})`,
      }}>{score.toFixed(0)}</span>
      <span style={{ fontSize: "7px", color: "rgba(255,255,255,0.3)", marginTop: "2px", position: "relative" }}>score</span>
    </div>
  );
}

export default function ImpactFeed() {
  const client = usePublicClient();
  const [events, setEvents] = useState<FeedEv[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCnt, setNewCnt] = useState(0);

  useEffect(() => {
    if (!client) return;
    (async () => {
      try {
        const logs = await client.getLogs({
          address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
          event: {
            type: "event", name: "RewardReleased",
            inputs: [
              { type: "bytes32", name: "eventId", indexed: true },
              { type: "address", name: "volunteer", indexed: true },
              { type: "address", name: "beneficiary", indexed: true },
              { type: "uint256", name: "impactScore", indexed: false },
              { type: "uint256", name: "tokenReward", indexed: false },
              { type: "bytes32", name: "zkProofHash", indexed: false },
              { type: "bytes32", name: "eventHash", indexed: false },
              { type: "uint256", name: "timestamp", indexed: false },
            ],
          },
          fromBlock: "earliest", toBlock: "latest",
        });
        setEvents(logs.map((l: any) => ({
          eventId: l.args.eventId,
          volunteer: l.args.volunteer,
          impactScore: Number(l.args.impactScore) / 100,
          tokenReward: Number(formatUnits(l.args.tokenReward, 18)),
          txHash: l.transactionHash,
          blockNumber: l.blockNumber,
          timestamp: Number(l.args.timestamp),
        })).reverse());
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const unsub = client.watchContractEvent({
      address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
      abi: BENEVOLENCE_VAULT_ABI, eventName: "RewardReleased",
      onLogs: (logs: any[]) => {
        const ne = logs.map(l => ({
          eventId: l.args.eventId,
          volunteer: l.args.volunteer,
          impactScore: Number(l.args.impactScore) / 100,
          tokenReward: Number(formatUnits(l.args.tokenReward, 18)),
          txHash: l.transactionHash,
          blockNumber: l.blockNumber,
          timestamp: Number(l.args.timestamp),
        }));
        setEvents(p => [...ne, ...p]);
        setNewCnt(c => c + ne.length);
        setTimeout(() => setNewCnt(0), 3000);
      },
    });
    return () => unsub();
  }, [client]);

  return (
    <div style={{ maxWidth: "700px" }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "22px", flexWrap: "wrap", gap: "12px",
      }}>
        <div>
          <p style={{
            fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em",
            fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
            background: "linear-gradient(90deg,#00dfb2,#7c6aff)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            marginBottom: "6px",
          }}>Live Impact Feed</p>
          <p style={{
            fontFamily: "'Plus Jakarta Sans',sans-serif",
            fontWeight: 800, fontSize: "22px", color: "#fff",
          }}>
            {events.length.toLocaleString()}
            <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400, fontSize: "16px" }}> events on-chain</span>
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {newCnt > 0 && (
            <span style={{
              padding: "5px 12px", borderRadius: "99px",
              background: "rgba(0,223,178,0.1)", border: "1px solid rgba(0,223,178,0.2)",
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: "10px", color: "#00dfb2", fontWeight: 700,
              animation: "fadeIn 0.3s ease",
            }}>+{newCnt} new</span>
          )}
          {/* Live badge */}
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
            <span style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: "9px", fontWeight: 700, color: "#00dfb2", letterSpacing: "0.14em",
            }}>LIVE</span>
          </div>
        </div>
      </div>

      {/* Feed container */}
      <div style={{
        borderRadius: "16px",
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
        overflow: "hidden",
        position: "relative",
      }}>
        {/* Rainbow top line */}
        <div style={{
          height: "1px",
          background: "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59,#ff6eb4,#00dfb2)",
        }} />

        {loading && (
          <div style={{ padding: "64px 24px", textAlign: "center" }}>
            <div style={{
              width: "32px", height: "32px", margin: "0 auto 14px",
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.06)",
              borderTop: "2px solid #00dfb2",
              animation: "spin 0.8s linear infinite",
            }} />
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>
              Scanning blockchain…
            </p>
          </div>
        )}

        {!loading && events.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            style={{
              padding: "80px 40px", textAlign: "center",
              background: "linear-gradient(135deg, rgba(255,255,255,0.01), transparent)",
              position: "relative", overflow: "hidden"
            }}
          >
            <div style={{ position: "absolute", inset: "-50%", background: "radial-gradient(circle, rgba(0,223,178,0.03) 0%, transparent 60%)", pointerEvents: "none" }} />
            <div style={{
              width: "80px", height: "80px", margin: "0 auto 20px", borderRadius: "50%",
              background: "rgba(0,223,178,0.05)", display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid rgba(0,223,178,0.15)", boxShadow: "0 0 40px rgba(0,223,178,0.1) inset"
            }}>
              <span style={{ fontSize: "32px", filter: "drop-shadow(0 0 10px rgba(0,223,178,0.5))" }}>⛓️</span>
            </div>
            <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: "18px", color: "rgba(255,255,255,0.8)", marginBottom: "8px", position: "relative" }}>
              The Ledger is Waiting
            </p>
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", lineHeight: 1.6, maxWidth: "300px", margin: "0 auto", position: "relative" }}>
              Submit your first verified impact proof to kickstart the on-chain feed.
            </p>
          </motion.div>
        )}

        <AnimatePresence mode="popLayout">
          {!loading && events.map((ev, i) => (
            <motion.div key={ev.txHash + i}
              layout
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              style={{
                display: "grid",
                gridTemplateColumns: "46px 1fr auto",
                alignItems: "center",
                gap: "14px",
                padding: "14px 18px",
                borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                transition: "background 0.15s",
                position: "relative",
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
            >
              {/* Latest indicator */}
              {i === 0 && (
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: "2px",
                  background: "linear-gradient(180deg,#00dfb2,transparent)",
                }} />
              )}

              <ScoreBadge score={ev.impactScore} />

              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", flexWrap: "wrap" }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: "12px", color: "rgba(255,255,255,0.65)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {ev.volunteer.slice(0, 8)}…{ev.volunteer.slice(-6)}
                  </span>
                  {i === 0 && (
                    <span style={{
                      fontSize: "8px", padding: "2px 7px", borderRadius: "4px",
                      background: "rgba(0,223,178,0.1)", border: "1px solid rgba(0,223,178,0.2)",
                      color: "#00dfb2", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
                      letterSpacing: "0.08em",
                    }}>LATEST</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: "12px", fontWeight: 700,
                    background: "linear-gradient(90deg,#ffbd59,#ff6eb4)",
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                  }}>+{ev.tokenReward.toFixed(2)} APEX</span>
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono',monospace" }}>
                    #{ev.blockNumber.toString()}
                  </span>
                </div>
              </div>

              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <p style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "10px", color: "rgba(255,255,255,0.25)", marginBottom: "5px",
                }}>{ago(ev.timestamp)}</p>
                <a
                  href="#"
                  onClick={e => { e.preventDefault(); navigator.clipboard.writeText(ev.txHash); }}
                  title="Copy TX hash"
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: "10px", color: "#7c6aff",
                    opacity: 0.5, textDecoration: "none",
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.opacity = "1"}
                  onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.opacity = "0.5"}
                >
                  {ev.txHash.slice(0, 10)}…
                </a>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }
        @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeIn{ from{opacity:0;transform:scale(0.9)} to{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}