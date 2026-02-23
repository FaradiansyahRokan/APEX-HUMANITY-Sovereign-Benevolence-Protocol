"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";

interface FeedEv {
  eventId:string; volunteer:string;
  impactScore:number; tokenReward:number;
  txHash:string; blockNumber:bigint; timestamp:number;
}

function ago(ts:number):string {
  const d=Math.floor(Date.now()/1000)-ts;
  if(d<60)    return `${d}s ago`;
  if(d<3600)  return `${Math.floor(d/60)}m ago`;
  if(d<86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

function ScoreChip({score}:{score:number}) {
  /* Tiered coloring: mint = high, violet = mid, muted = low */
  const high   = score>=80;
  const mid    = score>=60 && score<80;
  const color  = high?"var(--mi)":mid?"var(--vi)":"var(--t2)";
  const dim    = high?"var(--mi-dim)":mid?"var(--vi-dim)":"var(--g2)";
  const edge   = high?"var(--mi-edge)":mid?"var(--vi-edge)":"var(--b0)";
  const glow   = high?"var(--mi-glow)":mid?"var(--vi-glow)":"none";

  return (
    <div style={{
      width:"48px",height:"48px",borderRadius:"12px",
      background:dim, border:`1px solid ${edge}`,
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      flexShrink:0, boxShadow: glow!=="none" ? `0 0 16px ${glow}` : "none",
    }}>
      <span style={{
        fontFamily:"'JetBrains Mono',monospace",
        fontSize:"14px",fontWeight:600,color,lineHeight:1,
      }}>{score.toFixed(0)}</span>
      <span className="label" style={{fontSize:"7px",marginTop:"2px",color,opacity:0.6}}>score</span>
    </div>
  );
}

export default function ImpactFeed() {
  const client = usePublicClient();
  const [events,setEvents] = useState<FeedEv[]>([]);
  const [loading,setLoading] = useState(true);
  const [newCnt,setNewCnt] = useState(0);

  useEffect(()=>{
    if(!client)return;
    (async()=>{
      try{
        const logs = await client.getLogs({
          address:CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
          event:{
            type:"event",name:"RewardReleased",
            inputs:[
              {type:"bytes32",name:"eventId",indexed:true},
              {type:"address",name:"volunteer",indexed:true},
              {type:"address",name:"beneficiary",indexed:true},
              {type:"uint256",name:"impactScore",indexed:false},
              {type:"uint256",name:"tokenReward",indexed:false},
              {type:"bytes32",name:"zkProofHash",indexed:false},
              {type:"bytes32",name:"eventHash",indexed:false},
              {type:"uint256",name:"timestamp",indexed:false},
            ],
          },
          fromBlock:0n, toBlock:"latest",
        });
        setEvents(logs.map((l:any)=>({
          eventId:l.args.eventId, volunteer:l.args.volunteer,
          impactScore:Number(l.args.impactScore)/100,
          tokenReward:Number(formatUnits(l.args.tokenReward,18)),
          txHash:l.transactionHash, blockNumber:l.blockNumber,
          timestamp:Number(l.args.timestamp),
        })).reverse());
      }catch(e){console.error(e);}
      finally{setLoading(false);}
    })();
  },[client]);

  useEffect(()=>{
    if(!client)return;
    const u=client.watchContractEvent({
      address:CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
      abi:BENEVOLENCE_VAULT_ABI, eventName:"RewardReleased",
      onLogs:(logs:any[])=>{
        const ne=logs.map(l=>({
          eventId:l.args.eventId, volunteer:l.args.volunteer,
          impactScore:Number(l.args.impactScore)/100,
          tokenReward:Number(formatUnits(l.args.tokenReward,18)),
          txHash:l.transactionHash, blockNumber:l.blockNumber,
          timestamp:Number(l.args.timestamp),
        }));
        setEvents(p=>[...ne,...p]);
        setNewCnt(c=>c+ne.length);
        setTimeout(()=>setNewCnt(0),3000);
      },
    });
    return ()=>u();
  },[client]);

  return (
    <div style={{maxWidth:"700px"}}>
      {/* Header */}
      <div style={{
        display:"flex",alignItems:"flex-end",justifyContent:"space-between",
        marginBottom:"24px",gap:"16px",flexWrap:"wrap",
      }}>
        <div>
          <p className="label" style={{marginBottom:"8px",color:"var(--mi)"}}>Live Impact Feed</p>
          <p className="title" style={{fontSize:"18px"}}>
            {events.length.toLocaleString()}
            <span style={{color:"var(--t1)",fontWeight:400,fontSize:"14px"}}> events on-chain</span>
          </p>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
          {newCnt>0 && (
            <div style={{
              padding:"5px 12px",borderRadius:"99px",
              background:"var(--mi-dim)",border:"1px solid var(--mi-edge)",
              fontFamily:"'JetBrains Mono',monospace",fontSize:"10px",
              color:"var(--mi)",fontWeight:500,
              animation:"feedFade 0.3s ease",
            }}>+{newCnt} new</div>
          )}
          <div style={{
            display:"flex",alignItems:"center",gap:"7px",
            padding:"6px 14px",borderRadius:"99px",
            background:"var(--mi-dim)",border:"1px solid var(--mi-edge)",
          }}>
            <span className="dot dot-mi" style={{width:"5px",height:"5px"}}/>
            <span style={{
              fontFamily:"'JetBrains Mono',monospace",
              fontSize:"9px",fontWeight:600,color:"var(--mi)",letterSpacing:"0.12em",
            }}>LIVE</span>
          </div>
        </div>
      </div>

      {/* Feed list */}
      <div style={{
        borderRadius:"var(--r3)",overflow:"hidden",
        border:"1px solid var(--b0)",background:"var(--g0)",
      }}>
        {loading && (
          <div style={{padding:"64px 24px",textAlign:"center"}}>
            <p className="label" style={{letterSpacing:"0.12em",animation:"feedPulse 1.5s ease-in-out infinite"}}>
              Scanning blockchain…
            </p>
          </div>
        )}

        {!loading && events.length===0 && (
          <div style={{padding:"80px 24px",textAlign:"center"}}>
            <p style={{fontSize:"36px",opacity:0.08,marginBottom:"14px"}}>⛓️</p>
            <p style={{fontSize:"14px",color:"var(--t1)",marginBottom:"5px"}}>No events yet</p>
            <p className="label">Submit your first impact proof to start the feed</p>
          </div>
        )}

        {!loading && events.map((ev,i)=>(
          <div key={ev.txHash+i}
            style={{
              display:"grid",gridTemplateColumns:"48px 1fr auto",
              alignItems:"center",gap:"16px",
              padding:"14px 20px",
              borderTop: i>0?"1px solid var(--b0)":undefined,
              transition:"background 0.12s",
            }}
            onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.background="var(--g1)"}
            onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.background="transparent"}
          >
            <ScoreChip score={ev.impactScore}/>

            <div style={{minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:"9px",marginBottom:"5px",flexWrap:"wrap"}}>
                {i===0 && <span className="dot dot-mi" style={{width:"5px",height:"5px",flexShrink:0}}/>}
                <span style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:"12px",fontWeight:500,color:"var(--t1)",letterSpacing:"0.02em",
                }}>
                  {ev.volunteer.slice(0,8)}…{ev.volunteer.slice(-6)}
                </span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
                <span style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:"11px",fontWeight:600,color:"var(--go)",
                  textShadow:"0 0 10px var(--go-glow)",
                }}>
                  +{ev.tokenReward.toFixed(2)} GOOD
                </span>
                <span className="label">Block #{ev.blockNumber.toString()}</span>
              </div>
            </div>

            <div style={{textAlign:"right",flexShrink:0}}>
              <p style={{fontFamily:"'JetBrains Mono',monospace",fontSize:"11px",color:"var(--t2)",marginBottom:"5px"}}>
                {ago(ev.timestamp)}
              </p>
              <a
                href="#"
                onClick={e=>{e.preventDefault();navigator.clipboard.writeText(ev.txHash);}}
                title="Copy TX hash"
                style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:"10px",color:"var(--vi)",
                  opacity:0.5,textDecoration:"none",transition:"opacity 0.12s",
                }}
                onMouseEnter={e=>(e.currentTarget as HTMLAnchorElement).style.opacity="1"}
                onMouseLeave={e=>(e.currentTarget as HTMLAnchorElement).style.opacity="0.5"}
              >
                {ev.txHash.slice(0,10)}…
              </a>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes feedPulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        @keyframes feedFade  { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  );
}