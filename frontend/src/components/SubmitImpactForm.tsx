"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { pad } from "viem";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";

const ORACLE_URL = process.env.NEXT_PUBLIC_ORACLE_URL || "http://localhost:8000";
const ORACLE_KEY = process.env.NEXT_PUBLIC_SATIN_API_KEY || "apex-dev-key";

type Step = "form" | "uploading" | "oracle" | "onchain" | "success";
type CaptureMode = "camera" | "gallery" | null;

// ── What the AI deduced — shown to user for transparency ──────────────────────
interface AIDeduced {
  action_type:      string;
  urgency_level:    string;
  people_helped:    number;
  effort_hours:     number;
  confidence:       number;
  scene_context:    string;
  yolo_person_count: number;
  fraud_indicators: string[];
  reasoning:        string;
}

const STEPS = [
  { key: "uploading", label: "Preparing Evidence", icon: "◫" },
  { key: "oracle",    label: "AI Analysis",         icon: "◉" },
  { key: "onchain",  label: "On-chain Record",      icon: "☍" },
];

const ACTION_LABELS: Record<string, string> = {
  FOOD_DISTRIBUTION:    "🍱 Distribusi Makanan",
  MEDICAL_AID:          "🏥 Bantuan Medis",
  SHELTER_CONSTRUCTION: "🏠 Konstruksi Shelter",
  EDUCATION_SESSION:    "📚 Sesi Edukasi",
  DISASTER_RELIEF:      "🚨 Tanggap Bencana",
  CLEAN_WATER_PROJECT:  "💧 Air Bersih",
  MENTAL_HEALTH_SUPPORT:"🧠 Kesehatan Mental",
  ENVIRONMENTAL_ACTION: "🌱 Lingkungan",
};

const URGENCY_COLORS: Record<string, string> = {
  CRITICAL: "#ff4d4d",
  HIGH:     "#ff8c42",
  MEDIUM:   "#ffbd59",
  LOW:      "#00dfb2",
};

// ── Styles ────────────────────────────────────────────────────────────────────
const glassCard: React.CSSProperties = {
  borderRadius: "18px",
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(255,255,255,0.025)",
  overflow: "hidden",
};

const monoLabel: React.CSSProperties = {
  fontSize: "9px",
  color: "rgba(255,255,255,0.3)",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
};

export default function SubmitImpactForm() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const fileRef  = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef= useRef<HTMLCanvasElement>(null);
  const streamRef= useRef<MediaStream | null>(null);

  const [file, setFile]               = useState<File | null>(null);
  const [step, setStep]               = useState<Step>("form");
  const [txHash, setTxHash]           = useState("");
  const [oracle, setOracle]           = useState<any>(null);
  const [error, setError]             = useState("");
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [captureTimestamp, setCaptureTimestamp] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [description, setDescription] = useState("");
  const [gps, setGps]                 = useState({ latitude: 0, longitude: 0 });
  const [pendingReview, setPendingReview] = useState(false);
  const [checkingPending, setCheckingPending] = useState(true);

  const { writeContractAsync } = useWriteContract();
  const busy    = step !== "form";
  const stepIdx = STEPS.findIndex(s => s.key === step);

  // ── Check pending review ────────────────────────────────────────────────────
  const checkPendingReview = useCallback(async () => {
    if (!address) { setCheckingPending(false); return; }
    setCheckingPending(true);
    try {
      const res  = await fetch(`${ORACLE_URL}/api/v1/stream`, {
        headers: { "X-APEX-Oracle-Key": ORACLE_KEY },
      });
      const data = await res.json();
      const hasPending = data?.items?.some((item: any) =>
        item.volunteer_address?.toLowerCase() === address.toLowerCase() &&
        item.needs_community_review &&
        (!item.vote_info || item.vote_info.outcome === null)
      ) || false;
      setPendingReview(hasPending);
    } catch {}
    finally { setCheckingPending(false); }
  }, [address]);

  useEffect(() => { checkPendingReview(); }, [checkPendingReview]);

  // ── Camera ──────────────────────────────────────────────────────────────────
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current)
      videoRef.current.srcObject = streamRef.current;
  }, [cameraActive]);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fileRef.current?.setAttribute("accept", "image/*");
      fileRef.current?.setAttribute("capture", "environment");
      fileRef.current?.click();
      setCaptureMode("camera");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setCaptureMode("camera");
      setCameraActive(true);
      setFile(null);
    } catch {
      setError("Tidak dapat mengakses kamera.");
    }
  };

  const capturePhoto = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const now   = Date.now();
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    // Invisible timestamp watermark
    const ts    = new Date(now).toISOString();
    const fs    = Math.max(10, Math.floor(canvas.width * 0.012));
    ctx.font    = `${fs}px monospace`;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle   = "#fff";
    ctx.textAlign   = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`APEX:${ts}`, canvas.width - 8, canvas.height - 6);
    ctx.globalAlpha = 1.0;
    canvas.toBlob(blob => {
      if (!blob) return;
      const captured = new File([blob], `apex-${now}.jpg`, { type: "image/jpeg" });
      setCaptureTimestamp(now);
      setFile(captured);
      setError("");
      stopCamera();
    }, "image/jpeg", 0.92);
  };

  const selectGallery = () => {
    stopCamera();
    setCaptureMode("gallery");
    fileRef.current?.setAttribute("accept", "image/*,video/*");
    fileRef.current?.removeAttribute("capture");
    fileRef.current?.click();
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const sha256Hex = async (buf: ArrayBuffer): Promise<string> => {
    if (window.crypto?.subtle) {
      try {
        const d = await crypto.subtle.digest("SHA-256", buf);
        return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2,"0")).join("");
      } catch {}
    }
    const v = new Uint8Array(buf);
    let h = 0x811c9dc5;
    for (let i = 0; i < v.length; i++) { h ^= v[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8,"0").repeat(8);
  };

  const resizeImageToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { naturalWidth: w, naturalHeight: h } = img;
        const MAX = 1024;
        if (w > MAX || h > MAX) { const r = Math.min(MAX/w, MAX/h); w=Math.round(w*r); h=Math.round(h*r); }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.drawImage(img, 0, 0, w, h);
        let q = 0.82;
        const tryCompress = () => {
          const d  = canvas.toDataURL("image/jpeg", q);
          const b64 = d.split(",")[1];
          if ((b64.length * 0.75 / 1024) <= 500 || q < 0.4) resolve(b64);
          else { q -= 0.1; tryCompress(); }
        };
        tryCompress();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.onerror = () => reject(new Error("Failed to read file"));
        r.readAsDataURL(file);
      };
      img.src = url;
    });

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const source = captureMode === "camera" ? "live_capture" : "gallery";

    try {
      setStep("uploading");
      let hash_sha256 = "0".repeat(64);
      let cid         = "text-only-submission";

      if (file) {
        const buf    = await file.arrayBuffer();
        hash_sha256  = await sha256Hex(buf);
        cid          = `sha256://${hash_sha256}`;
      }

      setStep("oracle");
      let image_base64: string | null = null;
      if (file) image_base64 = await resizeImageToBase64(file);

      // v2.0 — Request sangat simpel: hanya deskripsi + GPS + foto
      // TIDAK ada action_type, urgency, effort_hours, people_helped dari user
      const resp = await fetch(`${ORACLE_URL}/api/v1/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-APEX-Oracle-Key": ORACLE_KEY },
        body: JSON.stringify({
          description:         description,
          gps:                 { latitude: gps.latitude, longitude: gps.longitude, accuracy_meters: 10 },
          volunteer_address:   address,
          beneficiary_address: address,
          hash_sha256,
          ipfs_cid:            cid,
          evidence_type:       file ? "image" : "text",
          source,
          capture_timestamp:   captureTimestamp ?? null,
          image_base64,
          country_iso:         "ID",
        }),
      });

      if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail || "Oracle failed"); }
      const real = await resp.json();
      setOracle(real);

      setStep("onchain");
      if (real.needs_community_review) {
        setTxHash("");
        setStep("success");
        stopCamera();
        return;
      }

      const ca = real.contract_args;
      if (!address || !CONTRACTS.BENEVOLENCE_VAULT) throw new Error("Wallet not connected");

      const hash = await writeContractAsync({
        address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
        abi: BENEVOLENCE_VAULT_ABI,
        functionName: "releaseReward",
        args: [
          pad(`0x${real.event_id.replace(/-/g, "")}` as `0x${string}`, { size: 32 }),
          address as `0x${string}`,
          (ca.beneficiaryAddress ?? address) as `0x${string}`,
          BigInt(ca.impactScoreScaled),
          BigInt(ca.tokenRewardWei),
          pad(`0x${real.zk_proof_hash.replace("0x", "")}` as `0x${string}`, { size: 32 }),
          pad(`0x${real.event_hash.replace("0x", "")}` as `0x${string}`, { size: 32 }),
          real.nonce,
          BigInt(real.expires_at),
          Number(real.signature.v),
          real.signature.r as `0x${string}`,
          real.signature.s as `0x${string}`,
        ],
        gas: 800000n,
      });

      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted.");
      }

      setTxHash(hash);
      setStep("success");
      stopCamera();

    } catch (err: any) {
      setError(err.message || "Transaction failed");
      setStep("form");
      checkPendingReview();
    }
  };

  // ── UI Helpers ───────────────────────────────────────────────────────────────
  const isCommunityReview = step === "success" && !txHash;
  const deduced: AIDeduced | null = oracle?.ai_deduced || null;

  /* ────────────────────────────────────────────────────────────────────────── */
  /* SUCCESS SCREEN                                                             */
  /* ────────────────────────────────────────────────────────────────────────── */
  if (step === "success") return (
    <div style={{ maxWidth: "480px" }}>
      <div style={{ ...glassCard, position: "relative" }}>
        <div style={{
          height: "2px",
          background: isCommunityReview
            ? "linear-gradient(90deg,#ffbd59,#ff6eb4)"
            : "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59)"
        }} />
        <div style={{ padding: "40px 32px", display: "flex", flexDirection: "column", gap: "20px", alignItems: "center", textAlign: "center" }}>
          {/* Icon */}
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: isCommunityReview ? "rgba(255,189,89,0.1)" : "rgba(0,223,178,0.1)",
            border: `1px solid ${isCommunityReview ? "rgba(255,189,89,0.25)" : "rgba(0,223,178,0.2)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24, color: isCommunityReview ? "#ffbd59" : "#00dfb2",
          }}>
            {isCommunityReview ? "⌬" : "✓"}
          </div>

          <div>
            <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: 20, color: "#fff", marginBottom: 8 }}>
              {isCommunityReview ? "Menunggu Verifikasi Komunitas" : "Impact Verified!"}
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
              {isCommunityReview
                ? "AI SATIN kurang yakin dengan bukti ini. Submission masuk Community Stream untuk divoting."
                : "Tindakanmu telah diverifikasi AI dan dicatat di Reputation Ledger."}
            </p>
          </div>

          {/* Score breakdown */}
          {oracle && !isCommunityReview && (
            <div style={{ width: "100%", ...glassCard }}>
              <div style={{ height: 1, background: "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59)" }} />
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "Impact Score", value: `${oracle.impact_score?.toFixed(1)}/100`, g: "linear-gradient(90deg,#00dfb2,#7c6aff)" },
                  { label: "AI Confidence", value: `${((oracle.ai_confidence||0)*100).toFixed(1)}%`, g: "linear-gradient(90deg,#7c6aff,#ff6eb4)" },
                  { label: "APEX Earned", value: `${oracle.token_reward?.toFixed(2)} APEX`, g: "linear-gradient(90deg,#ffbd59,#ff6eb4)" },
                ].map(s => (
                  <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ ...monoLabel }}>{s.label}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, background: s.g, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Deduction reveal — transparent to user */}
          {deduced && (
            <div style={{ width: "100%", borderRadius: 12, background: "rgba(124,106,255,0.04)", border: "1px solid rgba(124,106,255,0.15)", overflow: "hidden" }}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(124,106,255,0.1)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "rgba(124,106,255,0.7)", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: "0.1em" }}>
                  ◉ AI DEDUCTION REPORT
                </span>
              </div>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                <AIDeductedRow label="Action Type" value={ACTION_LABELS[deduced.action_type] || deduced.action_type} />
                <AIDeductedRow label="Urgency" value={deduced.urgency_level} color={URGENCY_COLORS[deduced.urgency_level]} />
                <AIDeductedRow label="People Helped" value={`${deduced.people_helped} orang`} />
                <AIDeductedRow label="Effort" value={`${deduced.effort_hours}h`} />
                <AIDeductedRow label="YOLO Count" value={`${deduced.yolo_person_count} terlihat di foto`} />
                <AIDeductedRow label="Confidence" value={`${(deduced.confidence * 100).toFixed(0)}%`} />
                {deduced.scene_context && (
                  <div style={{ marginTop: 4, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <p style={{ ...monoLabel, marginBottom: 4 }}>AI Scene Analysis</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                      {deduced.scene_context}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {txHash && (
            <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "rgba(124,106,255,0.4)" }}>
              TX: {txHash.slice(0,14)}…{txHash.slice(-8)}
            </p>
          )}

          <button
            onClick={() => { setStep("form"); setFile(null); setOracle(null); setTxHash(""); setCaptureMode(null); setCaptureTimestamp(null); setDescription(""); checkPendingReview(); }}
            style={{
              width: "100%", padding: "14px", borderRadius: 12, border: "none",
              background: "linear-gradient(135deg,#00dfb2,#7c6aff)",
              fontFamily: "'Plus Jakarta Sans',sans-serif",
              fontSize: 14, fontWeight: 800, color: "#0a0510",
              cursor: "pointer", boxShadow: "0 4px 20px rgba(0,223,178,0.25)",
            }}>
            Submit Another Proof →
          </button>
        </div>
      </div>
    </div>
  );

  /* ────────────────────────────────────────────────────────────────────────── */
  /* PROCESSING SCREEN                                                          */
  /* ────────────────────────────────────────────────────────────────────────── */
  if (busy) return (
    <div style={{ maxWidth: "480px" }}>
      <div style={{ ...glassCard }}>
        <div style={{ height: "2px", background: "linear-gradient(90deg,#00dfb2,#7c6aff,#ffbd59,#ff6eb4)", backgroundSize: "200% 100%", animation: "shimmer 2s linear infinite" }} />
        <div style={{ padding: "40px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: 20, color: "#fff", marginBottom: 6 }}>
              {step === "oracle" ? "AI sedang menganalisis..." : "Memproses..."}
            </p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
              {step === "oracle" ? "YOLOv8m + LLaVA membaca fotomu" : "Please keep this tab open"}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {STEPS.map((s, i) => {
              const done   = stepIdx > i;
              const active = stepIdx === i;
              return (
                <div key={s.key} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 16px", borderRadius: 12,
                  background: active ? "rgba(124,106,255,0.06)" : done ? "rgba(0,223,178,0.03)" : "rgba(255,255,255,0.01)",
                  border: `1px solid ${active ? "rgba(124,106,255,0.2)" : done ? "rgba(0,223,178,0.1)" : "rgba(255,255,255,0.04)"}`,
                  transition: "all 0.3s",
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                    background: done ? "rgba(0,223,178,0.1)" : active ? "rgba(124,106,255,0.1)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${done ? "rgba(0,223,178,0.2)" : active ? "rgba(124,106,255,0.25)" : "rgba(255,255,255,0.05)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                    color: done ? "#00dfb2" : active ? "#7c6aff" : "rgba(255,255,255,0.2)",
                  }}>
                    {done ? "✓" : active ? <span style={{ animation: "spin 1s linear infinite", display: "block" }}>⟳</span> : s.icon}
                  </div>
                  <div>
                    <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: 13, color: done || active ? "#fff" : "rgba(255,255,255,0.25)" }}>{s.label}</p>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>
                      {done ? "COMPLETE" : active ? "IN PROGRESS" : "PENDING"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {/* AI analysis hint */}
          {step === "oracle" && (
            <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(124,106,255,0.05)", border: "1px solid rgba(124,106,255,0.12)", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>◉</span>
              <p style={{ fontSize: 11, color: "rgba(124,106,255,0.7)", lineHeight: 1.6, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                AI sedang menentukan action type, jumlah orang terbantu, durasi effort, dan tingkat urgensi secara otomatis dari fotomu.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  /* ────────────────────────────────────────────────────────────────────────── */
  /* PENDING REVIEW                                                             */
  /* ────────────────────────────────────────────────────────────────────────── */
  if (checkingPending) return <div style={{ maxWidth: 480, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "40px 0", fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 13 }}>Checking status...</div>;

  if (pendingReview) return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ ...glassCard }}>
        <div style={{ height: "2px", background: "linear-gradient(90deg,#ffbd59,#ff6eb4)" }} />
        <div style={{ padding: "40px 32px", textAlign: "center", display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(255,189,89,0.1)", border: "1px solid rgba(255,189,89,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "#ffbd59" }}>⌬</div>
          <div>
            <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: 20, color: "#fff", marginBottom: 8 }}>Submission Sedang Divoting</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>Kamu masih memiliki submission yang pending Community Review. Tunggu hingga selesai sebelum submit baru.</p>
          </div>
        </div>
      </div>
    </div>
  );

  /* ────────────────────────────────────────────────────────────────────────── */
  /* MAIN FORM — Radically simplified                                           */
  /* ────────────────────────────────────────────────────────────────────────── */
  const canSubmit = description.trim().length >= 20 && termsAccepted && !busy;

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, background: "linear-gradient(90deg,#00dfb2,#7c6aff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 6 }}>
          Submit Impact Proof v2.0 · Autonomous AI Deduction
        </p>
        <p style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: 22, color: "#fff", marginBottom: 8 }}>
          Record Your Good Deed
        </p>
        {/* AAD explanation badge */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, background: "rgba(0,223,178,0.06)", border: "1px solid rgba(0,223,178,0.15)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00dfb2", flexShrink: 0 }} />
          <p style={{ fontSize: 11, color: "rgba(0,223,178,0.8)", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
            AI otomatis menentukan kategori, urgency & jumlah orang dari fotomu
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Description — Natural language, satu-satunya input scoring */}
        <div style={{ ...glassCard, padding: "20px 22px" }}>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ ...monoLabel, display: "block", marginBottom: 6 }}>
              Ceritakan Kegiatanmu ✦ Satu-satunya input yang kamu isi
            </span>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "'Plus Jakarta Sans',sans-serif", lineHeight: 1.6 }}>
              Tulis secara natural — AI akan membaca dan menyimpulkan semua parameter secara otomatis. Tidak perlu pilih kategori atau isi slider.
            </p>
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={5}
            required
            placeholder="Contoh: 'Hari ini aku dan 5 teman membagikan 200 paket sembako kepada warga terdampak banjir di Bekasi. Kegiatan berlangsung sekitar 6 jam dari pagi hingga sore...'"
            style={{
              width: "100%", padding: "13px 16px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${description.length >= 20 ? "rgba(0,223,178,0.2)" : "rgba(255,255,255,0.08)"}`,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: 13, color: "#fff",
              outline: "none", boxSizing: "border-box" as const,
              resize: "none", lineHeight: 1.7,
              transition: "border-color 0.2s",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <p style={{ fontSize: 10, color: description.length >= 20 ? "rgba(0,223,178,0.5)" : "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono',monospace" }}>
              {description.length >= 20 ? "✓ Cukup panjang untuk dianalisis AI" : `Min 20 karakter (${description.length})`}
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono',monospace" }}>{description.length} chars</p>
          </div>
        </div>

        {/* Evidence Photo */}
        <div style={{ ...glassCard, overflow: "hidden" }}>
          <div style={{ padding: "16px 22px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ ...monoLabel, display: "block", marginBottom: 10 }}>Foto Bukti</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={openCamera} disabled={busy} style={{
                flex: 1, padding: "12px 10px", borderRadius: 10,
                background: captureMode === "camera" ? "rgba(0,223,178,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${captureMode === "camera" ? "rgba(0,223,178,0.3)" : "rgba(255,255,255,0.07)"}`,
                color: captureMode === "camera" ? "#00dfb2" : "rgba(255,255,255,0.45)",
                fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 12, fontWeight: 700,
                cursor: "pointer", transition: "all 0.15s",
              }}>
                ⦾ Kamera Langsung
                <span style={{ display: "block", fontSize: 9, fontWeight: 400, opacity: 0.6, marginTop: 2 }}>+bonus autentisitas</span>
              </button>
              <button type="button" onClick={selectGallery} disabled={busy} style={{
                flex: 1, padding: "12px 10px", borderRadius: 10,
                background: captureMode === "gallery" ? "rgba(255,189,89,0.07)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${captureMode === "gallery" ? "rgba(255,189,89,0.3)" : "rgba(255,255,255,0.07)"}`,
                color: captureMode === "gallery" ? "#ffbd59" : "rgba(255,255,255,0.35)",
                fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all 0.15s",
              }}>
                ◫ Galeri
                <span style={{ display: "block", fontSize: 9, fontWeight: 400, opacity: 0.6, marginTop: 2, color: "rgba(255,189,89,0.6)" }}>−15% autentisitas</span>
              </button>
            </div>
          </div>

          {/* Camera stream */}
          {cameraActive && (
            <div style={{ padding: "0 16px 16px" }}>
              <div style={{ position: "relative" as const, borderRadius: 12, overflow: "hidden", background: "#000", boxShadow: "0 0 0 2px rgba(0,223,178,0.2)" }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", display: "block", maxHeight: 240, objectFit: "cover" }} />
                <div style={{ position: "absolute" as const, bottom: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8 }}>
                  <button type="button" onClick={capturePhoto} style={{ padding: "9px 22px", borderRadius: 50, border: "none", background: "linear-gradient(135deg,#00dfb2,#7c6aff)", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: 13, color: "#0a0510", cursor: "pointer" }}>⦾ Ambil</button>
                  <button type="button" onClick={() => { stopCamera(); setCaptureMode(null); }} style={{ padding: "9px 14px", borderRadius: 50, border: "1px solid rgba(255,80,80,0.3)", background: "rgba(255,80,80,0.07)", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600, fontSize: 12, color: "rgba(255,120,120,0.8)", cursor: "pointer" }}>✕</button>
                </div>
              </div>
            </div>
          )}

          {/* Preview */}
          {file && !cameraActive && previewUrl && file.type.startsWith("image/") && (
            <div style={{ padding: "0 16px 16px" }}>
              <div style={{ position: "relative" as const, borderRadius: 12, overflow: "hidden", border: `1px solid ${captureMode === "camera" ? "rgba(0,223,178,0.2)" : "rgba(255,189,89,0.2)"}` }}>
                <img src={previewUrl} alt="Evidence" style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute" as const, top: 8, left: 8, padding: "3px 8px", borderRadius: 20, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", border: `1px solid ${captureMode === "camera" ? "rgba(0,223,178,0.4)" : "rgba(255,189,89,0.4)"}`, fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: captureMode === "camera" ? "#00dfb2" : "#ffbd59", letterSpacing: "0.08em" }}>
                  {captureMode === "camera" ? "✓ LIVE CAPTURE" : "◫ GALERI"}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono',monospace" }}>{(file.size/1024).toFixed(1)} KB</p>
                <button type="button" onClick={() => { setFile(null); setCaptureMode(null); }} style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.07)", background: "transparent", color: "rgba(255,255,255,0.3)", fontSize: 11, cursor: "pointer" }}>Ganti</button>
              </div>
            </div>
          )}

          {!file && !cameraActive && (
            <div style={{ padding: "20px 22px", textAlign: "center" as const, opacity: 0.35 }}>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>Pilih kamera atau galeri di atas</p>
            </div>
          )}

          <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: "none" }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > 20 * 1024 * 1024) { setError("File terlalu besar — max 20MB"); return; }
                if (captureMode === "camera") setCaptureTimestamp(Date.now());
                setFile(f); setError("");
              }
            }} />
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        {/* GPS */}
        <div style={{ ...glassCard, padding: "16px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <span style={{ ...monoLabel, display: "block", marginBottom: 4 }}>GPS Lokasi</span>
              <p style={{ fontSize: 11, color: gps.latitude ? "rgba(0,223,178,0.6)" : "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono',monospace" }}>
                {gps.latitude ? `${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}` : "Belum diset"}
              </p>
            </div>
            <button type="button"
              onClick={() => navigator.geolocation.getCurrentPosition(
                p => setGps({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
                () => setError("Tidak bisa mendapatkan lokasi.")
              )}
              style={{ padding: "9px 14px", borderRadius: 9, background: "rgba(0,223,178,0.06)", border: "1px solid rgba(0,223,178,0.15)", fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 12, color: "#00dfb2", cursor: "pointer", fontWeight: 600 }}>
              ⌖ Deteksi
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(255,80,80,0.05)", border: "1px solid rgba(255,80,80,0.15)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "rgba(255,120,120,0.85)", lineHeight: 1.5 }}>
            ✕ {error}
          </div>
        )}

        {/* Terms */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 12, background: "rgba(255,255,255,0.015)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" }}>
          <input type="checkbox" id="tnc" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} style={{ marginTop: 3, accentColor: "#7c6aff", width: 15, height: 15, cursor: "pointer", flexShrink: 0 }} />
          <label htmlFor="tnc" style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, cursor: "pointer", userSelect: "none" as const }}>
            Saya bersumpah foto dan deskripsi ini <strong>asli dan jujur</strong>. Saya mengerti bahwa manipulasi data dapat mengakibatkan{" "}
            <span style={{ color: "rgba(255,80,80,0.8)" }}>PEMBLOKIRAN PERMANEN</span> dari platform APEX.
          </label>
        </div>

        {/* Submit */}
        <button type="submit" disabled={!canSubmit}
          style={{
            width: "100%", padding: 16, borderRadius: 13, border: "none",
            background: canSubmit ? "linear-gradient(135deg,#00dfb2,#7c6aff)" : "rgba(255,255,255,0.04)",
            fontFamily: "'Plus Jakarta Sans',sans-serif",
            fontSize: 14, fontWeight: 800,
            color: canSubmit ? "#0a0510" : "rgba(255,255,255,0.15)",
            cursor: canSubmit ? "pointer" : "not-allowed",
            transition: "all 0.2s",
            boxShadow: canSubmit ? "0 4px 24px rgba(0,223,178,0.28)" : "none",
            letterSpacing: "0.02em",
          }}
          onMouseEnter={e => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
        >
          ✦ Submit Impact Proof — AI akan menganalisis fotomu
        </button>

        {/* Disclaimer */}
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center" as const, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.7 }}>
          Tidak ada slider. Tidak ada pilihan manual.<br />
          YOLOv8m + LLaVA menyimpulkan semua parameter secara objektif.
        </p>
      </form>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:0% 0%} 100%{background-position:200% 0%} }
      `}</style>
    </div>
  );
}

// ── Sub-component: AI Deduction row ──────────────────────────────────────────
function AIDeductedRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", color: color || "rgba(255,255,255,0.7)" }}>{value}</span>
    </div>
  );
}