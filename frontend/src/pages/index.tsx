"use client";

// 1. Tambahkan useEffect di sini
import { useState, useEffect } from "react"; 
import { useAccount, useReadContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatUnits } from "viem";
import { BENEVOLENCE_VAULT_ABI } from "@/utils/abis";
import { CONTRACTS } from "@/utils/constants";
import SubmitImpactForm from "@/components/SubmitImpactForm";
import ReputationCard from "@/components/ReputationCard";
import Leaderboard from "@/components/Leaderboard";
import VaultStats from "@/components/VaultStats";

export default function Home() {
  const { address, isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<"submit" | "profile" | "leaderboard">("submit");
  
  // 2. Tambahkan state mounted
  const [mounted, setMounted] = useState(false);

  // 3. Set mounted ke true setelah render pertama (hanya di client)
  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: reputation } = useReadContract({
    address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
    abi: BENEVOLENCE_VAULT_ABI,
    functionName: "getVolunteerReputation",
    // 4. Perbaiki args agar tidak melempar 'undefined' ke Viem
    args: address ? [address] : ["0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address },
  });

  const { data: vaultBalance } = useReadContract({
    address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
    abi: BENEVOLENCE_VAULT_ABI,
    functionName: "vaultBalance",
  });

  // 5. Mencegah Hydration Error: Jangan render UI sampai komponen ter-mount
  if (!mounted) return null;

  return (
    <main className="min-h-screen bg-[#050510] text-white">
      {/* Header */}
      <header className="border-b border-indigo-900/40 backdrop-blur-sm sticky top-0 z-50 bg-[#050510]/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-400 flex items-center justify-center text-lg font-bold">
              ⚡
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight">APEX HUMANITY</h1>
              <p className="text-xs text-indigo-400">Sovereign Benevolence Protocol</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {vaultBalance !== undefined && (
              <div className="hidden md:flex items-center gap-2 text-sm text-emerald-400 border border-emerald-900/40 rounded-full px-4 py-1.5">
                <span>🏦</span>
                <span>{Number(formatUnits(vaultBalance as bigint, 6)).toLocaleString()} USDC in vault</span>
              </div>
            )}
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 text-xs text-indigo-400 border border-indigo-800/40 rounded-full px-4 py-1.5 mb-6">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          Proof of Beneficial Action (PoBA) Network
        </div>
        <h2 className="text-5xl font-bold mb-4 bg-gradient-to-r from-indigo-400 via-purple-300 to-emerald-400 bg-clip-text text-transparent">
          Turn Kindness Into Capital
        </h2>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          The world's first decentralized protocol where your most valuable asset is
          how many lives you've improved. Verified by AI. Rewarded by blockchain.
        </p>
      </section>

      {/* Vault Stats Bar */}
      <VaultStats />

      {/* Main Content */}
      {isConnected ? (
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Reputation Badge */}
          {reputation !== undefined && (
            <ReputationCard
              address={address!}
              reputationScore={Number(reputation as bigint)}
            />
          )}

          {/* Tab Navigation */}
          <div className="flex gap-1 bg-gray-900/50 p-1 rounded-xl w-fit mb-8">
            {(["submit", "profile", "leaderboard"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                  activeTab === tab
                    ? "bg-indigo-600 text-white shadow"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tab === "submit" ? "📸 Submit Impact" :
                 tab === "profile" ? "👤 My Profile" : "🏆 Leaderboard"}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === "submit" && <SubmitImpactForm />}
          {activeTab === "profile" && <div className="text-gray-400">Profile coming soon...</div>}
          {activeTab === "leaderboard" && <Leaderboard />}
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-6 py-16 text-center">
          <div className="max-w-md mx-auto bg-gray-900/50 border border-gray-800 rounded-2xl p-8">
            <div className="text-4xl mb-4">🔐</div>
            <h3 className="text-xl font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-gray-400 text-sm mb-6">
              Connect your Ethereum wallet to submit impact proofs and start building your Reputation Capital.
            </p>
            <ConnectButton />
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-gray-900 mt-20 py-8 text-center text-gray-600 text-sm">
        <p>APEX HUMANITY Protocol · Building the Digital Constitution for Humanity</p>
        <p className="mt-1 text-xs">Smart Contracts audited · SATIN Oracle powered by AI · ZKP-protected identities</p>
      </footer>
    </main>
  );
}
