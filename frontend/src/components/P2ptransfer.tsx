"use client";

import { useState } from "react";
import { useBalance, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, isAddress } from "viem";

interface TxRecord {
  to: string;
  amount: string;
  time: number;
  status: "ok" | "err";
}

export default function P2PTransfer({ address }: { address: string }) {
  const [to, setTo]         = useState("");
  const [amount, setAmount] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [history, setHistory] = useState<TxRecord[]>([]);

  // Mengambil saldo Native APEX L1
  const { data: nativeBal, refetch } = useBalance({ 
    address: address as `0x${string}`,
    query: { refetchInterval: 6_000 }
  });

  // Fungsi Native Transfer L1 (Bukan ERC-20)
  const { data: hash, sendTransaction, isPending, error: sendError } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const balNum = nativeBal ? Number(nativeBal.formatted) : 0;
  const balFmt = balNum.toLocaleString("en-US", { maximumFractionDigits: 4 });

  const amtNum   = Number(amount) || 0;
  const validTo  = to.length > 0 && isAddress(to);
  const validAmt = amtNum > 0 && amtNum < balNum; // Sisakan sedikit untuk gas fee
  const canSend  = validTo && validAmt && !isPending && !isConfirming;

  const handleSend = async () => {
    if (!canSend) return;
    setErrMsg("");
    try {
      sendTransaction({
        to: to as `0x${string}`,
        value: parseEther(amount),
      });
      // Suksesnya ditangani oleh isSuccess efek bawah
    } catch (e: any) {
      setErrMsg(e.message?.slice(0, 120) || "Transfer failed");
      setHistory(h => [{ to, amount, time: Date.now(), status: "err" }, ...h.slice(0, 9)]);
    }
  };

  // Pantau kalau transaksi sukses mendarat
  if (isSuccess && !history.find(h => h.status === "ok" && h.time > Date.now() - 5000)) {
      setHistory(h => [{ to, amount, time: Date.now(), status: "ok" }, ...h.slice(0, 9)]);
      setTo(""); setAmount("");
      refetch();
  }

  const pct = balNum > 0 ? Math.min((amtNum / balNum) * 100, 100) : 0;
  const statusErr = errMsg || sendError?.message;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 24, alignItems: "start" }}>

      {/* Left: Send form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <p className="label" style={{ marginBottom: 8, color: "var(--gr)" }}>P2P Native Transfer</p>
          <p className="num" style={{ fontSize: 32, color: "var(--t0)", letterSpacing: "-0.02em" }}>Send APEX</p>
        </div>

        {/* Balance card */}
        <div className="card up">
          <div style={{ padding: "24px" }}>
            <p className="label" style={{ marginBottom: 12 }}>Your Native Balance</p>
            <p className="num" style={{ fontSize: 36, color: "var(--t0)", marginBottom: 8 }}>
              {balFmt}
              <span style={{ fontFamily: "var(--font)", fontSize: 16, fontWeight: 400, color: "var(--t2)", marginLeft: 12 }}>APEX</span>
            </p>
            <div style={{ marginTop: 16 }}>
              <div className="track"><div className="tfill gr" style={{ width: `${pct}%` }} /></div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <p className="label" style={{ textTransform: "none" }}>Sending {pct.toFixed(1)}% of balance</p>
                <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--t1)" }}>
                  {amtNum > 0 ? amtNum.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="card up d1">
          <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Recipient */}
            <div>
              <p className="label" style={{ marginBottom: 8 }}>Recipient Address</p>
              <input
                className="field"
                placeholder="0x…"
                value={to}
                onChange={e => setTo(e.target.value)}
                style={{ borderColor: to && !validTo ? "var(--rd-b)" : undefined }}
              />
              {to && !validTo && (
                <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--rd)", marginTop: 6 }}>Invalid Ethereum Address format</p>
              )}
            </div>

            {/* Amount */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <p className="label">Amount (APEX)</p>
                <div style={{ display: "flex", gap: 8 }}>
                  {[25, 50, 100].map(pct => (
                    <button key={pct} onClick={() => setAmount(((balNum * pct) / 100).toFixed(4))}
                      style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--t2)", border: "1px solid var(--b1)", borderRadius: 4, padding: "2px 8px", background: "rgba(255,255,255,0.03)", cursor: "pointer", transition: "all 0.2s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t0)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t2)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t2)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--b1)"; }}>
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  className="field"
                  type="number" min="0" step="any" placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{ paddingRight: 70, borderColor: amount && !validAmt ? "var(--rd-b)" : undefined, fontSize: 18 }}
                />
                <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontFamily: "var(--mono)", fontSize: 12, color: "var(--t2)", fontWeight: 600 }}>APEX</span>
              </div>
              {amount && amtNum >= balNum && (
                <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--rd)", marginTop: 6 }}>Insufficient balance for amount + gas</p>
              )}
            </div>

            {/* Alerts */}
            {isSuccess && <div className="alert-ok">✓ Transfer broadcasted successfully</div>}
            {statusErr && <div className="alert-err">❌ {statusErr.toString().slice(0, 100)}...</div>}

            {/* Submit */}
            <button className="btn btn-w" style={{ width: "100%", padding: 16, fontSize: 15 }} disabled={!canSend} onClick={handleSend}>
              {isPending || isConfirming ? "Broadcasting to L1..." : "Send APEX Native →"}
            </button>
          </div>
        </div>
      </div>

      {/* Right: TX history & Info */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <p className="label" style={{ marginBottom: 12 }}>Transfer Ledger</p>
          {history.length === 0 ? (
            <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "var(--t2)", marginBottom: 4 }}>No native transfers yet</p>
              <p className="label" style={{ textTransform: "none" }}>Initiated transactions will appear here</p>
            </div>
          ) : (
            <div className="card">
              {history.map((tx, i) => (
                <div key={i} className="row" style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "16px 20px",
                  borderTop: i > 0 ? "1px solid var(--b0)" : undefined,
                  gap: 12,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{tx.status === "ok" ? "✓" : "❌"}</span>
                    <code style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      → {tx.to.slice(0, 8)}…{tx.to.slice(-6)}
                    </code>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p className="num" style={{ fontSize: 15, color: tx.status === "ok" ? "var(--t0)" : "var(--rd)", fontWeight: 500 }}>
                      {tx.status === "ok" ? "-" : ""}{tx.amount} APEX
                    </p>
                    <p style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--t2)", marginTop: 4 }}>
                      {new Date(tx.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info box */}
        <div className="card up d3">
          <div style={{ padding: "24px" }}>
            <p className="label" style={{ marginBottom: 16 }}>Network Parameters</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { k: "Network",   v: "APEX Local L1" },
                { k: "Asset Type", v: "Native Gas Coin" },
                { k: "Consensus",  v: "Proof of Authority" },
                { k: "Chain ID",  v: "6969" },
              ].map(r => (
                <div key={r.k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--b0)" }}>
                  <span className="label" style={{ textTransform: "none" }}>{r.k}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--t1)", fontWeight: 500 }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}