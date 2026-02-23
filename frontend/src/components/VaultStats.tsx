"use client";

import { useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { BENEVOLENCE_VAULT_ABI, REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";
import { useEffect, useRef } from "react";

function AnimNum({ to, dec=0 }: { to:number; dec?:number }) {
  const ref  = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  useEffect(() => {
    if (!ref.current || to === prev.current) return;
    const s=prev.current, e=to, t0=performance.now();
    const tick=(now:number)=>{
      const p=Math.min((now-t0)/1100,1), ease=1-Math.pow(1-p,3);
      if(ref.current) ref.current.textContent=(s+(e-s)*ease).toLocaleString("en-US",{maximumFractionDigits:dec});
      if(p<1) requestAnimationFrame(tick); else prev.current=e;
    };
    requestAnimationFrame(tick);
  },[to,dec]);
  return <span ref={ref}>{to.toLocaleString("en-US",{maximumFractionDigits:dec})}</span>;
}

const COLS = [
  {
    key:"events",
    label:"Events Verified",
    sublabel:"On-chain proofs",
    dec:0,
    color:"var(--mi)", dim:"var(--mi-dim)", edge:"var(--mi-edge)", glow:"var(--mi-glow)", dot:"dot-mi",
    icon:(
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1L12.5 4.5v7L7 13 1.5 11.5v-7L7 1z" stroke="var(--mi)" strokeWidth="1.3" strokeLinejoin="round"/>
        <circle cx="7" cy="7" r="1.8" fill="var(--mi)"/>
      </svg>
    ),
  },
  {
    key:"volunteers",
    label:"Volunteers",
    sublabel:"Verified wallets",
    dec:0,
    color:"var(--vi)", dim:"var(--vi-dim)", edge:"var(--vi-edge)", glow:"var(--vi-glow)", dot:"dot-vi",
    icon:(
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="5" cy="4.5" r="2" stroke="var(--vi)" strokeWidth="1.3"/>
        <path d="M1 12c0-2.76 1.79-5 4-5s4 2.24 4 5" stroke="var(--vi)" strokeWidth="1.3" strokeLinecap="round"/>
        <circle cx="10" cy="5" r="1.6" stroke="var(--vi)" strokeWidth="1.3" strokeDasharray="2 1"/>
      </svg>
    ),
  },
  {
    key:"distributed",
    label:"GOOD Distributed",
    sublabel:"Native coin rewarded",
    dec:2,
    color:"var(--go)", dim:"var(--go-dim)", edge:"var(--go-edge)", glow:"var(--go-glow)", dot:"dot-go",
    icon:(
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="var(--go)" strokeWidth="1.3"/>
        <path d="M7 3.5v7M4.5 5.5l2.5-2 2.5 2" stroke="var(--go)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key:"impact",
    label:"Total Impact Score",
    sublabel:"Cumulative points",
    dec:0,
    color:"var(--vi)", dim:"var(--vi-dim)", edge:"var(--vi-edge)", glow:"var(--vi-glow)", dot:"dot-vi",
    icon:(
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 7a5 5 0 0110 0" stroke="var(--vi)" strokeWidth="1.3" strokeLinecap="round"/>
        <path d="M12 7a5 5 0 01-10 0" stroke="var(--vi)" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="2 1.5"/>
        <polyline points="11,4 12,7 9,7" stroke="var(--vi)" strokeWidth="1.3" strokeLinejoin="round"/>
      </svg>
    ),
  },
] as const;

export default function VaultStats() {
  const { data } = useReadContracts({
    contracts: [
      { address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`, abi: BENEVOLENCE_VAULT_ABI, functionName: "getStats"      },
      { address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`, abi: REPUTATION_LEDGER_ABI, functionName: "getGlobalStats" },
    ],
    query: { refetchInterval: 8_000 },
  });

  const vault  = data?.[0]?.result as readonly[bigint,bigint,bigint,bigint] | undefined;
  const global = data?.[1]?.result as readonly[bigint,bigint] | undefined;

  const stats: Record<string, number|null> = {
    events:      vault  ? Number(vault[2])                   : null,
    volunteers:  global ? Number(global[0])                  : null,
    distributed: vault  ? Number(formatUnits(vault[1], 18)) : null,
    // v2.0: total impact score dari ReputationLedger
    impact:      global ? Number(global[1]) / 100            : null,
  };

  return (
    <div style={{
      position:"relative",
      borderTop:"1px solid var(--b0)",
      borderBottom:"1px solid var(--b0)",
      overflow:"hidden",
    }}>
      <div className="divider-glow" style={{position:"absolute",top:0,left:0,right:0}}/>

      <div style={{
        maxWidth:"var(--mw)", margin:"0 auto",
        padding:"0 40px",
        display:"grid",
        gridTemplateColumns:"repeat(4,1fr) auto",
        alignItems:"stretch",
        background:"rgba(3,8,14,0.5)",
      }}>
        {COLS.map((c,i) => {
          const val     = stats[c.key];
          const notLast = i < COLS.length-1;
          return (
            <div
              key={c.key}
              style={{
                padding:"20px 0",
                paddingRight: notLast ? "28px" : 0,
                paddingLeft:  i > 0   ? "28px" : 0,
                borderRight:  notLast ? "1px solid var(--b0)" : undefined,
                transition:"background 0.2s",
                cursor:"default",
                position:"relative",
              }}
              onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.background=c.dim}
              onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.background="transparent"}
            >
              <div style={{display:"flex",alignItems:"center",gap:"7px",marginBottom:"12px"}}>
                {c.icon}
                <p className="label" style={{color:c.color,opacity:0.7}}>{c.label}</p>
              </div>

              <p style={{
                fontFamily:"'JetBrains Mono',monospace",
                fontSize:"24px", fontWeight:600,
                letterSpacing:"-0.02em", lineHeight:1,
                color:       val!==null ? c.color         : "var(--t3)",
                textShadow:  val!==null ? `0 0 24px ${c.glow}` : "none",
                marginBottom:"5px",
              }}>
                {val !== null
                  ? <AnimNum to={val} dec={c.dec}/>
                  : <span style={{opacity:0.3,fontSize:"16px"}}>—</span>
                }
              </p>

              <p className="label" style={{fontSize:"8px",color:"var(--t3)"}}>{c.sublabel}</p>
            </div>
          );
        })}

        {/* Live indicator */}
        <div style={{
          display:"flex", alignItems:"center",
          paddingLeft:"28px",
          borderLeft:"1px solid var(--b0)",
        }}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"8px"}}>
            <div style={{
              padding:"8px", borderRadius:"var(--r2)",
              background:"var(--g1)", border:"1px solid var(--b0)",
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 5C6 3.9 6.9 3 8 3h4a2 2 0 010 4h-1.5" stroke="var(--vi)" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M10 11C10 12.1 9.1 13 8 13H4a2 2 0 010-4h1.5" stroke="var(--mi)" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="6.5" y1="8" x2="9.5" y2="8" stroke="var(--go)" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{
              display:"flex", alignItems:"center", gap:"5px",
              padding:"5px 10px", borderRadius:"99px",
              background:"var(--mi-dim)", border:"1px solid var(--mi-edge)",
            }}>
              <span className="dot dot-mi" style={{width:"4px",height:"4px"}}/>
              <span style={{
                fontFamily:"'JetBrains Mono',monospace",
                fontSize:"8px", fontWeight:600,
                color:"var(--mi)", letterSpacing:"0.12em",
              }}>LIVE</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}