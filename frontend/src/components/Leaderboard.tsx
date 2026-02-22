"use client";

import { useState } from "react";
import { getRank } from "../utils/constants";

const MOCK_LEADERBOARD = [
  { rank: 1,  address: "0xAbCd...1234", score: 94850, events: 312, country: "🇸🇸", name: "South Sudan" },
  { rank: 2,  address: "0xDeEf...5678", score: 87220, events: 278, country: "🇾🇪", name: "Yemen" },
  { rank: 3,  address: "0xF012...9abc", score: 81400, events: 241, country: "🇭🇹", name: "Haiti" },
  { rank: 4,  address: "0x3456...def0", score: 74500, events: 199, country: "🇦🇫", name: "Afghanistan" },
  { rank: 5,  address: "0x789a...bcde", score: 68900, events: 187, country: "🇸🇴", name: "Somalia" },
  { rank: 6,  address: "0xBc12...3456", score: 61200, events: 154, country: "🇨🇩", name: "DR Congo" },
  { rank: 7,  address: "0xEf34...7890", score: 55400, events: 132, country: "🇸🇾", name: "Syria" },
  { rank: 8,  address: "0x1234...abcd", score: 48900, events: 119, country: "🇪🇹", name: "Ethiopia" },
  { rank: 9,  address: "0x5678...ef01", score: 42100, events: 98,  country: "🇳🇬", name: "Nigeria" },
  { rank: 10, address: "0x9abc...2345", score: 38700, events: 87,  country: "🇲🇲", name: "Myanmar" },
];

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-400 font-bold text-lg">🥇</span>;
  if (rank === 2) return <span className="text-gray-300 font-bold text-lg">🥈</span>;
  if (rank === 3) return <span className="text-orange-400 font-bold text-lg">🥉</span>;
  return <span className="text-gray-500 font-semibold text-sm">#{rank}</span>;
}

export default function Leaderboard() {
  const [filter, setFilter] = useState<"all" | "weekly" | "monthly">("all");

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">🏆 Global Reputation Leaderboard</h2>
          <p className="text-gray-500 text-sm mt-0.5">The world's most valuable humans — ranked by goodness</p>
        </div>
        {/* Filter Tabs */}
        <div className="flex gap-1 bg-gray-900 p-1 rounded-xl border border-gray-800">
          {(["all", "weekly", "monthly"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 text-sm rounded-lg capitalize transition-all ${
                filter === f
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {f === "all" ? "All Time" : f === "weekly" ? "This Week" : "This Month"}
            </button>
          ))}
        </div>
      </div>

      {/* Top 3 Podium */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {MOCK_LEADERBOARD.slice(0, 3).map((entry) => {
          const rep = getRank(entry.score / 100);
          return (
            <div
              key={entry.rank}
              className={`rounded-2xl p-4 text-center border ${
                entry.rank === 1
                  ? "bg-yellow-900/20 border-yellow-700/40"
                  : entry.rank === 2
                  ? "bg-gray-800/40 border-gray-600/40"
                  : "bg-orange-900/20 border-orange-700/40"
              }`}
            >
              <div className="text-3xl mb-1">
                {entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : "🥉"}
              </div>
              <p className="text-white font-bold text-sm">{rep.icon} {rep.rank}</p>
              <p className="text-gray-400 text-xs font-mono">{entry.address}</p>
              <p className="text-white font-bold text-lg mt-2">
                {entry.score.toLocaleString()}
              </p>
              <p className="text-gray-500 text-xs">points</p>
              <p className="text-gray-400 text-xs mt-1">{entry.country} {entry.name}</p>
            </div>
          );
        })}
      </div>

      {/* Full Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase tracking-wider bg-gray-900/80">
              <th className="text-left px-4 py-3">Rank</th>
              <th className="text-left px-4 py-3">Volunteer</th>
              <th className="text-left px-4 py-3">Location</th>
              <th className="text-left px-4 py-3">Tier</th>
              <th className="text-right px-4 py-3">Events</th>
              <th className="text-right px-4 py-3">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {MOCK_LEADERBOARD.map((entry) => {
              const rep = getRank(entry.score / 100);
              return (
                <tr
                  key={entry.rank}
                  className="hover:bg-gray-800/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <RankMedal rank={entry.rank} />
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-300 text-xs">
                    {entry.address}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {entry.country} {entry.name}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-300">
                      {rep.icon} {rep.rank}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {entry.events}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-indigo-400 font-bold">
                      {entry.score.toLocaleString()}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="px-4 py-3 border-t border-gray-800 text-center">
          <button className="text-indigo-400 hover:text-indigo-300 text-sm transition-colors">
            View full leaderboard →
          </button>
        </div>
      </div>
    </div>
  );
}