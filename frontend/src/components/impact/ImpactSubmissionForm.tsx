"use client";

/**
 * APEX HUMANITY — Impact Submission Form
 * Allows volunteers to submit Proof of Beneficial Action evidence
 * for SATIN Oracle verification and on-chain reward distribution.
 */

import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload, MapPin, Users, FileText, CheckCircle,
  Loader2, AlertCircle, Zap
} from "lucide-react";

const ACTION_TYPES = [
  { value: "food_distribution",    label: "🍚 Food Distribution" },
  { value: "medical_aid",          label: "🏥 Medical Aid" },
  { value: "disaster_relief",      label: "🆘 Disaster Relief" },
  { value: "education",            label: "📚 Education" },
  { value: "shelter",              label: "🏠 Shelter" },
  { value: "clean_water",          label: "💧 Clean Water" },
  { value: "environmental",        label: "🌱 Environmental" },
  { value: "mental_health",        label: "💙 Mental Health" },
  { value: "economic_empowerment", label: "💼 Economic Empowerment" },
];

type Step = "form" | "uploading" | "verifying" | "success" | "error";

interface FormData {
  actionType: string;
  description: string;
  peopleHelped: number;
  files: File[];
  lat: number;
  lng: number;
  countryIso: string;
  beneficiaryAddress: string;
}

export default function ImpactSubmissionForm() {
  const [step, setStep] = useState<Step>("form");
  const [formData, setFormData] = useState<Partial<FormData>>({
    actionType: "",
    description: "",
    peopleHelped: 1,
    files: [],
    countryIso: "DEFAULT",
  });
  const [oracleResult, setOracleResult] = useState<any>(null);
  const [error, setError] = useState<string>("");

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFormData((f) => ({ ...f, files: [...(f.files || []), ...acceptedFiles] }));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [], "video/*": [] },
    maxFiles: 5,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep("uploading");

    try {
      // Step 1: Upload to IPFS (mock)
      await new Promise((r) => setTimeout(r, 1500));
      const mockCid = "QmXyZ9f3k1n" + Math.random().toString(36).slice(2, 12);

      setStep("verifying");

      // Step 2: Submit to SATIN Oracle
      const response = await fetch("http://localhost:8000/api/v1/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-APEX-Oracle-Key": "apex-dev-key-change-in-prod",
        },
        body: JSON.stringify({
          ipfs_cid:            mockCid,
          evidence_type:       "image",
          hash_sha256:         "a".repeat(64),
          gps: {
            latitude:        formData.lat || 0,
            longitude:       formData.lng || 0,
            accuracy_meters: 8.5,
          },
          action_type:         formData.actionType,
          people_helped:       formData.peopleHelped,
          volunteer_address:   "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
          beneficiary_address: formData.beneficiaryAddress || "0xDeadBeef0000000000000000000000000000cafe",
          country_iso:         formData.countryIso,
          description:         formData.description,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Oracle verification failed");
      }

      const result = await response.json();
      setOracleResult(result);

      // Step 3: Submit to BenevolenceVault (via wagmi writeContract in production)
      await new Promise((r) => setTimeout(r, 1000));

      setStep("success");
    } catch (err: any) {
      setError(err.message || "Submission failed. Please try again.");
      setStep("error");
    }
  };

  // ── Render Steps ──────────────────────────────────────────────────────────

  if (step === "uploading") return <LoadingState message="Uploading evidence to IPFS..." icon="upload" />;
  if (step === "verifying") return <LoadingState message="SATIN Oracle is verifying your impact..." icon="ai" />;

  if (step === "success" && oracleResult) {
    return (
      <div className="max-w-lg mx-auto bg-gray-900 border border-emerald-800 rounded-2xl p-8 text-center">
        <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
        <h2 className="text-white text-2xl font-bold mb-2">Impact Verified! 🎉</h2>
        <p className="text-gray-400 mb-6">Your beneficial action has been verified and rewarded.</p>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-3xl font-bold text-emerald-400">{oracleResult.impact_score?.toFixed(1)}</p>
            <p className="text-gray-400 text-sm">Impact Score</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-3xl font-bold text-yellow-400">{oracleResult.token_reward?.toFixed(2)}</p>
            <p className="text-gray-400 text-sm">APEX Earned</p>
          </div>
        </div>
        <div className="text-left bg-gray-800 rounded-xl p-4 text-xs font-mono text-gray-400 space-y-1 mb-6">
          <p>Event ID: {oracleResult.event_id?.slice(0, 20)}...</p>
          <p>ZK Proof: {oracleResult.zk_proof_hash?.slice(0, 22)}...</p>
          <p>Oracle:   {oracleResult.oracle_address?.slice(0, 20)}...</p>
        </div>
        <button
          onClick={() => { setStep("form"); setOracleResult(null); }}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-all">
          Submit Another Impact
        </button>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="max-w-lg mx-auto bg-gray-900 border border-red-800 rounded-2xl p-8 text-center">
        <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
        <h2 className="text-white text-xl font-bold mb-2">Verification Failed</h2>
        <p className="text-red-400 mb-6 text-sm">{error}</p>
        <button onClick={() => setStep("form")}
          className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded-xl">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-blue-600/20 rounded-lg">
            <Zap className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-white text-xl font-bold">Submit Impact Proof</h1>
            <p className="text-gray-400 text-sm">Prove your good deed. Earn APEX tokens.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Action Type */}
          <div>
            <label className="text-gray-300 text-sm font-medium block mb-2">Action Type *</label>
            <select
              value={formData.actionType}
              onChange={(e) => setFormData((f) => ({ ...f, actionType: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:border-blue-500 outline-none"
              required>
              <option value="">Select an action type...</option>
              {ACTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* People Helped */}
          <div>
            <label className="text-gray-300 text-sm font-medium block mb-2">
              <Users className="w-4 h-4 inline mr-1" />
              Number of People Helped *
            </label>
            <input
              type="number" min={1} max={1000000}
              value={formData.peopleHelped}
              onChange={(e) => setFormData((f) => ({ ...f, peopleHelped: parseInt(e.target.value) }))}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:border-blue-500 outline-none"
              required />
          </div>

          {/* Description */}
          <div>
            <label className="text-gray-300 text-sm font-medium block mb-2">
              <FileText className="w-4 h-4 inline mr-1" />
              Impact Description * (min 50 chars)
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData((f) => ({ ...f, description: e.target.value }))}
              minLength={50}
              maxLength={2000}
              rows={4}
              placeholder="Describe what you did, how many people you helped, and what resources you provided..."
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:border-blue-500 outline-none resize-none"
              required />
            <p className="text-gray-500 text-xs mt-1">{formData.description?.length || 0}/2000</p>
          </div>

          {/* GPS */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-300 text-sm font-medium block mb-2">
                <MapPin className="w-4 h-4 inline mr-1" />Latitude *
              </label>
              <input type="number" step="any" min={-90} max={90}
                placeholder="6.369028"
                onChange={(e) => setFormData((f) => ({ ...f, lat: parseFloat(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:border-blue-500 outline-none"
                required />
            </div>
            <div>
              <label className="text-gray-300 text-sm font-medium block mb-2">Longitude *</label>
              <input type="number" step="any" min={-180} max={180}
                placeholder="34.885657"
                onChange={(e) => setFormData((f) => ({ ...f, lng: parseFloat(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:border-blue-500 outline-none"
                required />
            </div>
          </div>

          {/* Country */}
          <div>
            <label className="text-gray-300 text-sm font-medium block mb-2">Country (ISO Code)</label>
            <input
              type="text" maxLength={3} placeholder="e.g. SS, YE, HT"
              value={formData.countryIso}
              onChange={(e) => setFormData((f) => ({ ...f, countryIso: e.target.value.toUpperCase() }))}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:border-blue-500 outline-none" />
          </div>

          {/* File Upload */}
          <div>
            <label className="text-gray-300 text-sm font-medium block mb-2">
              <Upload className="w-4 h-4 inline mr-1" />
              Evidence Files (Images / Video) *
            </label>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                isDragActive
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-700 hover:border-gray-500"
              }`}>
              <input {...getInputProps()} />
              <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
              {isDragActive ? (
                <p className="text-blue-400">Drop your evidence here...</p>
              ) : (
                <>
                  <p className="text-gray-400">Drag & drop evidence, or click to select</p>
                  <p className="text-gray-600 text-xs mt-1">JPG, PNG, MP4 · Max 5 files</p>
                </>
              )}
              {(formData.files?.length ?? 0) > 0 && (
                <p className="text-emerald-400 text-sm mt-2">
                  ✓ {formData.files?.length} file(s) selected
                </p>
              )}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2">
            <Zap className="w-5 h-5" />
            Submit for Oracle Verification
          </button>
        </form>
      </div>
    </div>
  );
}

function LoadingState({ message, icon }: { message: string; icon: string }) {
  return (
    <div className="max-w-lg mx-auto bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
      <div className="relative w-20 h-20 mx-auto mb-6">
        <div className="absolute inset-0 rounded-full border-4 border-blue-600/20" />
        <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          {icon === "upload"
            ? <Upload className="w-7 h-7 text-blue-400" />
            : <Zap className="w-7 h-7 text-purple-400" />}
        </div>
      </div>
      <p className="text-white font-semibold text-lg">{message}</p>
      <p className="text-gray-400 text-sm mt-2">
        {icon === "ai"
          ? "SATIN AI is running computer vision, NLP analysis, and ZK-proof generation..."
          : "Encrypting and uploading to IPFS..."}
      </p>
    </div>
  );
}
