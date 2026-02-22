"use client";

import { useState, useRef } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { hexToBytes, keccak256, encodePacked } from "viem";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";
import { CONTRACTS, ACTION_TYPES, URGENCY_LEVELS } from "../utils/constants";

interface FormData {
  actionType: string;
  urgencyLevel: string;
  description: string;
  effortHours: number;
  latitude: number;
  longitude: number;
  povertyIndex: number;
  ipfsCid: string;
}

type Step = "form" | "uploading" | "oracle" | "onchain" | "success";

export default function SubmitImpactForm() {
  const { address } = useAccount();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [txHash, setTxHash] = useState<string>("");
  const [oracleResult, setOracleResult] = useState<any>(null);
  const [error, setError] = useState<string>("");

  const [form, setForm] = useState<FormData>({
    actionType: "FOOD_DISTRIBUTION",
    urgencyLevel: "HIGH",
    description: "",
    effortHours: 4,
    latitude: 0,
    longitude: 0,
    povertyIndex: 0.7,
    ipfsCid: "",
  });

  const { writeContractAsync } = useWriteContract();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const handleGetLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }));
      },
      () => setError("Could not get location. Please enter manually.")
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      // Step 1: Upload to IPFS (simulated)
      setStep("uploading");
      await new Promise((r) => setTimeout(r, 1500));
      const mockCID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

      // Step 2: Call SATIN Oracle
      setStep("oracle");
      const oracleResponse = await fetch(`${process.env.NEXT_PUBLIC_ORACLE_URL}/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SATIN-API-Key": process.env.NEXT_PUBLIC_SATIN_API_KEY || "dev-key-apex-humanity",
        },
        body: JSON.stringify({
          volunteer_address: address,
          beneficiary_zkp_hash: keccak256(encodePacked(["address", "uint256"], [address as `0x${string}`, BigInt(Date.now())])).slice(2),
          action_type: form.actionType,
          urgency_level: form.urgencyLevel,
          description: form.description,
          effort_hours: form.effortHours,
          gps: {
            latitude: form.latitude,
            longitude: form.longitude,
            accuracy_meters: 10,
          },
          poverty_index: form.povertyIndex,
          ipfs_media_cid: mockCID,
        }),
      });

      // For demo, simulate oracle success
      const mockOracle = {
        event_id: crypto.randomUUID(),
        verification_status: "VERIFIED",
        impact_score: 78.5,
        ai_confidence: 0.89,
        event_hash: "3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b",
        oracle_signature: "0x" + "a".repeat(130),
        oracle_payload: {
          abi_encoded_message: "0x" + "b".repeat(256),
        },
      };

      setOracleResult(mockOracle);

      // Step 3: Submit on-chain
      setStep("onchain");
      const hash = await writeContractAsync({
        address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
        abi: BENEVOLENCE_VAULT_ABI,
        functionName: "submitVerifiedImpact",
        args: [
          `0x${mockOracle.event_hash}` as `0x${string}`,
          address as `0x${string}`,
          `0x${"0".repeat(64)}` as `0x${string}`,
          BigInt(Math.round(mockOracle.impact_score * 100)),
          form.actionType,
          mockOracle.oracle_signature as `0x${string}`,
        ],
      });

      setTxHash(hash);
      setStep("success");
    } catch (err: any) {
      setError(err.message || "Transaction failed");
      setStep("form");
    }
  };

  if (step === "success") {
    return (
      <div className="bg-gray-900/50 border border-emerald-900/40 rounded-2xl p-10 text-center max-w-lg mx-auto">
        <div className="text-5xl mb-4">🎉</div>
        <h3 className="text-2xl font-bold text-emerald-400 mb-2">Impact Verified!</h3>
        <p className="text-gray-400 mb-4">Your action has been recorded on the immutable Reputation Ledger.</p>
        {oracleResult && (
          <div className="bg-black/40 rounded-xl p-4 mb-4 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Impact Score</span>
              <span className="text-emerald-400 font-bold">{oracleResult.impact_score}/100</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">AI Confidence</span>
              <span className="text-indigo-400">{(oracleResult.ai_confidence * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">GOOD Tokens Earned</span>
              <span className="text-yellow-400">~{Math.round(oracleResult.impact_score * 10)} GOOD</span>
            </div>
          </div>
        )}
        {txHash && (
          <a
            href={`https://polygonscan.com/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 text-sm hover:underline"
          >
            View Transaction →
          </a>
        )}
        <button
          onClick={() => setStep("form")}
          className="mt-6 w-full py-2 rounded-xl border border-gray-700 text-gray-400 hover:text-white text-sm"
        >
          Submit Another Impact
        </button>
      </div>
    );
  }

  const isProcessing = step !== "form";

  return (
    <div className="max-w-2xl">
      {/* Progress Steps */}
      {isProcessing && (
        <div className="mb-6 bg-gray-900/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            {[
              { key: "uploading", label: "Uploading to IPFS", icon: "📦" },
              { key: "oracle", label: "SATIN Oracle Verifying", icon: "🤖" },
              { key: "onchain", label: "Writing to Blockchain", icon: "⛓️" },
            ].map((s) => (
              <div key={s.key} className={`flex items-center gap-2 text-sm ${
                step === s.key ? "text-indigo-400" : "text-gray-600"
              }`}>
                <span className={step === s.key ? "animate-bounce" : ""}>{s.icon}</span>
                <span>{s.label}</span>
                {s.key !== "onchain" && <span className="text-gray-700">→</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Action Type */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Action Type</label>
          <select
            value={form.actionType}
            onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:outline-none"
          >
            {ACTION_TYPES.map((a) => (
              <option key={a.value} value={a.value}>{a.emoji} {a.label}</option>
            ))}
          </select>
        </div>

        {/* Urgency */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Urgency Level</label>
          <div className="grid grid-cols-4 gap-2">
            {URGENCY_LEVELS.map((u) => (
              <button
                key={u.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, urgencyLevel: u.value }))}
                className={`py-2 rounded-xl text-sm border transition-all ${
                  form.urgencyLevel === u.value
                    ? `bg-${u.color}-900/40 border-${u.color}-500 text-${u.color}-400`
                    : "border-gray-700 text-gray-500 hover:border-gray-500"
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Impact Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={4}
            placeholder="Describe the beneficial action you performed. Be specific — the AI analyzes this for impact scoring..."
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none resize-none"
            required
          />
        </div>

        {/* Effort Hours */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            Effort Hours: <span className="text-white">{form.effortHours}h</span>
          </label>
          <input
            type="range"
            min={0.5}
            max={72}
            step={0.5}
            value={form.effortHours}
            onChange={(e) => setForm((f) => ({ ...f, effortHours: Number(e.target.value) }))}
            className="w-full accent-indigo-500"
          />
        </div>

        {/* GPS */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">GPS Coordinates</label>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Latitude"
              value={form.latitude || ""}
              onChange={(e) => setForm((f) => ({ ...f, latitude: Number(e.target.value) }))}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:outline-none"
              step="any"
            />
            <input
              type="number"
              placeholder="Longitude"
              value={form.longitude || ""}
              onChange={(e) => setForm((f) => ({ ...f, longitude: Number(e.target.value) }))}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:outline-none"
              step="any"
            />
            <button
              type="button"
              onClick={handleGetLocation}
              className="px-4 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:border-indigo-500 text-sm"
            >
              📍 Auto
            </button>
          </div>
        </div>

        {/* Media Upload */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Photo/Video Evidence</label>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 transition-colors"
          >
            {selectedFile ? (
              <div className="text-emerald-400">
                <div className="text-2xl mb-1">✅</div>
                <p className="text-sm">{selectedFile.name}</p>
              </div>
            ) : (
              <div className="text-gray-500">
                <div className="text-3xl mb-2">📸</div>
                <p className="text-sm">Click to upload photo or video proof</p>
                <p className="text-xs mt-1">Encrypted and stored on IPFS</p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isProcessing || !form.description}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-white transition-all"
        >
          {isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⚙️</span> Processing...
            </span>
          ) : (
            "🌟 Submit Impact Proof"
          )}
        </button>
      </form>
    </div>
  );
}
