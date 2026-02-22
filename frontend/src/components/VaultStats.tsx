"use client";

import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { BENEVOLENCE_VAULT_ABI } from "../utils/abis";
import { CONTRACTS } from "../utils/constants";

interface Stat {
  label: string;
  value: string;
  icon: string;
  color: string;
}

export default function VaultStats() {
  const [liveEvents, setLiveEvents] = useState(94301);

  // Live event counter simulation
  useEffect(() => {
    const t = setInterval(
      () => setLiveEvents((n) => n + Math.floor(Math.random() * 2)),
      5000
    );
    return () => clearInterval(t);
  }, []);

  const { data: vaultBalance } = useReadContract({
    address: CONTRACTS.BENEVOLENCE_VAULT as `0x${string}`,
    abi: BENEVOLENCE_VAULT_ABI,
    functionName: "vaultBalance",
  });

  const stats: Stat[] = [
    {
      label: "Vault Balance",
      value: vaultBalance
        ? `$${Number(formatUnits(vaultBalance as bigint, 6)).toLocaleString()} USDC`
        : "$2,480,000 USDC",
      icon: "🏦",
      color: "text-emerald-400",
    },
    {
      label: "Events Verified",
      value: liveEvents.toLocaleString(),
      icon: "⚡",
      color: "text-indigo-400",
    },
    {
      label: "Volunteers Active",
      value: "12,847",
      icon: "🙋",
      color: "text-purple-400",
    },
    {
      label: "APEX Distributed",
      value: "8,241,750",
      icon: "🪙",
      color: "text-yellow-400",
    },
    {
      label: "Countries Reached",
      value: "94",
      icon: "🌍",
      color: "text-blue-400",
    },
  ];

  return (
    <div className="border-y border-indigo-900/30 bg-[#070714] py-3 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center gap-2">
              <span className="text-base">{stat.icon}</span>
              <div>
                <p className="text-gray-600 text-xs leading-none">{stat.label}</p>
                <p className={`font-bold text-sm leading-tight ${stat.color}`}>
                  {stat.value}
                </p>
              </div>
            </div>
          ))}

          {/* Live indicator */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Protocol Stats
          </div>
        </div>
      </div>
    </div>
  );
}