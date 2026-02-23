"use client";

import { useState } from "react";
import { useReadContract } from "wagmi";
import { REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS, getRank } from "../utils/constants";

interface Entry { address:string; score:number; rank:number; }

function SkeletonRow() {
  return (
    <div style={{
      height:"52px",borderRadius:"var(--r2)",marginBottom:"6px",
      background:"var(--g1)",border:"1px solid var(--b0)",
      animation:"lbPulse 1.8s ease-in-out infinite",
    }}/>
  );
}

function Empty() {
  return (
    <div style={{padding:"80px 24px",textAlign:"center"}}>
      <p style={{fontSize:"36px",opacity:0.08,marginBottom:"14px"}}>⛓️</p>
      <p style={{fontSize:"14px",color:"var(--t1)",marginBottom:"5px"}}>No volunteers yet</p>
      <p className="label">Submit your first impact proof</p>
    </div>
  );
}

export default function Leaderboard() {
  const [filter,setFilter] = useState<"all"|"weekly"|"monthly">("all");
  const [page,setPage]     = useState(0);
  const PAGE = 10;

  const { data:total } = useReadContract({
    address:CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi:REPUTATION_LEDGER_ABI, functionName:"getLeaderboardLength",
  });
  const { data:pageData,isLoading } = useReadContract({
    address:CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi:REPUTATION_LEDGER_ABI, functionName:"getLeaderboardPage",
    args:[BigInt(page*PAGE),BigInt(PAGE)],
    query:{refetchInterval:10_000},
  });
  const { data:globalStats } = useReadContract({
    address:CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi:REPUTATION_LEDGER_ABI, functionName:"getGlobalStats",
    query:{refetchInterval:10_000},
  });

  const addrs  = (pageData as any)?.[0] ?? [];
  const scores = (pageData as any)?.[1] ?? [];
  const totalN = Number(total??0);
  const pages  = Math.ceil(totalN/PAGE);

  const entries: Entry[] = addrs.map((a:string,i:number)=>({
    address:a, score:Number(scores[i]??0n), rank:page*PAGE+i+1,
  })).sort((a:Entry,b:Entry)=>b.score-a.score);

  const top3 = entries.slice(0,3);

  const podiumColors = [
    { badge:"🥇", border:"var(--go-edge)",  bg:"linear-gradient(160deg,var(--go-dim),var(--g1))",  color:"var(--go)" },
    { badge:"🥈", border:"var(--b1)",        bg:"var(--g1)",                                         color:"var(--t1)" },
    { badge:"🥉", border:"var(--vi-edge)",   bg:"linear-gradient(160deg,var(--vi-deep),var(--g1))", color:"var(--vi)" },
  ];

  return (
    <div style={{maxWidth:"780px"}}>

      {/* Header */}
      <div style={{
        display:"flex",alignItems:"flex-end",
        justifyContent:"space-between",
        marginBottom:"28px",gap:"16px",flexWrap:"wrap",
      }}>
        <div>
          <p className="label" style={{marginBottom:"8px",color:"var(--vi)"}}>Reputation Leaderboard</p>
          <h2 className="title">
            {totalN>0
              ? <>{totalN.toLocaleString()} <span style={{color:"var(--t2)",fontWeight:400,fontSize:"17px"}}>volunteers</span></>
              : "Global Rankings"
            }
          </h2>
        </div>

        {/* Filter pills */}
        <div style={{
          display:"flex",gap:"4px",
          padding:"4px",borderRadius:"var(--r2)",
          background:"var(--g1)",border:"1px solid var(--b0)",
        }}>
          {(["all","weekly","monthly"] as const).map(f=>(
            <button key={f} onClick={()=>setFilter(f)} style={{
              padding:"7px 16px",borderRadius:"var(--r1)",
              background: filter===f ? "var(--g2)" : "transparent",
              border: filter===f ? "1px solid var(--b1)" : "1px solid transparent",
              fontFamily:"'Plus Jakarta Sans',sans-serif",
              fontSize:"12px",fontWeight:filter===f?700:400,
              color:filter===f?"var(--t0)":"var(--t2)",
              cursor:"pointer",transition:"all 0.15s",
            }}>
              {f==="all"?"All Time":f==="weekly"?"7 Days":"30 Days"}
            </button>
          ))}
        </div>
      </div>

      {/* Global stats */}
      {globalStats && (
        <div style={{
          display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"24px",
        }}>
          {[
            {
              label:"Total Volunteers", icon:"🧑‍🤝‍🧑",
              value:Number((globalStats as any)[0]).toLocaleString(),
              color:"var(--vi)",dim:"var(--vi-dim)",edge:"var(--vi-edge)",
            },
            {
              label:"Total Impact Generated", icon:"💫",
              value:(Number((globalStats as any)[1])/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}),
              color:"var(--mi)",dim:"var(--mi-dim)",edge:"var(--mi-edge)",
            },
          ].map(s=>(
            <div key={s.label} style={{
              padding:"18px 20px",borderRadius:"var(--r3)",
              background:`linear-gradient(160deg,${s.dim} 0%,var(--g1) 60%)`,
              border:`1px solid ${s.edge}`,
            }}>
              <div style={{display:"flex",alignItems:"center",gap:"7px",marginBottom:"12px"}}>
                <span style={{fontSize:"14px"}}>{s.icon}</span>
                <p className="label" style={{color:s.color,opacity:0.75}}>{s.label}</p>
              </div>
              <p style={{
                fontFamily:"'JetBrains Mono',monospace",fontSize:"26px",fontWeight:600,
                color:s.color,letterSpacing:"-0.02em",lineHeight:1,
                textShadow:`0 0 20px ${s.color}40`,
              }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Skeleton */}
      {isLoading && [...Array(5)].map((_,i)=><SkeletonRow key={i}/>)}

      {/* Empty */}
      {!isLoading && entries.length===0 && <Empty/>}

      {/* Podium — page 0 with 3+ entries */}
      {!isLoading && top3.length>=3 && page===0 && (
        <div style={{
          display:"grid",gridTemplateColumns:"1fr 1.1fr 1fr",
          gap:"8px",marginBottom:"14px",
        }}>
          {[top3[1],top3[0],top3[2]].map((e,i)=>{
            // Render order: silver(2nd), gold(1st), bronze(3rd)
            const realRank = i===0?2:i===1?1:3;
            const pd = podiumColors[realRank-1];
            const rep = getRank(e.score/100);
            const isCenter = realRank===1;
            return (
              <div key={e.address} style={{
                padding: isCenter?"22px 16px":"18px 14px",
                borderRadius:"var(--r3)",
                background:pd.bg,
                border:`1px solid ${pd.border}`,
                display:"flex",flexDirection:"column",
                alignItems:"center",textAlign:"center",gap:"8px",
                boxShadow: isCenter ? `0 0 32px var(--go-glow)` : "none",
                transform: isCenter ? "translateY(-6px)" : "none",
                transition:"transform 0.2s",
              }}>
                <span style={{fontSize:isCenter?"26px":"22px",lineHeight:1}}>{pd.badge}</span>
                <div>
                  <p style={{
                    fontFamily:"'Plus Jakarta Sans',sans-serif",
                    fontSize:"11px",fontWeight:700,color:pd.color,marginBottom:"3px",
                  }}>{rep.icon} {rep.rank}</p>
                  <p className="label">{e.address.slice(0,6)}…{e.address.slice(-4)}</p>
                </div>
                <p style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:isCenter?"20px":"16px",fontWeight:600,
                  color:pd.color,letterSpacing:"-0.02em",
                  textShadow:`0 0 16px ${pd.color}50`,
                }}>
                  {(e.score/100).toLocaleString("en-US",{maximumFractionDigits:2})}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      {!isLoading && entries.length>0 && (
        <div style={{
          borderRadius:"var(--r3)",overflow:"hidden",
          border:"1px solid var(--b0)",background:"var(--g0)",
        }}>
          {/* Header */}
          <div style={{
            display:"grid",gridTemplateColumns:"52px 1fr 120px 110px",
            padding:"12px 20px",borderBottom:"1px solid var(--b0)",
            background:"var(--g1)",
          }}>
            {["#","VOLUNTEER","TIER","SCORE"].map((h,i)=>(
              <p key={h} className="label" style={{textAlign:i===3?"right":"left"}}>{h}</p>
            ))}
          </div>

          {/* Rows */}
          {entries.map((e,i)=>{
            const rep    = getRank(e.score/100);
            const medals = ["🥇","🥈","🥉"];
            const isTop  = e.rank<=3;
            const rowColor = e.rank===1?"var(--go)":e.rank===2?"var(--t1)":e.rank===3?"var(--vi)":"var(--t1)";
            return (
              <div key={e.address}
                style={{
                  display:"grid",gridTemplateColumns:"52px 1fr 120px 110px",
                  padding:"13px 20px",alignItems:"center",
                  borderBottom: i<entries.length-1?"1px solid var(--b0)":undefined,
                  transition:"background 0.12s",
                }}
                onMouseEnter={ev=>(ev.currentTarget as HTMLDivElement).style.background="var(--g1)"}
                onMouseLeave={ev=>(ev.currentTarget as HTMLDivElement).style.background="transparent"}
              >
                {/* Rank */}
                <p style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:"13px",fontWeight:700,
                  color:rowColor,
                }}>{isTop?medals[e.rank-1]:`#${e.rank}`}</p>

                {/* Address */}
                <p style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:"12px",color:"var(--t1)",letterSpacing:"0.02em",
                }}>
                  {e.address.slice(0,8)}…{e.address.slice(-6)}
                </p>

                {/* Tier */}
                <div>
                  <span style={{
                    fontFamily:"'JetBrains Mono',monospace",
                    fontSize:"10px",fontWeight:500,
                    padding:"3px 9px",borderRadius:"5px",
                    background:"var(--g1)",border:"1px solid var(--b0)",
                    color:"var(--t1)",
                  }}>
                    {rep.icon} {rep.rank}
                  </span>
                </div>

                {/* Score */}
                <p style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:"13px",fontWeight:700,textAlign:"right",
                  color: e.rank===1?"var(--go)":e.rank<=3?"var(--mi)":"var(--t0)",
                  textShadow: e.rank<=3?`0 0 12px ${e.rank===1?"var(--go-glow)":"var(--mi-glow)"}`:undefined,
                  letterSpacing:"-0.01em",
                }}>
                  {(e.score/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
                </p>
              </div>
            );
          })}

          {/* Pagination */}
          {pages>1 && (
            <div style={{
              display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"12px 20px",borderTop:"1px solid var(--b0)",
              background:"var(--g1)",
            }}>
              <p className="label">{page+1} / {pages} · {totalN} entries</p>
              <div style={{display:"flex",gap:"6px"}}>
                {[
                  {label:"← Prev",dis:page===0,      fn:()=>setPage(p=>p-1)},
                  {label:"Next →",dis:page>=pages-1, fn:()=>setPage(p=>p+1)},
                ].map(b=>(
                  <button key={b.label} onClick={b.fn} disabled={b.dis} className="btn-ghost"
                    style={{padding:"6px 14px",fontSize:"12px",opacity:b.dis?0.4:1,cursor:b.dis?"not-allowed":"pointer"}}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Footer live indicator */}
          <div style={{
            display:"flex",alignItems:"center",gap:"7px",
            padding:"9px 20px",borderTop:"1px solid var(--b0)",
          }}>
            <span className="dot dot-mi" style={{width:"4px",height:"4px"}}/>
            <p className="label">Live on-chain · refreshes every 10s</p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes lbPulse { 0%,100%{opacity:0.4}50%{opacity:0.8} }
      `}</style>
    </div>
  );
}