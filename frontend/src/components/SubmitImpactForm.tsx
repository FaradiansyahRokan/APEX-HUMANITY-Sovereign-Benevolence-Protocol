"use client";

import { useState, useRef, useEffect } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { pad } from "viem";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";
import { CONTRACTS, ACTION_TYPES, URGENCY_LEVELS } from "../utils/constants";

type Step = "form" | "uploading" | "oracle" | "onchain" | "success";
type CaptureMode = "camera" | "gallery" | null;

interface Form {
  actionType: string; urgencyLevel: string; description: string;
  effortHours: number; peopleHelped: number;
  latitude: number; longitude: number; povertyIndex: number; ipfsCid: string;
}

const STEPS = [
  { key: "uploading", label: "IPFS Upload", icon: "📁" },
  { key: "oracle", label: "Oracle Verify", icon: "🔮" },
  { key: "onchain", label: "On-chain Record", icon: "⛓️" },
];

const URGENCY_META: Record<string, { gradient: string; glow: string; bg: string; border: string }> = {
  CRITICAL: { gradient: "linear-gradient(135deg,#7c6aff,#ff6eb4)", glow: "rgba(124,106,255,0.2)", bg: "rgba(124,106,255,0.07)", border: "rgba(124,106,255,0.2)" },
  HIGH: { gradient: "linear-gradient(135deg,#ff6eb4,#ffbd59)", glow: "rgba(255,110,180,0.2)", bg: "rgba(255,110,180,0.07)", border: "rgba(255,110,180,0.2)" },
  MEDIUM: { gradient: "linear-gradient(135deg,#ffbd59,#00dfb2)", glow: "rgba(255,189,89,0.2)", bg: "rgba(255,189,89,0.07)", border: "rgba(255,189,89,0.2)" },
  LOW: { gradient: "linear-gradient(135deg,#00dfb2,#7c6aff)", glow: "rgba(0,223,178,0.2)", bg: "rgba(0,223,178,0.07)", border: "rgba(0,223,178,0.2)" },
};

const glassCard: React.CSSProperties = {
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(255,255,255,0.025)",
  overflow: "hidden",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "10px", color: "rgba(255,255,255,0.35)",
  textTransform: "uppercase", letterSpacing: "0.09em",
  marginBottom: "9px",
  fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 14px",
  borderRadius: "10px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  fontFamily: "'Plus Jakarta Sans', sans-serif",
  fontSize: "13px", color: "#fff",
  outline: "none", boxSizing: "border-box" as const,
  transition: "border-color 0.2s",
};

export default function SubmitImpactForm() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [txHash, setTxHash] = useState("");
  const [oracle, setOracle] = useState<any>(null);
  const [error, setError] = useState("");
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [captureTimestamp, setCaptureTimestamp] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({
    actionType: "FOOD_DISTRIBUTION", urgencyLevel: "HIGH",
    description: "", effortHours: 4, peopleHelped: 10,
    latitude: 0, longitude: 0, povertyIndex: 0.7, ipfsCid: "",
  });

  const { writeContractAsync } = useWriteContract();
  const busy = step !== "form";
  const stepIdx = STEPS.findIndex(s => s.key === step);

  // ── Camera helpers ────────────────────────────────────────────────────────
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  // Assign srcObject AFTER React renders <video> into the DOM
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraActive]);

  // Generate / revoke object URL for image preview
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);



  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setCaptureMode("camera");
      setCameraActive(true); // <video> mounts → useEffect assigns srcObject
      setFile(null);
    } catch {
      setError("Tidak dapat mengakses kamera. Izinkan akses kamera di browser.");
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const now = Date.now();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // ── Invisible cryptographic timestamp watermark ─────────────────────────
    // Tiny, low-opacity text in the bottom-right corner.
    // Virtually invisible to the human eye but readable by oracle/forensics.
    const ts = new Date(now).toISOString(); // e.g. "2026-02-27T21:40:00.000Z"
    const label = `APEX:${ts}`;
    const fontSize = Math.max(10, Math.floor(canvas.width * 0.012));
    ctx.font = `${fontSize}px monospace`;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, canvas.width - 8, canvas.height - 6);
    ctx.globalAlpha = 1.0;
    // ───────────────────────────────────────────────────────────────────────

    canvas.toBlob(blob => {
      if (!blob) return;
      const captured = new File([blob], `apex-capture-${now}.jpg`, { type: "image/jpeg" });
      setCaptureTimestamp(now);
      setFile(captured);
      setError("");
      stopCamera();
    }, "image/jpeg", 0.92);
  };

  const selectGallery = () => {
    stopCamera();
    setCaptureMode("gallery");
    fileRef.current?.click();
  };

  // ── Helper: real SHA-256 from ArrayBuffer ─────────────────────────────────
  const sha256Hex = async (buf: ArrayBuffer): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const source = captureMode === "camera" ? "live_capture" : "gallery";
    try {
      setStep("uploading");

      let hash_sha256 = "0".repeat(64);
      let cid = "text-only-submission";

      if (file) {
        const buf = await file.arrayBuffer();
        hash_sha256 = await sha256Hex(buf);
        cid = `sha256://${hash_sha256}`;
      }

      setStep("oracle");
      let image_base64: string | null = null;
      if (file) {
        image_base64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res((r.result as string).split(",")[1]);
          r.onerror = () => rej(new Error("Failed to read file"));
          r.readAsDataURL(file);
        });
      }

      const resp = await fetch(`${process.env.NEXT_PUBLIC_ORACLE_URL}/api/v1/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-APEX-Oracle-Key": process.env.NEXT_PUBLIC_SATIN_API_KEY || "apex-dev-key" },
        body: JSON.stringify({
          ipfs_cid: cid, evidence_type: file ? "image" : "text",
          hash_sha256,
          gps: { latitude: form.latitude, longitude: form.longitude, accuracy_meters: 10 },
          action_type: form.actionType, people_helped: form.peopleHelped,
          urgency_level: form.urgencyLevel, effort_hours: form.effortHours,
          volunteer_address: address, beneficiary_address: address,
          country_iso: "ID", description: form.description, image_base64,
          source,                                           // ← live_capture | gallery
          capture_timestamp: captureTimestamp ?? null,      // ← unix ms of live capture
        }),
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail || "Oracle failed"); }
      const real = await resp.json();
      setOracle(real);

      setStep("onchain");
      const ca = real.contract_args;
      if (!address || !CONTRACTS.BENEVOLENCE_VAULT) throw new Error("Wallet not connected");

      const hash = await writeContractAsync({
        address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
        abi: BENEVOLENCE_VAULT_ABI, functionName: "releaseReward",
        args: [
          pad(`0x${real.event_id.replace(/-/g, "")}` as `0x${string}`, { size: 32 }),
          address as `0x${string}`,
          (ca.beneficiaryAddress ?? address) as `0x${string}`,
          BigInt(ca.impactScoreScaled), BigInt(ca.tokenRewardWei),
          pad(`0x${real.zk_proof_hash.replace("0x", "")}` as `0x${string}`, { size: 32 }),
          pad(`0x${real.event_hash.replace("0x", "")}` as `0x${string}`, { size: 32 }),
          real.nonce, BigInt(real.expires_at),
          Number(real.signature.v),
          real.signature.r as `0x${string}`,
          real.signature.s as `0x${string}`,
        ],
        gas: 800000n,
      });

      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted by contract.");
      }

      setTxHash(hash);
      setStep("success");
      stopCamera();
    } catch (err: any) {
      setError(err.message || "Transaction failed");
      setStep("form");
    }
  };

  /* ── Success screen ── */
  if (step === "success") return (
    <div style={{ maxWidth: "480px" }}>
      <div style={{ ...glassCard, position: "relative" }}>
        <div style={{ height: "2px", background: "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59,#ff6eb4)" }} />
        {/* Glow */}
        <div style={{
          position: "absolute", top: "-40px", left: "50%", transform: "translateX(-50%)",
          width: "200px", height: "200px", borderRadius: "50%",
          background: "radial-gradient(circle,rgba(0,223,178,0.1) 0%,transparent 70%)",
          pointerEvents: "none",
        }} />
        <div style={{ padding: "40px 36px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "22px", position: "relative" }}>
          <div style={{
            width: "60px", height: "60px", borderRadius: "18px",
            background: "rgba(0,223,178,0.1)", border: "1px solid rgba(0,223,178,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "26px", boxShadow: "0 0 30px rgba(0,223,178,0.2)",
          }}>✅</div>

          <div>
            <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: "22px", color: "#fff", marginBottom: "8px" }}>
              Impact Verified!
            </p>
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
              Your action was verified by AI and recorded on the Reputation Ledger.
            </p>
          </div>

          {oracle && (
            <div style={{ width: "100%", borderRadius: "12px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
              <div style={{ height: "1px", background: "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59,#ff6eb4)" }} />
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { label: "Impact Score", value: `${oracle.impact_score}/100`, gradient: "linear-gradient(90deg,#00dfb2,#7c6aff)" },
                  { label: "AI Confidence", value: `${((oracle?.ai_confidence || 0) * 100).toFixed(1)}%`, gradient: "linear-gradient(90deg,#7c6aff,#ff6eb4)" },
                  { label: "APEX Earned", value: `${oracle.token_reward.toFixed(2)} APEX`, gradient: "linear-gradient(90deg,#ffbd59,#ff6eb4)" },
                ].map(s => (
                  <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>{s.label}</p>
                    <p style={{
                      fontFamily: "'JetBrains Mono',monospace", fontSize: "15px", fontWeight: 700,
                      background: s.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Integrity warnings */}
          {oracle?.integrity_warnings?.length > 0 && (
            <div style={{
              width: "100%", padding: "12px 16px", borderRadius: "10px",
              background: "rgba(255,189,89,0.06)", border: "1px solid rgba(255,189,89,0.2)",
              fontSize: "11px", color: "rgba(255,189,89,0.8)", lineHeight: 1.7,
              fontFamily: "'JetBrains Mono',monospace",
            }}>
              ⚠️ Integrity notes: {oracle.integrity_warnings.join(" · ")}
              {oracle.authenticity_penalty > 0 && (
                <span style={{ display: "block", marginTop: "4px", opacity: 0.7 }}>
                  Score adjusted by −{(oracle.authenticity_penalty * 100).toFixed(0)}% due to integrity flags.
                </span>
              )}
            </div>
          )}
          {txHash && (
            <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "rgba(124,106,255,0.5)" }}>
              TX: {txHash.slice(0, 14)}…{txHash.slice(-8)}
            </p>
          )}

          <button
            onClick={() => { setStep("form"); setFile(null); setOracle(null); setTxHash(""); setCaptureMode(null); setCaptureTimestamp(null); }}
            style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: "linear-gradient(135deg,#00dfb2,#7c6aff)",
              fontFamily: "'Plus Jakarta Sans',sans-serif",
              fontSize: "14px", fontWeight: 800, color: "#0a0510",
              cursor: "pointer", boxShadow: "0 4px 20px rgba(0,223,178,0.25)",
              transition: "transform 0.2s",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"}
          >
            Submit Another Proof →
          </button>
        </div>
      </div>
    </div>
  );

  /* ── Processing screen ── */
  if (busy) return (
    <div style={{ maxWidth: "480px" }}>
      <div style={{ ...glassCard }}>
        <div style={{ height: "2px", background: "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59,#ff6eb4)", backgroundSize: "200% 100%", animation: "shimmer 2s linear infinite" }} />
        <div style={{ padding: "40px 36px", display: "flex", flexDirection: "column", alignItems: "center", gap: "28px" }}>
          <div>
            <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: "20px", color: "#fff", textAlign: "center", marginBottom: "6px" }}>
              Processing…
            </p>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", textAlign: "center" }}>Please keep this tab open</p>
          </div>

          {/* Steps */}
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
            {STEPS.map((s, i) => {
              const done = stepIdx > i;
              const active = stepIdx === i;
              const pending = stepIdx < i;
              return (
                <div key={s.key} style={{
                  display: "flex", alignItems: "center", gap: "14px",
                  padding: "14px 18px", borderRadius: "12px",
                  background: active ? "rgba(0,223,178,0.06)"
                    : done ? "rgba(255,255,255,0.02)"
                      : "rgba(255,255,255,0.015)",
                  border: `1px solid ${active ? "rgba(0,223,178,0.18)" : "rgba(255,255,255,0.05)"}`,
                  transition: "all 0.3s",
                }}>
                  <div style={{
                    width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                    background: done ? "rgba(0,223,178,0.12)"
                      : active ? "rgba(0,223,178,0.08)"
                        : "rgba(255,255,255,0.03)",
                    border: `1px solid ${done || active ? "rgba(0,223,178,0.2)" : "rgba(255,255,255,0.06)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "16px",
                  }}>
                    {done ? "✓" : active ? <span style={{ animation: "spin 1s linear infinite", display: "block" }}>⟳</span> : s.icon}
                  </div>
                  <div>
                    <p style={{
                      fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700,
                      fontSize: "13px",
                      color: done || active ? "#fff" : "rgba(255,255,255,0.3)",
                    }}>{s.label}</p>
                    <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", marginTop: "2px" }}>
                      {done ? "Complete" : active ? "In progress…" : "Pending"}
                    </p>
                  </div>
                  {done && (
                    <div style={{ marginLeft: "auto" }}>
                      <span style={{
                        padding: "3px 9px", borderRadius: "6px",
                        background: "rgba(0,223,178,0.1)", border: "1px solid rgba(0,223,178,0.2)",
                        fontSize: "9px", fontWeight: 700, color: "#00dfb2",
                        fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em",
                      }}>DONE</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  /* ── Main form ── */
  return (
    <div style={{ maxWidth: "620px" }}>
      <div style={{ marginBottom: "24px" }}>
        <p style={{
          fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em",
          fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
          background: "linear-gradient(90deg,#00dfb2,#7c6aff)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          marginBottom: "6px",
        }}>Submit Impact Proof</p>
        <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: "22px", color: "#fff" }}>
          Record Your Good Deed
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

        {/* Action Type */}
        <div style={{ ...glassCard, padding: "20px 22px" }}>
          <label style={labelStyle}>Action Type</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "7px" }}>
            {ACTION_TYPES.map((a: { value: string; label: string }) => {
              const active = form.actionType === a.value;
              return (
                <button key={a.value} type="button"
                  onClick={() => setForm(f => ({ ...f, actionType: a.value }))}
                  style={{
                    padding: "9px 10px", borderRadius: "9px",
                    background: active ? "rgba(0,223,178,0.07)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${active ? "rgba(0,223,178,0.2)" : "rgba(255,255,255,0.06)"}`,
                    fontFamily: "'Plus Jakarta Sans',sans-serif",
                    fontSize: "11px", fontWeight: active ? 700 : 400,
                    color: active ? "#00dfb2" : "rgba(255,255,255,0.35)",
                    cursor: "pointer", transition: "all 0.15s", textAlign: "left" as const,
                  }}>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Urgency Level */}
        <div style={{ ...glassCard, padding: "20px 22px" }}>
          <label style={labelStyle}>Urgency Level</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
            {URGENCY_LEVELS.map((u: { value: string; label: string }) => {
              const active = form.urgencyLevel === u.value;
              const m = URGENCY_META[u.value] || URGENCY_META.MEDIUM;
              return (
                <button key={u.value} type="button"
                  onClick={() => setForm(f => ({ ...f, urgencyLevel: u.value }))}
                  style={{
                    padding: "10px 6px", borderRadius: "10px",
                    background: active ? m.bg : "rgba(255,255,255,0.02)",
                    border: `1px solid ${active ? m.border : "rgba(255,255,255,0.06)"}`,
                    fontFamily: "'Plus Jakarta Sans',sans-serif",
                    fontSize: "12px", fontWeight: active ? 800 : 400,
                    color: active ? "transparent" : "rgba(255,255,255,0.3)",
                    background2: active ? m.gradient : "none",
                    ...(active ? {
                      backgroundImage: m.gradient,
                      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    } : {}),
                    cursor: "pointer", transition: "all 0.15s",
                    boxShadow: active ? `0 2px 12px ${m.glow}` : "none",
                  } as any}>
                  {u.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Description */}
        <div style={{ ...glassCard, padding: "20px 22px" }}>
          <label style={labelStyle}>Impact Description</label>
          <textarea value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={4} required
            placeholder="Describe the beneficial action. The AI analyzes this for impact scoring…"
            style={{
              ...inputStyle,
              resize: "none", lineHeight: 1.65,
              fontFamily: "'Plus Jakarta Sans',sans-serif",
            }}
            onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = "rgba(255,255,255,0.2)"}
            onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = "rgba(255,255,255,0.08)"}
          />
        </div>

        {/* Sliders */}
        <div style={{ ...glassCard, padding: "20px 22px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            {[
              { key: "effortHours", label: "Effort Hours", min: 0.5, max: 72, step: 0.5, unit: "h", val: form.effortHours, gradient: "linear-gradient(90deg,#7c6aff,#ff6eb4)" },
              { key: "peopleHelped", label: "People Helped", min: 1, max: 500, step: 1, unit: "", val: form.peopleHelped, gradient: "linear-gradient(90deg,#00dfb2,#7c6aff)" },
            ].map(sl => (
              <div key={sl.key}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>{sl.label}</label>
                  <span style={{
                    fontFamily: "'JetBrains Mono',monospace", fontSize: "13px", fontWeight: 700,
                    background: sl.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                  }}>{sl.val}{sl.unit}</span>
                </div>
                <input type="range" min={sl.min} max={sl.max} step={sl.step}
                  value={sl.val}
                  onChange={e => setForm(f => ({ ...f, [sl.key]: Number(e.target.value) }))}
                  style={{ width: "100%", accentColor: "#00dfb2", cursor: "pointer" }} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                  <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono',monospace" }}>{sl.min}{sl.unit}</span>
                  <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono',monospace" }}>{sl.max}{sl.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* GPS */}
        <div style={{ ...glassCard, padding: "20px 22px" }}>
          <label style={labelStyle}>GPS Coordinates</label>
          <div style={{ display: "flex", gap: "8px" }}>
            {[
              { ph: "Latitude", key: "latitude", val: form.latitude },
              { ph: "Longitude", key: "longitude", val: form.longitude },
            ].map(inp => (
              <input key={inp.key} type="number" placeholder={inp.ph} step="any"
                value={inp.val || ""}
                onChange={e => setForm(f => ({ ...f, [inp.key]: Number(e.target.value) }))}
                style={{ ...inputStyle, fontFamily: "'JetBrains Mono',monospace", fontSize: "12px" }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.2)"}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"}
              />
            ))}
            <button type="button"
              onClick={() => navigator.geolocation.getCurrentPosition(
                p => setForm(f => ({ ...f, latitude: p.coords.latitude, longitude: p.coords.longitude })),
                () => setError("Could not get location.")
              )}
              style={{
                padding: "11px 14px", borderRadius: "10px", flexShrink: 0,
                background: "rgba(0,223,178,0.06)", border: "1px solid rgba(0,223,178,0.15)",
                fontFamily: "'Plus Jakarta Sans',sans-serif",
                fontSize: "12px", color: "#00dfb2",
                cursor: "pointer", whiteSpace: "nowrap" as const, fontWeight: 600,
                transition: "all 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,223,178,0.1)"}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,223,178,0.06)"}
            >
              📍 Auto
            </button>
          </div>
        </div>

        {/* Evidence Capture — Camera vs Gallery */}
        <div style={{ ...glassCard, overflow: "hidden" }}>
          <div style={{ padding: "16px 22px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <label style={labelStyle}>Evidence Photo</label>
            <div style={{ display: "flex", gap: "8px" }}>
              {/* Live Camera */}
              <button type="button" onClick={openCamera} disabled={busy}
                style={{
                  flex: 1, padding: "11px 10px", borderRadius: "10px",
                  background: captureMode === "camera" ? "rgba(0,223,178,0.08)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${captureMode === "camera" ? "rgba(0,223,178,0.3)" : "rgba(255,255,255,0.08)"}`,
                  color: captureMode === "camera" ? "#00dfb2" : "rgba(255,255,255,0.5)",
                  fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: "12px", fontWeight: 700,
                  cursor: "pointer", transition: "all 0.15s",
                }}>
                📷 Kamera Langsung
                <span style={{ display: "block", fontSize: "9px", fontWeight: 400, opacity: 0.6, marginTop: "2px" }}>Skor autentisitas +bonus</span>
              </button>
              {/* Gallery Upload */}
              <button type="button" onClick={selectGallery} disabled={busy}
                style={{
                  flex: 1, padding: "11px 10px", borderRadius: "10px",
                  background: captureMode === "gallery" ? "rgba(255,189,89,0.07)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${captureMode === "gallery" ? "rgba(255,189,89,0.3)" : "rgba(255,255,255,0.08)"}`,
                  color: captureMode === "gallery" ? "#ffbd59" : "rgba(255,255,255,0.4)",
                  fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: "12px", fontWeight: 600,
                  cursor: "pointer", transition: "all 0.15s", position: "relative" as const,
                }}>
                📁 Upload Galeri
                <span style={{
                  display: "block", fontSize: "9px", fontWeight: 400,
                  opacity: 0.6, marginTop: "2px", color: "rgba(255,189,89,0.7)",
                }}>Skor autentisitas −15%</span>
              </button>
            </div>
          </div>


          {/* Live Camera Stream */}
          {cameraActive && (
            <div style={{ padding: "0 16px 16px" }}>
              <div style={{ position: "relative" as const, borderRadius: "12px", overflow: "hidden", background: "#000" }}>
                <video ref={videoRef} autoPlay playsInline muted
                  style={{ width: "100%", display: "block", maxHeight: "260px", objectFit: "cover" }} />
                <div style={{
                  position: "absolute" as const, bottom: "10px", left: "50%",
                  transform: "translateX(-50%)", display: "flex", gap: "10px",
                }}>
                  <button type="button" onClick={capturePhoto}
                    style={{
                      padding: "10px 24px", borderRadius: "50px", border: "none",
                      background: "linear-gradient(135deg,#00dfb2,#7c6aff)",
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                      fontWeight: 800, fontSize: "13px", color: "#0a0510",
                      cursor: "pointer", boxShadow: "0 4px 16px rgba(0,223,178,0.4)",
                    }}>📸 Ambil Foto</button>
                  <button type="button" onClick={() => { stopCamera(); setCaptureMode(null); }}
                    style={{
                      padding: "10px 16px", borderRadius: "50px", border: "1px solid rgba(255,80,80,0.3)",
                      background: "rgba(255,80,80,0.07)",
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                      fontWeight: 600, fontSize: "12px", color: "rgba(255,120,120,0.8)",
                      cursor: "pointer",
                    }}>✕ Batal</button>
                </div>
              </div>
            </div>
          )}

          {/* Captured / Selected file preview */}
          {file && !cameraActive && (
            <div style={{ padding: "0 16px 16px" }}>
              {/* Thumbnail */}
              {previewUrl && file.type.startsWith("image/") && (
                <div style={{
                  position: "relative", borderRadius: "12px", overflow: "hidden",
                  marginBottom: "10px",
                  border: `1px solid ${captureMode === "camera" ? "rgba(0,223,178,0.2)" : "rgba(255,189,89,0.2)"
                    }`,
                }}>
                  <img
                    src={previewUrl}
                    alt="Evidence preview"
                    style={{ width: "100%", maxHeight: "260px", objectFit: "cover", display: "block" }}
                  />
                  {/* Source badge overlay */}
                  <div style={{
                    position: "absolute", top: "10px", left: "10px",
                    padding: "4px 10px", borderRadius: "20px",
                    background: captureMode === "camera"
                      ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.55)",
                    backdropFilter: "blur(8px)",
                    border: `1px solid ${captureMode === "camera" ? "rgba(0,223,178,0.4)" : "rgba(255,189,89,0.4)"
                      }`,
                    fontSize: "10px", fontWeight: 700,
                    fontFamily: "'JetBrains Mono',monospace",
                    color: captureMode === "camera" ? "#00dfb2" : "#ffbd59",
                    letterSpacing: "0.06em",
                  }}>
                    {captureMode === "camera" ? "✅ LIVE CAPTURE" : "📁 GALERI"}
                  </div>
                </div>
              )}
              {/* File meta row */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: "12px",
                    background: captureMode === "camera"
                      ? "linear-gradient(90deg,#00dfb2,#7c6aff)"
                      : "linear-gradient(90deg,#ffbd59,#ff9f43)",
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
                  }}>{file.name}</p>
                  <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", marginTop: "2px" }}>
                    {(file.size / 1024).toFixed(1)} KB
                    {" · "}
                    {captureMode === "camera" ? "Bonus autentisitas aktif" : "Skor dikurangi 15%"}
                  </p>
                </div>
                <button type="button" onClick={() => { setFile(null); setCaptureMode(null); setChallenge(null); }}
                  style={{
                    padding: "5px 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)",
                    background: "transparent", color: "rgba(255,255,255,0.3)",
                    fontSize: "11px", cursor: "pointer", flexShrink: 0,
                  }}>Ganti</button>
              </div>
            </div>
          )}

          {!file && !cameraActive && (
            <div style={{ padding: "24px 22px", textAlign: "center" as const, opacity: 0.4 }}>
              <div style={{ fontSize: "24px", marginBottom: "6px" }}>📷</div>
              <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>Pilih kamera atau galeri di atas</p>
            </div>
          )}

          {/* Hidden gallery input */}
          <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: "none" }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > 20 * 1024 * 1024) { setError("File terlalu besar — max 20MB"); return; }
                setFile(f); setError("");
              }
            }} />
          {/* Hidden canvas for camera snapshot */}
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: "12px 16px", borderRadius: "10px",
            background: "rgba(255,80,80,0.05)", border: "1px solid rgba(255,80,80,0.15)",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: "11px", color: "rgba(255,120,120,0.85)", lineHeight: 1.5,
          }}>
            ✕ {error}
          </div>
        )}

        {/* Submit */}
        <button type="submit" disabled={busy || !form.description}
          style={{
            width: "100%", padding: "15px", borderRadius: "12px", border: "none",
            background: busy || !form.description
              ? "rgba(255,255,255,0.04)"
              : "linear-gradient(135deg,#00dfb2,#7c6aff)",
            fontFamily: "'Plus Jakarta Sans',sans-serif",
            fontSize: "14px", fontWeight: 800,
            color: busy || !form.description ? "rgba(255,255,255,0.2)" : "#0a0510",
            cursor: busy || !form.description ? "not-allowed" : "pointer",
            transition: "all 0.2s", letterSpacing: "0.02em",
            boxShadow: busy || !form.description ? "none" : "0 4px 24px rgba(0,223,178,0.3)",
          }}
          onMouseEnter={e => { if (!busy && form.description) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
        >
          ✦ Submit Impact Proof
        </button>
      </form>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:0% 0%} 100%{background-position:200% 0%} }
      `}</style>
    </div>
  );
}