"use client";

import { useReadContract } from "wagmi";
import { REPUTATION_LEDGER_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";

const BADGES = [
  { id:1, icon:"🌱", name:"First Step",   desc:"Submitted your first impact proof",            tier:"common"    },
  { id:2, icon:"🤝", name:"Helper",        desc:"Completed 5 verified impact events",           tier:"common"    },
  { id:3, icon:"⭐", name:"Dedicated",     desc:"Completed 10 verified impact events",          tier:"rare"      },
  { id:4, icon:"⚔️", name:"Champion",      desc:"Completed 25 verified impact events",          tier:"rare"      },
  { id:5, icon:"🏆", name:"Legend",        desc:"Completed 50 verified impact events",          tier:"epic"      },
  { id:6, icon:"🔥", name:"High Impact",   desc:"Impact score 80+ in a single event",           tier:"rare"      },
  { id:7, icon:"💯", name:"Perfect",       desc:"Achieved a perfect 100 impact score",          tier:"epic"      },
  { id:8, icon:"🌍", name:"Century",       desc:"10,000+ cumulative impact points",             tier:"legendary" },
  { id:9, icon:"⚡", name:"Titan",         desc:"50,000+ cumulative impact points",             tier:"legendary" },
];

const TIERS = {
  common:    { color:"var(--t1)",   dim:"var(--g2)",    edge:"var(--b0)", glow:"none",                dot:"rgba(255,255,255,0.3)"  },
  rare:      { color:"var(--mi)",   dim:"var(--mi-dim)",edge:"var(--mi-edge)", glow:"0 0 24px var(--mi-glow)", dot:"var(--mi)" },
  epic:      { color:"var(--vi)",   dim:"var(--vi-dim)",edge:"var(--vi-edge)", glow:"0 0 28px var(--vi-glow)", dot:"var(--vi)" },
  legendary: { color:"var(--go)",   dim:"var(--go-dim)",edge:"var(--go-edge)", glow:"0 0 32px var(--go-glow)", dot:"var(--go)" },
};

function fmtDate(ts:number) {
  if(!ts) return "";
  return new Date(ts*1000).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
}

function Badge({ b, earned, at }: { b:typeof BADGES[0]; earned:boolean; at:number }) {
  const t = TIERS[b.tier as keyof typeof TIERS];
  return (
    <div
      style={{
        position:"relative",
        borderRadius:"var(--r3)",
        padding:"20px 16px",
        border:`1px solid ${earned ? t.edge : "var(--b0)"}`,
        background: earned
          ? `linear-gradient(160deg,${t.dim} 0%,var(--g1) 70%)`
          : "var(--g0)",
        boxShadow: earned ? t.glow : "none",
        opacity: earned ? 1 : 0.28,
        filter: earned ? "none" : "grayscale(1)",
        transition:"transform 0.2s ease, box-shadow 0.2s ease",
        cursor:"default",
        display:"flex", flexDirection:"column",
        alignItems:"center", textAlign:"center", gap:"9px",
        overflow:"hidden",
      }}
      onMouseEnter={e=>{
        if(earned){
          (e.currentTarget as HTMLDivElement).style.transform="translateY(-3px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow=t.glow!=="none"
            ? t.glow : "0 8px 32px rgba(0,0,0,0.3)";
        }
      }}
      onMouseLeave={e=>{
        (e.currentTarget as HTMLDivElement).style.transform="translateY(0)";
        (e.currentTarget as HTMLDivElement).style.boxShadow=earned ? t.glow : "none";
      }}
    >
      {/* Tier label */}
      <span className={`tier tier-${b.tier}`} style={{position:"absolute",top:"10px",right:"10px"}}>
        {earned ? b.tier : "🔒"}
      </span>

      {/* Earned indicator dot */}
      {earned && (
        <div style={{
          position:"absolute",top:"11px",left:"13px",
          width:"5px",height:"5px",borderRadius:"50%",
          background:t.dot, boxShadow:`0 0 8px ${t.dot}`,
        }}/>
      )}

      {/* Icon in circle */}
      <div style={{
        width:"56px",height:"56px",borderRadius:"50%",
        background: earned ? t.dim : "var(--g1)",
        border:`1.5px solid ${earned ? t.edge : "var(--b0)"}`,
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:"26px",flexShrink:0,marginTop:"10px",
        boxShadow: earned ? `0 0 16px ${t.dot}40` : "none",
      }}>{b.icon}</div>

      {/* Name */}
      <p style={{
        fontFamily:"'Plus Jakarta Sans',sans-serif",
        fontSize:"12px",fontWeight:700,
        color: earned ? "var(--t0)" : "var(--t3)",
        letterSpacing:"0.01em",
      }}>{b.name}</p>

      {/* Desc */}
      <p style={{
        fontFamily:"'JetBrains Mono',monospace",
        fontSize:"9.5px",color:"var(--t2)",
        lineHeight:1.55, flex:1,
      }}>{b.desc}</p>

      {/* Date */}
      {earned && at>0 && (
        <p style={{
          fontFamily:"'JetBrains Mono',monospace",
          fontSize:"9px",color:t.color,
          letterSpacing:"0.04em",
          padding:"3px 8px",borderRadius:"4px",
          background:t.dim,border:`1px solid ${t.edge}`,
        }}>✓ {fmtDate(at)}</p>
      )}
    </div>
  );
}

export default function Badges({ address }: { address:string }) {
  const { data:ids }  = useReadContract({ address:CONTRACTS.REPUTATION_LEDGER as `0x${string}`, abi:REPUTATION_LEDGER_ABI, functionName:"getBadges",    args:[address as `0x${string}`], query:{refetchInterval:8_000} });
  const { data:all  } = useReadContract({ address:CONTRACTS.REPUTATION_LEDGER as `0x${string}`, abi:REPUTATION_LEDGER_ABI, functionName:"getAllBadges", args:[address as `0x${string}`], query:{refetchInterval:8_000} });

  const earned = new Set((ids as number[]|undefined)?.map(Number)??[]);
  const atMap: Record<number,number> = {};
  if(all) (all as any[]).forEach(b=>{ atMap[Number(b.id)]=Number(b.earnedAt); });

  const n   = earned.size;
  const pct = Math.round((n/BADGES.length)*100);

  return (
    <div>
      {/* Header */}
      <div style={{
        display:"flex",alignItems:"flex-end",justifyContent:"space-between",
        marginBottom:"28px",gap:"20px",flexWrap:"wrap",
      }}>
        <div>
          <p className="label" style={{marginBottom:"8px",color:"var(--go)"}}>Achievement Badges</p>
          <h2 className="title">
            {n}
            <span style={{color:"var(--t2)",fontWeight:400,fontSize:"17px"}}> / {BADGES.length} Unlocked</span>
          </h2>
        </div>

        <div style={{minWidth:"180px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
            <p className="label">Progress</p>
            <p style={{fontFamily:"'JetBrains Mono',monospace",fontSize:"12px",fontWeight:600,color:"var(--go)"}}>{pct}%</p>
          </div>
          <div className="track" style={{height:"5px"}}>
            <div className="fill-multi" style={{width:`${pct}%`}}/>
          </div>
        </div>
      </div>

      {/* Tier legend */}
      <div style={{
        display:"flex",gap:"20px",flexWrap:"wrap",
        marginBottom:"22px",paddingBottom:"18px",
        borderBottom:"1px solid var(--b0)",
        alignItems:"center",
      }}>
        {Object.entries(TIERS).map(([t,s])=>(
          <div key={t} style={{display:"flex",alignItems:"center",gap:"7px"}}>
            <div style={{
              width:"10px",height:"10px",borderRadius:"3px",
              background:s.dim,border:`1px solid ${s.edge}`,
            }}/>
            <span className="label" style={{color:s.color}}>{t}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{
        display:"grid",
        gridTemplateColumns:"repeat(auto-fill,minmax(152px,1fr))",
        gap:"10px",
      }}>
        {BADGES.map(b=>(
          <Badge key={b.id} b={b} earned={earned.has(b.id)} at={atMap[b.id]??0}/>
        ))}
      </div>
    </div>
  );
}