"use client";

import { useEffect, useState } from "react";
import { usePublicClient, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";
import { CONTRACTS, ACTION_TYPES } from "../utils/constants";

interface FeedEvent {
  eventId:    string;
  volunteer:  string;
  impactScore: number;   // raw /100
  tokenReward: number;   // in GOOD
  txHash:     string;
  blockNumber: bigint;
  timestamp:  number;
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#10D988";
  if (score >= 60) return "#00D4FF";
  if (score >= 40) return "#C9A84C";
  return "#9A9490";
}

function ScorePill({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <span style={{
      fontFamily: "monospace",
      fontSize: "11px",
      fontWeight: 700,
      color,
      background: `${color}15`,
      border: `1px solid ${color}30`,
      padding: "2px 8px",
      borderRadius: "100px",
      letterSpacing: "0.04em",
    }}>
      {score.toFixed(1)}
    </span>
  );
}

export default function ImpactFeed() {
  const client = usePublicClient();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCount, setNewCount] = useState(0);

  // Fetch past events
  useEffect(() => {
    if (!client) return;

    const fetchLogs = async () => {
      try {
        const logs = await client.getLogs({
          address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
          event: {
            type: "event",
            name: "RewardReleased",
            inputs: [
              { type: "bytes32", name: "eventId",     indexed: true  },
              { type: "address", name: "volunteer",   indexed: true  },
              { type: "address", name: "beneficiary", indexed: true  },
              { type: "uint256", name: "impactScore", indexed: false },
              { type: "uint256", name: "tokenReward", indexed: false },
              { type: "bytes32", name: "zkProofHash", indexed: false },
              { type: "bytes32", name: "eventHash",   indexed: false },
              { type: "uint256", name: "timestamp",   indexed: false },
            ],
          },
          fromBlock: 0n,
          toBlock: "latest",
        });

        const parsed: FeedEvent[] = logs.map((log: any) => ({
          eventId:     log.args.eventId,
          volunteer:   log.args.volunteer,
          impactScore: Number(log.args.impactScore) / 100,
          tokenReward: Number(formatUnits(log.args.tokenReward, 18)),
          txHash:      log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp:   Number(log.args.timestamp),
        })).reverse(); // newest first

        setEvents(parsed);
      } catch (e) {
        console.error("Failed to fetch logs:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [client]);

  // Watch for new events in real-time
  useEffect(() => {
    if (!client) return;

    const unwatch = client.watchContractEvent({
      address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
      abi: BENEVOLENCE_VAULT_ABI,
      eventName: "RewardReleased",
      onLogs: (logs: any[]) => {
        const newEvents: FeedEvent[] = logs.map((log) => ({
          eventId:     log.args.eventId,
          volunteer:   log.args.volunteer,
          impactScore: Number(log.args.impactScore) / 100,
          tokenReward: Number(formatUnits(log.args.tokenReward, 18)),
          txHash:      log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp:   Number(log.args.timestamp),
        }));
        setEvents((prev) => [...newEvents, ...prev]);
        setNewCount((c) => c + newEvents.length);
        setTimeout(() => setNewCount(0), 3000);
      },
    });

    return () => unwatch();
  }, [client]);

  return (
    <div style={{ maxWidth: "720px" }}>

      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "20px",
        flexWrap: "wrap",
        gap: "12px",
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
            <span style={{ color: "var(--cyan)" }}>◎</span> Live Impact Feed
          </h2>
          <p style={{
            fontFamily: "monospace",
            fontSize: "11px",
            color: "var(--text-3)",
            marginTop: "4px",
            letterSpacing: "0.06em",
          }}>
            {events.length} verified event{events.length !== 1 ? "s" : ""} on-chain
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {newCount > 0 && (
            <span style={{
              fontFamily: "monospace",
              fontSize: "11px",
              color: "#10D988",
              background: "rgba(16,217,136,0.1)",
              border: "1px solid rgba(16,217,136,0.2)",
              padding: "3px 10px",
              borderRadius: "100px",
              animation: "fadeIn 0.3s ease",
            }}>
              +{newCount} new
            </span>
          )}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontFamily: "monospace",
            fontSize: "10px",
            color: "#10D988",
            background: "rgba(16,217,136,0.05)",
            border: "1px solid rgba(16,217,136,0.15)",
            padding: "4px 10px",
            borderRadius: "100px",
            letterSpacing: "0.1em",
          }}>
            <span style={{
              width: "5px", height: "5px",
              borderRadius: "50%",
              background: "#10D988",
              boxShadow: "0 0 6px #10D988",
              display: "inline-block",
              animation: "pulse 2s infinite",
            }} />
            LIVE
          </div>
        </div>
      </div>

      {/* Feed */}
      <div style={{
        borderRadius: "16px",
        overflow: "hidden",
        border: "1px solid var(--border)",
        background: "var(--surface)",
      }}>

        {loading && (
          <div style={{ padding: "40px", textAlign: "center" }}>
            <div style={{
              fontFamily: "monospace",
              fontSize: "12px",
              color: "var(--text-3)",
              letterSpacing: "0.08em",
              animation: "pulse 1.5s infinite",
            }}>
              Scanning blockchain...
            </div>
          </div>
        )}

        {!loading && events.length === 0 && (
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>◎</div>
            <p style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--text-2)" }}>
              No events yet
            </p>
            <p style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--text-3)", marginTop: "6px" }}>
              Submit your first impact proof to start the feed
            </p>
          </div>
        )}

        {!loading && events.map((ev, i) => {
          const color = scoreColor(ev.impactScore);
          const isFirst = i === 0;
          return (
            <div key={ev.txHash + i} style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              alignItems: "center",
              gap: "16px",
              padding: "14px 20px",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              transition: "background 0.15s",
              cursor: "default",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)"}
            onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
            >
              {/* Left: pulse dot */}
              <div style={{
                width: "7px", height: "7px",
                borderRadius: "50%",
                background: color,
                boxShadow: isFirst ? `0 0 8px ${color}` : "none",
                flexShrink: 0,
                animation: isFirst ? "pulse 2s infinite" : "none",
              }} />

              {/* Center: info */}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "4px",
                  flexWrap: "wrap",
                }}>
                  <span style={{
                    fontFamily: "monospace",
                    fontSize: "12px",
                    color: "var(--text-2)",
                    fontWeight: 600,
                  }}>
                    {ev.volunteer.slice(0, 8)}...{ev.volunteer.slice(-6)}
                  </span>
                  <ScorePill score={ev.impactScore} />
                </div>

                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                }}>
                  <span style={{
                    fontFamily: "monospace",
                    fontSize: "11px",
                    color: "#C9A84C",
                  }}>
                    +{ev.tokenReward.toFixed(2)} GOOD
                  </span>
                  <span style={{
                    fontFamily: "monospace",
                    fontSize: "10px",
                    color: "var(--text-3)",
                  }}>
                    Block #{ev.blockNumber.toString()}
                  </span>
                </div>
              </div>

              {/* Right: time + tx link */}
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{
                  fontFamily: "monospace",
                  fontSize: "10px",
                  color: "var(--text-3)",
                  marginBottom: "4px",
                }}>
                  {timeAgo(ev.timestamp)}
                </div>
                <a
                  href={`#tx-${ev.txHash}`}
                  onClick={e => { e.preventDefault(); navigator.clipboard.writeText(ev.txHash); }}
                  title="Copy TX hash"
                  style={{
                    fontFamily: "monospace",
                    fontSize: "10px",
                    color: "var(--cyan)",
                    opacity: 0.6,
                    textDecoration: "none",
                    letterSpacing: "0.04em",
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.opacity = "1"}
                  onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.opacity = "0.6"}
                >
                  {ev.txHash.slice(0, 10)}...
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}