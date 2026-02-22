"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatUnits } from "viem";
import { REPUTATION_LEDGER_ABI, IMPACT_TOKEN_ABI } from "@/utils/abis";
import { CONTRACTS } from "@/utils/constants";
import SubmitImpactForm from "@/components/SubmitImpactForm";
import ReputationCard from "@/components/ReputationCard";
import Leaderboard from "@/components/Leaderboard";
import VaultStats from "@/components/VaultStats";
import ImpactFeed from "@/components/ImpactFeed";
import Badges from "@/components/Badges";

const TABS = [
  { id: "submit",      label: "Submit Proof",  icon: "◎" },
  { id: "profile",     label: "My Profile",    icon: "◈" },
  { id: "feed",        label: "Impact Feed",   icon: "◉" },
  { id: "badges",      label: "Badges",        icon: "◆" },
  { id: "leaderboard", label: "Leaderboard",   icon: "▲" },
] as const;

function CompactRepBadge({ address, score, goodBalance }: { address: string; score: number; goodBalance: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 rounded-2xl fade-up-1"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
          style={{ background: "var(--gold-dim)", border: "1px solid rgba(201,168,76,0.2)" }}>◈</div>
        <div>
          <p className="mono text-xs mb-0.5" style={{ color: "var(--text-3)" }}>{address.slice(0, 8)}...{address.slice(-6)}</p>
          <p className="font-semibold text-sm" style={{ color: "var(--text)" }}>
            Impact Score: <span className="num-gold">{score.toLocaleString()}</span>
          </p>
        </div>
      </div>
      <div className="text-right hidden sm:block">
        <p className="text-xs mb-0.5" style={{ color: "var(--text-3)" }}>GOOD Balance</p>
        <p className="font-bold num-green">{goodBalance}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<"submit" | "profile" | "leaderboard" | "feed" | "badges">("submit");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data: repData } = useReadContract({
    address: CONTRACTS.REPUTATION_LEDGER as `0x${string}`,
    abi: REPUTATION_LEDGER_ABI,
    functionName: "getReputation",
    args: address ? [address] : ["0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: 8_000 },
  });

  const { data: goodBalance } = useReadContract({
    address: CONTRACTS.GOOD_TOKEN as `0x${string}`,
    abi: IMPACT_TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : ["0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: 8_000 },
  });

  if (!mounted) return null;

  const reputationScore = repData ? Number((repData as any)[0]) / 100 : 0;
  const goodBalanceNum = goodBalance
    ? Number(formatUnits(goodBalance as bigint, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "0";

  return (
    <main className="min-h-screen relative" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b"
        style={{ background: "rgba(3,3,8,0.9)", borderColor: "var(--border)", backdropFilter: "blur(24px)" }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black"
              style={{ background: "linear-gradient(135deg, var(--cyan), var(--gold))", color: "#000" }}>⚡</div>
            <div>
              <span className="font-bold tracking-tight text-sm" style={{ color: "var(--text)" }}>APEX HUMANITY</span>
              <span className="mono text-xs ml-2 hidden sm:inline" style={{ color: "var(--text-3)", letterSpacing: "0.08em" }}>PoBA Protocol</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isConnected && goodBalance !== undefined && (
              <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-xl mono text-xs"
                style={{ background: "var(--gold-dim)", border: "1px solid rgba(201,168,76,0.2)", color: "var(--gold)" }}>
                <span>◈</span>
                <span>{goodBalanceNum} GOOD</span>
              </div>
            )}
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-20 pb-14 text-center fade-up">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs mono mb-7"
          style={{ border: "1px solid var(--border2)", background: "var(--cyan-dim)", color: "var(--cyan)", letterSpacing: "0.1em" }}>
          <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: "var(--cyan)" }} />
          PROOF OF BENEFICIAL ACTION · LIVE NETWORK
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold mb-5 leading-none tracking-tight" style={{ color: "var(--text)" }}>
          Kindness is <span className="shimmer-text">Capital</span>
        </h1>
        <p className="text-base max-w-xl mx-auto leading-relaxed" style={{ color: "var(--text-2)" }}>
          The world's first protocol where your most valuable asset is how many lives you've improved —
          verified by AI, rewarded on-chain.
        </p>
      </section>

      {/* Stats */}
      <VaultStats />

      {/* Connected */}
      {isConnected ? (
        <div className="max-w-7xl mx-auto px-6 pt-10 pb-24">
          <CompactRepBadge address={address!} score={reputationScore} goodBalance={goodBalanceNum} />

          {/* Tabs */}
          <div className="flex mt-8 mb-0" style={{ borderBottom: "1px solid var(--border)" }}>
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
                style={{ color: activeTab === tab.id ? "var(--text)" : "var(--text-3)" }}>
                <span style={{ fontSize: "11px", opacity: activeTab === tab.id ? 1 : 0.4 }}>{tab.icon}</span>
                {tab.label}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5"
                    style={{ background: "linear-gradient(90deg, var(--cyan), var(--gold))" }} />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="fade-up pt-8">
            {activeTab === "submit"      && <SubmitImpactForm />}
            {activeTab === "profile"     && <div className="max-w-lg"><ReputationCard address={address!} reputationScore={reputationScore} /></div>}
            {activeTab === "feed"        && <ImpactFeed />}
            {activeTab === "badges"      && <Badges address={address!} />}
            {activeTab === "leaderboard" && <Leaderboard />}
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-6 py-20 text-center fade-up-2">
          <div className="max-w-sm mx-auto rounded-2xl p-10"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center text-2xl"
              style={{ background: "var(--surface2)", border: "1px solid var(--border2)" }}>◈</div>
            <h3 className="font-bold text-lg mb-2" style={{ color: "var(--text)" }}>Connect Wallet</h3>
            <p className="text-sm mb-7 leading-relaxed" style={{ color: "var(--text-2)" }}>
              Connect your Ethereum wallet to submit impact proofs and build Reputation Capital.
            </p>
            <ConnectButton />
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t py-8 text-center" style={{ borderColor: "var(--border)" }}>
        <p className="mono text-xs" style={{ color: "var(--text-3)", letterSpacing: "0.06em" }}>
          APEX HUMANITY PROTOCOL · SATIN ORACLE · ZKP-PROTECTED
        </p>
      </footer>
    </main>
  );
}