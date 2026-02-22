"use client";

import React, { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import {
  Globe,
  Award,
  TrendingUp,
  Users,
  Zap,
  ShieldCheck,
  Upload,
  BarChart3,
} from "lucide-react";

// ── Mock contract data (replace with actual wagmi hooks) ──────────────────────
const MOCK_STATS = {
  totalParticipants:   12847,
  totalEventsVerified: 94_301,
  totalTokensDistrib:  "8,241,750",
  avgImpactScore:      71.4,
};

const MOCK_LEADERBOARD = [
  { rank: 1, address: "0xAbCd...1234", score: 94850, events: 312, country: "🇸🇸 South Sudan" },
  { rank: 2, address: "0xDeEf...5678", score: 87220, events: 278, country: "🇾🇪 Yemen" },
  { rank: 3, address: "0xF012...9abc", score: 81400, events: 241, country: "🇭🇹 Haiti" },
  { rank: 4, address: "0x3456...def0", score: 74500, events: 199, country: "🇦🇫 Afghanistan" },
  { rank: 5, address: "0x789a...bcde", score: 68900, events: 187, country: "🇸🇴 Somalia" },
];

const MOCK_RECENT_EVENTS = [
  { id: 1, action: "Food Distribution",    score: 87.4, reward: 87.4,  volunteer: "0xAbCd...1234", people: 250, time: "2m ago" },
  { id: 2, action: "Medical Aid",          score: 91.2, reward: 91.2,  volunteer: "0xDeEf...5678", people: 18,  time: "14m ago" },
  { id: 3, action: "Clean Water",          score: 78.8, reward: 78.8,  volunteer: "0xF012...9abc", people: 500, time: "1h ago" },
  { id: 4, action: "Disaster Relief",      score: 95.0, reward: 95.0,  volunteer: "0x3456...def0", people: 80,  time: "2h ago" },
  { id: 5, action: "Education",            score: 65.3, reward: 65.3,  volunteer: "0x789a...bcde", people: 35,  time: "3h ago" },
];

// ── Sub-Components ─────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string | number; color: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex items-center gap-4 hover:border-gray-600 transition-all">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-gray-400 text-sm">{label}</p>
        <p className="text-white text-2xl font-bold">{value}</p>
      </div>
    </div>
  );
}

function ImpactScoreBadge({ score }: { score: number }) {
  const color =
    score >= 85 ? "text-emerald-400 bg-emerald-400/10" :
    score >= 70 ? "text-yellow-400 bg-yellow-400/10" :
                  "text-orange-400 bg-orange-400/10";
  return (
    <span className={`text-xs font-bold px-2 py-1 rounded-full ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

function LeaderboardTable() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
        <Award className="w-5 h-5 text-yellow-400" />
        Global Reputation Leaderboard
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-800">
              <th className="text-left pb-3">Rank</th>
              <th className="text-left pb-3">Volunteer</th>
              <th className="text-left pb-3">Location</th>
              <th className="text-right pb-3">Score</th>
              <th className="text-right pb-3">Events</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_LEADERBOARD.map((entry) => (
              <tr key={entry.rank} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-3">
                  <span className={`font-bold ${
                    entry.rank === 1 ? "text-yellow-400" :
                    entry.rank === 2 ? "text-gray-300" :
                    entry.rank === 3 ? "text-orange-400" : "text-gray-500"
                  }`}>#{entry.rank}</span>
                </td>
                <td className="py-3 text-gray-300 font-mono">{entry.address}</td>
                <td className="py-3 text-gray-400">{entry.country}</td>
                <td className="py-3 text-right">
                  <ImpactScoreBadge score={entry.score / 1000} />
                </td>
                <td className="py-3 text-right text-gray-300">{entry.events}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecentEvents() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
        <Zap className="w-5 h-5 text-blue-400" />
        Live Verified Events
      </h2>
      <div className="space-y-3">
        {MOCK_RECENT_EVENTS.map((event) => (
          <div key={event.id}
            className="flex items-center justify-between p-3 bg-gray-800/50 rounded-xl hover:bg-gray-800 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <div>
                <p className="text-white text-sm font-medium">{event.action}</p>
                <p className="text-gray-400 text-xs">
                  {event.volunteer} · {event.people} people · {event.time}
                </p>
              </div>
            </div>
            <div className="text-right">
              <ImpactScoreBadge score={event.score} />
              <p className="text-gray-400 text-xs mt-1">+{event.reward} APEX</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MyProfile({ address }: { address?: string }) {
  if (!address) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
        <ShieldCheck className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-400">Connect your wallet to view your Sovereign Profile</p>
      </div>
    );
  }
  return (
    <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 border border-blue-800/50 rounded-2xl p-6">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
          <ShieldCheck className="w-7 h-7 text-white" />
        </div>
        <div>
          <p className="text-white font-bold">SovereignID #4201</p>
          <p className="text-gray-400 text-sm font-mono">{address.slice(0,6)}...{address.slice(-4)}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: "Impact Score", value: "7,842" },
          { label: "Events", value: "23" },
          { label: "APEX Earned", value: "2,104" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-black/30 rounded-xl p-3">
            <p className="text-white font-bold text-lg">{value}</p>
            <p className="text-gray-400 text-xs">{label}</p>
          </div>
        ))}
      </div>
      <button className="mt-4 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-all">
        <Upload className="w-4 h-4" />
        Submit New Impact Proof
      </button>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const [liveCount, setLiveCount] = useState(MOCK_STATS.totalEventsVerified);

  // Simulate live counter
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveCount((c) => c + Math.floor(Math.random() * 3));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-none">APEX HUMANITY</h1>
            <p className="text-gray-500 text-xs">Sovereign Benevolence Protocol</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isConnected ? (
            <div className="flex items-center gap-2 bg-emerald-900/30 border border-emerald-800 px-3 py-2 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-emerald-300 text-sm font-mono">
                {address?.slice(0,6)}...{address?.slice(-4)}
              </span>
            </div>
          ) : (
            <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all">
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-blue-900/20 via-purple-900/20 to-blue-900/20 border-b border-gray-800 px-6 py-8 text-center">
        <p className="text-gray-400 text-sm mb-2 uppercase tracking-widest">Proof of Beneficial Action</p>
        <h2 className="text-3xl font-bold text-white mb-2">
          Where{" "}
          <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Kindness
          </span>{" "}
          is Capital
        </h2>
        <p className="text-gray-400 max-w-xl mx-auto text-sm">
          Every verified good deed is rewarded on-chain. The world's most valuable person
          is the one who has helped the most people — not the one with the most gold.
        </p>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={Users}    label="Verified Volunteers"   value={MOCK_STATS.totalParticipants.toLocaleString()} color="bg-blue-600" />
          <StatCard icon={Zap}      label="Events Verified"        value={liveCount.toLocaleString()} color="bg-purple-600" />
          <StatCard icon={TrendingUp} label="APEX Tokens Issued"  value={MOCK_STATS.totalTokensDistrib} color="bg-emerald-600" />
          <StatCard icon={BarChart3} label="Avg Impact Score"      value={MOCK_STATS.avgImpactScore} color="bg-orange-600" />
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Profile */}
          <div className="lg:col-span-1 space-y-6">
            <MyProfile address={address} />
          </div>

          {/* Right: Tables */}
          <div className="lg:col-span-2 space-y-6">
            <RecentEvents />
            <LeaderboardTable />
          </div>
        </div>
      </main>
    </div>
  );
}
