"use client";

import { useReadContract, useBalance } from "wagmi";
import { REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS, getRank, REPUTATION_RANKS } from "../utils/constants";

interface Props { address:string; reputationScore:number; }

export default function ReputationCard({ address, reputationScore }: Props) {
  const rank  = getRank(reputationScore);
  const rIdx  = REPUTATION_RANKS.findIndex(r=>r.rank===rank.rank);
  const next  = REPUTATION_RANKS[rIdx+1];
  const pct   = next
    ? Math.min(((reputationScore-rank.threshold)/(next.threshold-rank.threshold))*100,100)
    : 100;

  const { data:rep  } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getReputation",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  // ── v2.0: GOOD adalah native coin — pakai useBalance, bukan readContract ──
  const { data:goodBalance } = useBalance({
    address: address as `0x${string}`,
    query:   { refetchInterval: 8_000 },
  });

  const { data:hist } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getScoreHistory",
    args: [address as `0x${string}`],
    query: { refetchInterval: 8_000 },
  });

  const score   = rep ? Number((rep as any)[0])/100 : reputationScore;
  const events  = rep ? Number((rep as any)[1]) : 0;
  const lastUpd = rep ? Number((rep as any)[2]) : 0;

  // Native balance dari useBalance
  const goodFmt = goodBalance
    ? Number(goodBalance.formatted).toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";

  const history = (hist as any[]) ?? [];
  const recent  = [...history].reverse().slice(0, 5);
  const lastDate = lastUpd > 0
    ? new Date(lastUpd*1000).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })
    : "Never";

  return (
    <div style={{display:"flex", flexDirection:"column", gap:"10px"}}>

      {/* ═══ Identity ═══ */}
      <div style={{
        borderRadius:"var(--r3)", overflow:"hidden",
        border:"1px solid var(--b0)",
        background:"linear-gradient(160deg, rgba(0,223,162,0.06) 0%, var(--g1) 50%)",
        boxShadow:"0 0 40px rgba(0,223,162,0.05)",
      }}>
        <div style={{height:"2px", background:"linear-gradient(90deg,var(--mi),var(--vi))"}}/>
        <div style={{padding:"24px"}}>

          {/* Avatar + rank + score */}
          <div style={{display:"grid", gridTemplateColumns:"auto 1fr auto", gap:"16px", alignItems:"flex-start", marginBottom:"26px"}}>
            <div style={{
              width:"52px", height:"52px", borderRadius:"14px",
              background:"linear-gradient(135deg,var(--mi-dim),rgba(0,223,162,0.18))",
              border:"1px solid var(--mi-edge)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:"26px", flexShrink:0,
              boxShadow:"0 0 20px var(--mi-glow)",
            }}>{rank.icon}</div>

            <div>
              <p style={{fontFamily:"'Plus Jakarta Sans',sans-serif", fontWeight:800, fontSize:"17px", color:"var(--t0)", marginBottom:"5px"}}>
                {rank.rank}
              </p>
              <p className="label">{address.slice(0,10)}…{address.slice(-8)}</p>
            </div>

            <div style={{textAlign:"right"}}>
              <p style={{
                fontFamily:"'JetBrains Mono',monospace",
                fontSize:"34px", fontWeight:600,
                color:"var(--mi)", letterSpacing:"-0.025em", lineHeight:1,
                textShadow:"0 0 28px var(--mi-glow)",
              }}>
                {score.toLocaleString("en-US")}
              </p>
              <p className="label" style={{marginTop:"4px"}}>impact pts</p>
            </div>
          </div>

          {/* 3-stat row */}
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", marginBottom:"22px"}}>
            {[
              { label:"Events", value:events.toString(), color:"var(--mi)" },
              { label:"GOOD",   value:goodFmt,           color:"var(--go)" },
            ].map(s=>(
              <div key={s.label} style={{
                padding:"14px 12px", borderRadius:"var(--r2)", textAlign:"center",
                background:"var(--g1)", border:"1px solid var(--b0)",
              }}>
                <p style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:"18px", fontWeight:600, color:s.color,
                  letterSpacing:"-0.01em", lineHeight:1, marginBottom:"6px",
                  textShadow:`0 0 16px ${s.color}50`,
                }}>{s.value}</p>
                <p className="label">{s.label}</p>
              </div>
            ))}
          </div>

          <p className="label" style={{marginBottom:"18px"}}>
            Last active:&nbsp;
            <span style={{fontFamily:"'JetBrains Mono',monospace", color:"var(--t1)", fontWeight:500}}>
              {lastDate}
            </span>
          </p>

          {/* Rank progress */}
          {next ? (
            <div>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px"}}>
                <p className="label">Next rank: {next.icon} {next.rank}</p>
                <p style={{fontFamily:"'JetBrains Mono',monospace", fontSize:"11px", fontWeight:500, color:"var(--mi)"}}>
                  {(next.threshold-score).toLocaleString()} pts
                </p>
              </div>
              <div className="track" style={{height:"5px"}}>
                <div className="fill-mi" style={{width:`${pct}%`}}/>
              </div>
            </div>
          ) : (
            <div style={{
              textAlign:"center", padding:"12px", borderRadius:"var(--r2)",
              background:"var(--go-dim)", border:"1px solid var(--go-edge)",
            }}>
              <p style={{fontFamily:"'JetBrains Mono',monospace", fontSize:"10px", fontWeight:600, color:"var(--go)", letterSpacing:"0.1em"}}>
                ⚡ MAXIMUM RANK — APEX OF HUMANITY
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ═══ GOOD Balance (native coin) ═══ */}
      <div style={{
        borderRadius:"var(--r3)",
        border:"1px solid var(--b0)",
        background:"linear-gradient(160deg,var(--go-deep) 0%,var(--g1) 50%)",
        overflow:"hidden",
      }}>
        <div style={{height:"2px", background:"linear-gradient(90deg,var(--go),var(--go-soft))"}}/>
        <div style={{padding:"22px 24px"}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"18px"}}>
            <p className="label" style={{color:"var(--go)", opacity:0.8}}>GOOD Balance</p>
            <div style={{
              display:"flex", alignItems:"center", gap:"6px",
              padding:"4px 11px", borderRadius:"99px",
              background:"var(--mi-dim)", border:"1px solid var(--mi-edge)",
            }}>
              <span className="dot dot-mi" style={{width:"4px", height:"4px"}}/>
              <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:"8px", fontWeight:600, color:"var(--mi)", letterSpacing:"0.12em"}}>LIVE</span>
            </div>
          </div>

          <div style={{display:"flex", alignItems:"flex-end", gap:"9px", marginBottom:"12px"}}>
            <span style={{
              fontFamily:"'JetBrains Mono',monospace",
              fontSize:"44px", fontWeight:600,
              color:"var(--go)", letterSpacing:"-0.025em", lineHeight:1,
              textShadow:"0 0 32px var(--go-glow)",
            }}>{goodFmt}</span>
            <span style={{
              fontFamily:"'JetBrains Mono',monospace",
              fontSize:"14px", color:"rgba(255,189,89,0.45)", paddingBottom:"6px",
            }}>GOOD</span>
          </div>

          <p className="label" style={{opacity:0.5}}>
            Native L1 coin · digunakan untuk gas &amp; transaksi
          </p>
        </div>
      </div>

      {/* ═══ Activity ═══ */}
      {recent.length > 0 ? (
        <div style={{
          borderRadius:"var(--r3)",
          border:"1px solid var(--b0)",
          background:"linear-gradient(160deg,var(--vi-deep) 0%,var(--g1) 50%)",
          overflow:"hidden",
        }}>
          <div style={{height:"2px", background:"linear-gradient(90deg,var(--vi),var(--vi-soft))"}}/>
          <div style={{padding:"22px 24px"}}>
            <p className="label" style={{marginBottom:"16px", color:"var(--vi)", opacity:0.8}}>On-chain Activity</p>
            <div style={{display:"flex", flexDirection:"column", gap:"7px"}}>
              {recent.map((e:any, i:number) => {
                const s = Number(e.score ?? 0), ts = Number(e.timestamp ?? 0);
                const d = ts > 0
                  ? new Date(ts*1000).toLocaleDateString("en-US", { month:"short", day:"numeric" })
                  : "—";
                return (
                  <div key={i} style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"11px 14px", borderRadius:"var(--r2)",
                    background:"var(--g1)", border:"1px solid var(--b0)",
                    transition:"border-color 0.15s",
                  }}
                  onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.borderColor="var(--b1)"}
                  onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.borderColor="var(--b0)"}
                  >
                    <div style={{display:"flex", alignItems:"center", gap:"10px"}}>
                      <div style={{
                        width:"6px", height:"6px", borderRadius:"50%",
                        background:"var(--vi)", flexShrink:0,
                        boxShadow:"0 0 8px var(--vi-glow)",
                      }}/>
                      <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:"11px", color:"var(--t1)"}}>{d}</span>
                    </div>
                    <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:"12px", fontWeight:600, color:"var(--mi)"}}>
                      +{(s/100).toLocaleString("en-US", { maximumFractionDigits:2 })} pts
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="label" style={{textAlign:"center", marginTop:"12px"}}>{history.length} events on-chain</p>
          </div>
        </div>
      ) : events === 0 ? (
        <div style={{borderRadius:"var(--r3)", border:"1px solid var(--b0)", background:"var(--g0)"}}>
          <div style={{padding:"48px 24px", textAlign:"center"}}>
            <p style={{fontSize:"32px", opacity:0.08, marginBottom:"12px"}}>⛓️</p>
            <p style={{fontSize:"14px", color:"var(--t1)", marginBottom:"5px"}}>No events yet</p>
            <p className="label">Submit your first impact proof</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}