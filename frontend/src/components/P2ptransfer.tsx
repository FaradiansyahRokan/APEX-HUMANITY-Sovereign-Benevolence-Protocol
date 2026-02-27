"use client";

import { useState } from "react";
import { useBalance, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, isAddress } from "viem";

interface TxRecord {
  to: string; amount: string; time: number; status: "ok" | "err";
}

const glassCard: React.CSSProperties = {
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(255,255,255,0.03)",
  overflow: "hidden",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: "12px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "13px",
  color: "#fff",
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
  boxSizing: "border-box" as const,
};

export default function P2PTransfer({ address }: { address: string }) {
  const [to, setTo]         = useState("");
  const [amount, setAmount] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [history, setHistory] = useState<TxRecord[]>([]);

  const { data: nativeBal, refetch } = useBalance({
    address: address as `0x${string}`,
    query: { refetchInterval: 6_000 },
  });

  const { data: hash, sendTransaction, isPending, error: sendError } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const balNum = nativeBal ? Number(nativeBal.formatted) : 0;
  const balFmt = balNum.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const amtNum = Number(amount) || 0;
  const validTo  = to.length > 0 && isAddress(to);
  const validAmt = amtNum > 0 && amtNum < balNum;
  const canSend  = validTo && validAmt && !isPending && !isConfirming;
  const pct      = balNum > 0 ? Math.min((amtNum / balNum) * 100, 100) : 0;
  const statusErr = errMsg || sendError?.message;

  const handleSend = async () => {
    if (!canSend) return;
    setErrMsg("");
    try {
      sendTransaction({ to: to as `0x${string}`, value: parseEther(amount) });
    } catch (e: any) {
      setErrMsg(e.message?.slice(0, 120) || "Transfer failed");
      setHistory(h => [{ to, amount, time: Date.now(), status: "err" }, ...h.slice(0, 9)]);
    }
  };

  if (isSuccess && !history.find(h => h.status === "ok" && h.time > Date.now() - 5000)) {
    setHistory(h => [{ to, amount, time: Date.now(), status: "ok" }, ...h.slice(0, 9)]);
    setTo(""); setAmount(""); refetch();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 24, alignItems: "start" }}>

      {/* ── Left: Send form ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Header */}
        <div style={{ marginBottom: 4 }}>
          <p style={{
            fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em",
            fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
            background: "linear-gradient(90deg,#ffbd59,#ff6eb4)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            marginBottom: "6px",
          }}>P2P Native Transfer</p>
          <p style={{
            fontFamily: "'Plus Jakarta Sans',sans-serif",
            fontWeight: 800, fontSize: "22px", color: "#fff",
          }}>Send APEX</p>
        </div>

        {/* Balance card */}
        <div style={{ ...glassCard, position: "relative", overflow: "hidden" }}>
          <div style={{ height: "2px", background: "linear-gradient(90deg,#ffbd59,#ff6eb4,#7c6aff)" }} />
          {/* Ambient glow */}
          <div style={{
            position: "absolute", bottom: "-20px", right: "-20px",
            width: "120px", height: "120px", borderRadius: "50%",
            background: "radial-gradient(circle,rgba(255,189,89,0.12) 0%,transparent 70%)",
            pointerEvents: "none",
          }} />
          <div style={{ padding: "22px 24px", position: "relative" }}>
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>
              Your Native Balance
            </p>
            <p style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: "36px", fontWeight: 800,
              background: "linear-gradient(135deg,#ffbd59,#ff6eb4)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              letterSpacing: "-0.03em", lineHeight: 1, marginBottom: "18px",
            }}>
              {balFmt}
              <span style={{
                fontFamily: "'Plus Jakarta Sans',sans-serif",
                fontSize: "16px", fontWeight: 500,
                color: "rgba(255,255,255,0.3)", marginLeft: "10px",
                WebkitTextFillColor: "rgba(255,255,255,0.3)",
                background: "none",
              }}>APEX</span>
            </p>
            {/* Progress bar */}
            <div style={{ height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${pct}%`,
                background: "linear-gradient(90deg,#ffbd59,#ff6eb4)",
                borderRadius: "2px",
                transition: "width 0.4s ease",
                boxShadow: "0 0 8px rgba(255,189,89,0.4)",
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "7px" }}>
              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono',monospace" }}>
                Sending {pct.toFixed(1)}% of balance
              </span>
              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono',monospace" }}>
                {amtNum > 0 ? amtNum.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0"}
              </span>
            </div>
          </div>
        </div>

        {/* Form card */}
        <div style={{ ...glassCard }}>
          <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Recipient */}
            <div>
              <label style={{ display: "block", fontSize: "10px", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "9px", fontFamily: "'JetBrains Mono',monospace" }}>
                Recipient Address
              </label>
              <input
                style={{
                  ...inputStyle,
                  borderColor: to && !validTo ? "rgba(255,80,80,0.4)" : undefined,
                  boxShadow: to && validTo ? "0 0 0 1px rgba(0,223,178,0.2)" : undefined,
                }}
                placeholder="0x…"
                value={to}
                onChange={e => setTo(e.target.value)}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.2)"}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = to && !validTo ? "rgba(255,80,80,0.4)" : "rgba(255,255,255,0.08)"}
              />
              {to && !validTo && (
                <p style={{ fontSize: "10px", color: "rgba(255,100,100,0.8)", marginTop: "6px", fontFamily: "'JetBrains Mono',monospace" }}>
                  ✕ Invalid Ethereum address format
                </p>
              )}
              {to && validTo && (
                <p style={{ fontSize: "10px", color: "#00dfb2", marginTop: "6px", fontFamily: "'JetBrains Mono',monospace" }}>
                  ✓ Valid address
                </p>
              )}
            </div>

            {/* Amount */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "9px" }}>
                <label style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.09em", fontFamily: "'JetBrains Mono',monospace" }}>
                  Amount (APEX)
                </label>
                <div style={{ display: "flex", gap: "6px" }}>
                  {[25, 50, 100].map(p => (
                    <button key={p}
                      onClick={() => setAmount(((balNum * p) / 100).toFixed(4))}
                      style={{
                        fontFamily: "'JetBrains Mono',monospace", fontSize: "10px",
                        color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "6px", padding: "3px 9px",
                        background: "rgba(255,255,255,0.03)", cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLButtonElement;
                        el.style.color = "#fff";
                        el.style.background = "rgba(255,189,89,0.1)";
                        el.style.borderColor = "rgba(255,189,89,0.3)";
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLButtonElement;
                        el.style.color = "rgba(255,255,255,0.4)";
                        el.style.background = "rgba(255,255,255,0.03)";
                        el.style.borderColor = "rgba(255,255,255,0.1)";
                      }}>
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  style={{
                    ...inputStyle,
                    paddingRight: "72px",
                    fontSize: "20px", fontWeight: 700,
                    borderColor: amount && !validAmt ? "rgba(255,80,80,0.4)" : undefined,
                  }}
                  type="number" min="0" step="any" placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.2)"}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = amount && !validAmt ? "rgba(255,80,80,0.4)" : "rgba(255,255,255,0.08)"}
                />
                <span style={{
                  position: "absolute", right: "16px", top: "50%", transform: "translateY(-50%)",
                  fontFamily: "'JetBrains Mono',monospace", fontSize: "11px",
                  color: "rgba(255,189,89,0.6)", fontWeight: 700,
                }}>APEX</span>
              </div>
              {amount && amtNum >= balNum && (
                <p style={{ fontSize: "10px", color: "rgba(255,100,100,0.8)", marginTop: "6px", fontFamily: "'JetBrains Mono',monospace" }}>
                  ✕ Insufficient balance (reserve gas fee)
                </p>
              )}
            </div>

            {/* Status alerts */}
            {isSuccess && (
              <div style={{
                padding: "12px 16px", borderRadius: "10px",
                background: "rgba(0,223,178,0.06)", border: "1px solid rgba(0,223,178,0.18)",
                fontSize: "12px", color: "#00dfb2", fontFamily: "'JetBrains Mono',monospace",
              }}>✓ Transfer broadcasted to L1 successfully</div>
            )}
            {statusErr && (
              <div style={{
                padding: "12px 16px", borderRadius: "10px",
                background: "rgba(255,80,80,0.05)", border: "1px solid rgba(255,80,80,0.15)",
                fontSize: "11px", color: "rgba(255,120,120,0.9)", fontFamily: "'JetBrains Mono',monospace",
                lineHeight: 1.5,
              }}>✕ {statusErr.toString().slice(0, 100)}…</div>
            )}

            {/* Submit button */}
            <button
              disabled={!canSend}
              onClick={handleSend}
              style={{
                width: "100%", padding: "15px",
                borderRadius: "12px", border: "none",
                background: canSend
                  ? "linear-gradient(135deg,#ffbd59,#ff6eb4)"
                  : "rgba(255,255,255,0.05)",
                fontFamily: "'Plus Jakarta Sans',sans-serif",
                fontSize: "14px", fontWeight: 800,
                color: canSend ? "#0a0510" : "rgba(255,255,255,0.2)",
                cursor: canSend ? "pointer" : "not-allowed",
                transition: "all 0.2s",
                letterSpacing: "0.02em",
                boxShadow: canSend ? "0 4px 20px rgba(255,189,89,0.3)" : "none",
              }}
              onMouseEnter={e => { if (canSend) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
            >
              {isPending || isConfirming
                ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", border: "2px solid rgba(0,0,0,0.3)", borderTop: "2px solid #000", animation: "spin 0.8s linear infinite" }} />
                    Broadcasting to L1…
                  </span>
                : "Send APEX Native →"
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: TX history & info ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Transfer Ledger */}
        <div>
          <p style={{
            fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em",
            fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
            color: "rgba(255,255,255,0.3)", marginBottom: "12px",
          }}>Transfer Ledger</p>

          {history.length === 0 ? (
            <div style={{
              ...glassCard,
              padding: "52px 24px", textAlign: "center",
            }}>
              <p style={{ fontSize: "30px", opacity: 0.06, marginBottom: "12px" }}>⟳</p>
              <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", marginBottom: "4px" }}>No transfers yet</p>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>Initiated transactions will appear here</p>
            </div>
          ) : (
            <div style={{ ...glassCard }}>
              <div style={{ height: "1px", background: "linear-gradient(90deg,#ffbd59,#ff6eb4,transparent)" }} />
              {history.map((tx, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 18px",
                  borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                  gap: 12,
                  transition: "background 0.12s",
                }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)"}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                    <div style={{
                      width: "32px", height: "32px", borderRadius: "9px", flexShrink: 0,
                      background: tx.status === "ok" ? "rgba(0,223,178,0.1)" : "rgba(255,80,80,0.1)",
                      border: `1px solid ${tx.status === "ok" ? "rgba(0,223,178,0.2)" : "rgba(255,80,80,0.2)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "14px",
                    }}>{tx.status === "ok" ? "✓" : "✕"}</div>
                    <code style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: "11px", color: "rgba(255,255,255,0.5)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      → {tx.to.slice(0, 8)}…{tx.to.slice(-6)}
                    </code>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: "13px", fontWeight: 700,
                      background: tx.status === "ok" ? "linear-gradient(135deg,#ffbd59,#ff6eb4)" : "none",
                      WebkitBackgroundClip: tx.status === "ok" ? "text" : undefined,
                      WebkitTextFillColor: tx.status === "ok" ? "transparent" : undefined,
                      color: tx.status === "ok" ? "transparent" : "rgba(255,100,100,0.7)",
                    }}>
                      {tx.status === "ok" ? "-" : ""}{tx.amount} APEX
                    </p>
                    <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "rgba(255,255,255,0.2)", marginTop: "3px" }}>
                      {new Date(tx.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Network Parameters */}
        <div style={{ ...glassCard }}>
          <div style={{ height: "2px", background: "linear-gradient(90deg,#7c6aff,#00dfb2,transparent)" }} />
          <div style={{ padding: "20px 22px" }}>
            <p style={{
              fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.09em",
              fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
              color: "rgba(255,255,255,0.3)", marginBottom: "16px",
            }}>Network Parameters</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
              {[
                { k: "Network",    v: "APEX Local L1",      gradient: "linear-gradient(90deg,#00dfb2,#7c6aff)" },
                { k: "Asset Type", v: "Native Gas Coin",    gradient: "linear-gradient(90deg,#7c6aff,#ff6eb4)" },
                { k: "Consensus",  v: "Proof of Authority", gradient: "linear-gradient(90deg,#ff6eb4,#ffbd59)" },
                { k: "Chain ID",   v: "6969",               gradient: "linear-gradient(90deg,#ffbd59,#00dfb2)" },
              ].map((r, i, arr) => (
                <div key={r.k} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "11px 0",
                  borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                }}>
                  <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{r.k}</span>
                  <span style={{
                    fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", fontWeight: 600,
                    background: r.gradient,
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                  }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}