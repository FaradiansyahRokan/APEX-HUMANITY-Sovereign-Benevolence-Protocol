"use client";

import { useState, useRef } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi"; // <-- Tambahkan usePublicClient
import { pad } from "viem";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";
import { CONTRACTS, ACTION_TYPES, URGENCY_LEVELS } from "../utils/constants";

type Step = "form"|"uploading"|"oracle"|"onchain"|"success";
interface Form {
  actionType:string; urgencyLevel:string; description:string;
  effortHours:number; peopleHelped:number;
  latitude:number; longitude:number; povertyIndex:number; ipfsCid:string;
}

const STEPS = [
  { key:"uploading", label:"IPFS Upload",          icon:"📁" },
  { key:"oracle",    label:"Oracle Verify",         icon:"🔮" },
  { key:"onchain",   label:"On-chain Record",       icon:"⛓️"  },
];

export default function SubmitImpactForm() {
  const { address } = useAccount();
  const publicClient = usePublicClient()
  const fileRef = useRef<HTMLInputElement>(null);
  const [file,setFile]   = useState<File|null>(null);
  const [step,setStep]   = useState<Step>("form");
  const [txHash,setTxHash] = useState("");
  const [oracle,setOracle] = useState<any>(null);
  const [error,setError] = useState("");
  const [form,setForm]   = useState<Form>({
    actionType:"FOOD_DISTRIBUTION", urgencyLevel:"HIGH",
    description:"", effortHours:4, peopleHelped:10,
    latitude:0, longitude:0, povertyIndex:0.7, ipfsCid:"",
  });

  const { writeContractAsync } = useWriteContract();
  const busy = step !== "form";
  const stepIdx = STEPS.findIndex(s=>s.key===step);

  const handleSubmit = async (e:React.FormEvent) => {
    e.preventDefault(); setError("");
    try {
      setStep("uploading");
      await new Promise(r=>setTimeout(r,1400));
      const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

      setStep("oracle");
      let image_base64:string|null=null;
      if(file){
        image_base64 = await new Promise<string>((res,rej)=>{
          const r=new FileReader();
          r.onload=()=>res((r.result as string).split(",")[1]);
          r.onerror=()=>rej(new Error("Failed to read file"));
          r.readAsDataURL(file);
        });
      }

      const resp = await fetch(`${process.env.NEXT_PUBLIC_ORACLE_URL}/api/v1/verify`,{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-APEX-Oracle-Key":process.env.NEXT_PUBLIC_SATIN_API_KEY||"apex-dev-key",
        },
        body:JSON.stringify({
          ipfs_cid:cid, evidence_type:file?"image":"text",
          hash_sha256:"a".repeat(64),
          gps:{latitude:form.latitude,longitude:form.longitude,accuracy_meters:10},
          action_type:form.actionType, people_helped:form.peopleHelped,
          urgency_level:form.urgencyLevel, effort_hours:form.effortHours,
          volunteer_address:address, beneficiary_address:address,
          country_iso:"ID", description:form.description, image_base64,
        }),
      });
      if(!resp.ok){const e=await resp.json();throw new Error(e.detail||"Oracle failed");}
      const real=await resp.json();
      setOracle(real);

      setStep("onchain");
      const ca=real.contract_args;
      if(!address||!CONTRACTS.BENEVOLENCE_VAULT) throw new Error("Wallet not connected");

      // 1. Lempar transaksi ke jaringan
      const hash=await writeContractAsync({
        address:CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
        abi:BENEVOLENCE_VAULT_ABI, functionName:"releaseReward",
        args:[
          pad(`0x${real.event_id.replace(/-/g,"")}` as `0x${string}`,{size:32}),
          address as `0x${string}`,
          (ca.beneficiaryAddress??address) as `0x${string}`,
          BigInt(ca.impactScoreScaled), BigInt(ca.tokenRewardWei),
          pad(`0x${real.zk_proof_hash.replace("0x","")}` as `0x${string}`,{size:32}),
          pad(`0x${real.event_hash.replace("0x","")}` as `0x${string}`,{size:32}),
          real.nonce, BigInt(real.expires_at),
          Number(real.signature.v),
          real.signature.r as `0x${string}`,
          real.signature.s as `0x${string}`,
        ],
        gas: 800000n,
      });

      // 2. TUNGGU SAMPAI TRANSAKSI SELESAI (MINED)
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        
        // Cek apakah transaksinya Revert/Gagal di level Smart Contract
        if (receipt.status !== "success") {
          throw new Error("Transaction reverted by the smart contract! Check gas or contract logic.");
        }
      }

      // 3. Jika lolos sampai sini, berarti BENAR-BENAR BERHASIL
      setTxHash(hash);
      setStep("success");
    } catch(err:any) {
      setError(err.message||"Transaction failed");
      setStep("form");
    }
  };

  /* ── Success screen ── */
  if(step==="success") return (
    <div style={{
      maxWidth:"480px",
      padding:"48px 40px",borderRadius:"var(--r5)",
      background:"linear-gradient(160deg,var(--mi-deep) 0%,var(--g1) 50%)",
      border:"1px solid var(--mi-edge)",
      display:"flex",flexDirection:"column",alignItems:"center",
      textAlign:"center",gap:"22px",
      boxShadow:"0 0 60px rgba(0,223,162,0.08)",
    }}>
      <div style={{height:"2px",width:"80px",background:"linear-gradient(90deg,var(--mi),var(--vi))",borderRadius:"1px"}}/>

      <div style={{
        width:"60px",height:"60px",borderRadius:"18px",
        background:"var(--mi-dim)",border:"1px solid var(--mi-edge)",
        display:"flex",alignItems:"center",justifyContent:"center",fontSize:"28px",
        boxShadow:"0 0 28px var(--mi-glow)",
      }}>✅</div>

      <div>
        <p style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:800,fontSize:"22px",color:"var(--t0)",marginBottom:"8px",letterSpacing:"-0.01em"}}>
          Impact Verified!
        </p>
        <p style={{fontSize:"14px",color:"var(--t1)",lineHeight:1.7}}>
          Your action has been verified by AI and recorded on the immutable Reputation Ledger.
        </p>
      </div>

      {oracle && (
        <div style={{
          width:"100%",borderRadius:"var(--r3)",
          background:"var(--g1)",border:"1px solid var(--b0)",
          overflow:"hidden",
        }}>
          <div style={{height:"2px",background:"linear-gradient(90deg,var(--mi),var(--vi),var(--go))"}}/>
          <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:"12px"}}>
            {[
              {label:"Impact Score",       value:`${oracle.impact_score}/100`,             color:"var(--mi)"},
              {label:"AI Confidence",      value:`${((oracle?.ai_confidence||0)*100).toFixed(1)}%`, color:"var(--vi)"},
              {label:"GOOD Earned",        value:`${oracle.token_reward.toFixed(2)} GOOD`, color:"var(--go)"},
            ].map(s=>(
              <div key={s.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <p className="label">{s.label}</p>
                <p style={{
                  fontFamily:"'JetBrains Mono',monospace",
                  fontSize:"14px",fontWeight:600,color:s.color,
                  textShadow:`0 0 14px ${s.color}50`,
                }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {txHash && (
        <a href={`https://polygonscan.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          style={{fontFamily:"'JetBrains Mono',monospace",fontSize:"11px",color:"var(--vi)",textDecoration:"none",opacity:0.7}}>
          View on PolygonScan ↗
        </a>
      )}

      <button onClick={()=>{setStep("form");setFile(null);setOracle(null);setTxHash("");}} className="btn-ghost" style={{width:"100%"}}>
        Submit Another Proof
      </button>
    </div>
  );

  /* ── Form ── */
  return (
    <div style={{maxWidth:"600px"}}>

      {/* Processing progress */}
      {busy && (
        <div style={{
          marginBottom:"28px",padding:"20px 24px",
          borderRadius:"var(--r3)",
          background:"var(--g1)",border:"1px solid var(--b0)",
        }}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px",marginBottom:"16px"}}>
            {STEPS.map((s,i)=>{
              const done   = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={s.key} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"7px",textAlign:"center"}}>
                  <div style={{
                    width:"34px",height:"34px",borderRadius:"50%",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:"14px",
                    background:active?"var(--mi-dim)":done?"var(--g2)":"var(--g0)",
                    border:active?"1px solid var(--mi-edge)":done?"1px solid var(--b1)":"1px solid var(--b0)",
                    boxShadow:active?"0 0 16px var(--mi-glow)":"none",
                  }}>
                    {done ? "✓" : s.icon}
                  </div>
                  <p className="label" style={{
                    color:active?"var(--mi)":done?"var(--t1)":"var(--t3)",
                    lineHeight:1.4,fontSize:"9px",
                  }}>{s.label}</p>
                </div>
              );
            })}
          </div>
          <div className="track" style={{height:"4px"}}>
            <div className="fill-mi" style={{
              width:`${((stepIdx+1)/STEPS.length)*100}%`,
              transition:"width 0.5s ease",
            }}/>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{display:"flex",flexDirection:"column",gap:"22px"}}>

        {/* Action Type */}
        <div>
          <p className="label" style={{marginBottom:"8px"}}>Action Type</p>
          <select value={form.actionType} onChange={e=>setForm(f=>({...f,actionType:e.target.value}))}
            className="field" style={{appearance:"none",cursor:"pointer"}}>
            {ACTION_TYPES.map(a=>(
              <option key={a.value} value={a.value}>{a.emoji} {a.label}</option>
            ))}
          </select>
        </div>

        {/* Urgency */}
        <div>
          <p className="label" style={{marginBottom:"8px"}}>Urgency Level</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"6px"}}>
            {URGENCY_LEVELS.map(u=>{
              const active = form.urgencyLevel===u.value;
              return (
                <button key={u.value} type="button"
                  onClick={()=>setForm(f=>({...f,urgencyLevel:u.value}))}
                  style={{
                    padding:"10px 8px",borderRadius:"var(--r2)",
                    fontFamily:"'Plus Jakarta Sans',sans-serif",
                    fontSize:"12px",fontWeight:active?700:400,cursor:"pointer",
                    background:active?"var(--vi-dim)":"var(--g0)",
                    border:active?"1px solid var(--vi-edge)":"1px solid var(--b0)",
                    color:active?"var(--vi)":"var(--t2)",
                    transition:"all 0.15s",
                  }}>
                  {u.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Description */}
        <div>
          <p className="label" style={{marginBottom:"8px"}}>Impact Description</p>
          <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
            rows={4} required
            placeholder="Describe the beneficial action. The AI analyzes this for impact scoring…"
            className="field" style={{resize:"none",lineHeight:1.65}}/>
        </div>

        {/* Sliders */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"20px"}}>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
              <p className="label">Effort Hours</p>
              <p style={{fontFamily:"'JetBrains Mono',monospace",fontSize:"12px",fontWeight:600,color:"var(--t0)"}}>
                {form.effortHours}h
              </p>
            </div>
            <input type="range" min={0.5} max={72} step={0.5}
              value={form.effortHours}
              onChange={e=>setForm(f=>({...f,effortHours:Number(e.target.value)}))}
              style={{width:"100%",accentColor:"var(--vi)"}}/>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:"3px"}}>
              <span className="label" style={{fontSize:"8px"}}>0.5h</span>
              <span className="label" style={{fontSize:"8px"}}>72h</span>
            </div>
          </div>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
              <p className="label">People Helped</p>
              <p style={{fontFamily:"'JetBrains Mono',monospace",fontSize:"12px",fontWeight:600,color:"var(--t0)"}}>
                {form.peopleHelped}
              </p>
            </div>
            <input type="range" min={1} max={500} step={1}
              value={form.peopleHelped}
              onChange={e=>setForm(f=>({...f,peopleHelped:Number(e.target.value)}))}
              style={{width:"100%",accentColor:"var(--mi)"}}/>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:"3px"}}>
              <span className="label" style={{fontSize:"8px"}}>1</span>
              <span className="label" style={{fontSize:"8px"}}>500+</span>
            </div>
          </div>
        </div>

        {/* GPS */}
        <div>
          <p className="label" style={{marginBottom:"8px"}}>GPS Coordinates</p>
          <div style={{display:"flex",gap:"8px"}}>
            <input type="number" placeholder="Latitude" step="any"
              value={form.latitude||""}
              onChange={e=>setForm(f=>({...f,latitude:Number(e.target.value)}))}
              className="field" style={{flex:1}}/>
            <input type="number" placeholder="Longitude" step="any"
              value={form.longitude||""}
              onChange={e=>setForm(f=>({...f,longitude:Number(e.target.value)}))}
              className="field" style={{flex:1}}/>
            <button type="button" className="btn-ghost"
              onClick={()=>navigator.geolocation.getCurrentPosition(
                p=>setForm(f=>({...f,latitude:p.coords.latitude,longitude:p.coords.longitude})),
                ()=>setError("Could not get location.")
              )}
              style={{flexShrink:0,whiteSpace:"nowrap"}}>
              Auto 📍
            </button>
          </div>
        </div>

        {/* File upload */}
        <div>
          <p className="label" style={{marginBottom:"8px"}}>Photo / Video Evidence</p>
          <div
            onClick={()=>fileRef.current?.click()}
            style={{
              padding:"28px 24px",borderRadius:"var(--r3)",
              border: file
                ? "1.5px dashed var(--mi-edge)"
                : "1.5px dashed var(--b1)",
              background: file ? "var(--mi-dim)" : "var(--g0)",
              cursor:"pointer",textAlign:"center",
              transition:"all 0.18s",
            }}
            onMouseEnter={e=>{
              if(!file)(e.currentTarget as HTMLDivElement).style.borderColor="var(--b2)";
            }}
            onMouseLeave={e=>{
              if(!file)(e.currentTarget as HTMLDivElement).style.borderColor="var(--b1)";
            }}
          >
            {file ? (
              <>
                <p style={{fontSize:"20px",marginBottom:"8px"}}>✅</p>
                <p style={{fontSize:"12px",fontWeight:600,color:"var(--mi)",marginBottom:"3px"}}>{file.name}</p>
                <p className="label">Click to replace</p>
              </>
            ) : (
              <>
                <p style={{fontSize:"24px",marginBottom:"10px",opacity:0.2}}>📷</p>
                <p style={{fontSize:"13px",color:"var(--t1)",marginBottom:"4px",fontWeight:500}}>
                  Upload photo or video evidence
                </p>
                <p className="label">Encrypted · Stored on IPFS</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*,video/*"
            style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)setFile(f);}}/>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding:"13px 16px",borderRadius:"var(--r2)",
            background:"rgba(255,80,80,0.07)",
            border:"1px solid rgba(255,80,80,0.2)",
            fontFamily:"'JetBrains Mono',monospace",
            fontSize:"12px",color:"rgba(255,140,140,0.9)",lineHeight:1.55,
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={busy||!form.description}
          className="btn-mint"
          style={{width:"100%",fontSize:"15px",padding:"16px",letterSpacing:"0.01em"}}
        >
          {busy ? "Processing…" : "✦ Submit Impact Proof"}
        </button>
      </form>
    </div>
  );
}