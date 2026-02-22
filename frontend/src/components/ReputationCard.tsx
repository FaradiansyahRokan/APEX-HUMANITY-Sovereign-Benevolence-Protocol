"use client";

import { getRank, REPUTATION_RANKS } from "../utils/constants";

interface Props {
  address: string;
  reputationScore: number;
}

export default function ReputationCard({ address, reputationScore }: Props) {
  const rank = getRank(reputationScore);

  // Find next rank threshold
  const currentIdx = REPUTATION_RANKS.findIndex((r) => r.rank === rank.rank);
  const nextRank = REPUTATION_RANKS[currentIdx + 1];
  const progress = nextRank
    ? ((reputationScore - rank.threshold) / (nextRank.threshold - rank.threshold)) * 100
    : 100;

  const colorMap: Record<string, string> = {
    gray:    "from-gray-600 to-gray-500",
    blue:    "from-blue-600 to-blue-400",
    purple:  "from-purple-600 to-purple-400",
    gold:    "from-yellow-600 to-yellow-400",
    rainbow: "from-indigo-500 via-purple-500 to-emerald-500",
  };

  const borderMap: Record<string, string> = {
    gray:    "border-gray-700",
    blue:    "border-blue-700",
    purple:  "border-purple-700",
    gold:    "border-yellow-600",
    rainbow: "border-indigo-500",
  };

  return (
    <div className={`bg-gray-900/60 border ${borderMap[rank.color] || "border-gray-700"} rounded-2xl p-5 mb-6`}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        {/* Identity */}
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${colorMap[rank.color]} flex items-center justify-center text-2xl shadow-lg`}>
            {rank.icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-lg">{rank.rank}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full bg-gradient-to-r ${colorMap[rank.color]} text-white font-semibold`}>
                Reputation
              </span>
            </div>
            <p className="text-gray-400 text-sm font-mono">
              {address.slice(0, 8)}...{address.slice(-6)}
            </p>
            <p className="text-gray-500 text-xs mt-0.5 italic">{rank.description}</p>
          </div>
        </div>

        {/* Score */}
        <div className="text-right">
          <p className="text-3xl font-bold text-white">{reputationScore.toLocaleString()}</p>
          <p className="text-gray-400 text-sm">Impact Points</p>
        </div>
      </div>

      {/* Progress to next rank */}
      {nextRank && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>Progress to {nextRank.icon} {nextRank.rank}</span>
            <span>{reputationScore.toLocaleString()} / {nextRank.threshold.toLocaleString()}</span>
          </div>
          <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${colorMap[rank.color]} rounded-full transition-all duration-700`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <p className="text-gray-600 text-xs mt-1">
            {(nextRank.threshold - reputationScore).toLocaleString()} points to next rank
          </p>
        </div>
      )}

      {/* APEX rank — max level */}
      {!nextRank && (
        <div className="mt-4 text-center py-2 rounded-xl bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border border-indigo-800/30">
          <p className="text-indigo-300 text-sm font-semibold">⚡ Maximum Rank Achieved — APEX of Humanity</p>
        </div>
      )}
    </div>
  );
}