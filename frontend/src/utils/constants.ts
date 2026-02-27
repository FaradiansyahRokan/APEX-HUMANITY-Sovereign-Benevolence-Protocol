export const CONTRACTS = {
  BENEVOLENCE_VAULT: process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xDC015EB08Ba46F9e4613050564f016DC863Dae2F",
  REPUTATION_LEDGER: process.env.NEXT_PUBLIC_LEDGER_ADDRESS || "0x566f29c9b0c72CCb34A025f95b65405adE91f73E",
  // GOOD_TOKEN dihapus — GOOD adalah native coin L1
};

export const APEX_CHAIN = {
  id: 6969,
  name:     "APEXNETWORK",
  rpc:      process.env.NEXT_PUBLIC_RPC_URL ||
            "http://127.0.0.1:9654/ext/bc/2hGMsKi551C3hgc27H3ryiktbdJmbNxujbXZ7u1NprGLN7Aupi/rpc",
  symbol:   "APEX",
  decimals: 18,
} as const;

export const ACTION_TYPES = [
  { value: "FOOD_DISTRIBUTION",     label: "Food Distribution",     emoji: "🍚", baseScore: 80 },
  { value: "MEDICAL_AID",           label: "Medical Aid",           emoji: "🏥", baseScore: 85 },
  { value: "SHELTER_CONSTRUCTION",  label: "Shelter Construction",  emoji: "🏠", baseScore: 75 },
  { value: "EDUCATION_SESSION",     label: "Education Session",     emoji: "📚", baseScore: 70 },
  { value: "DISASTER_RELIEF",       label: "Disaster Relief",       emoji: "🆘", baseScore: 90 },
  { value: "CLEAN_WATER_PROJECT",   label: "Clean Water Project",   emoji: "💧", baseScore: 78 },
  { value: "MENTAL_HEALTH_SUPPORT", label: "Mental Health Support", emoji: "💚", baseScore: 72 },
  { value: "ENVIRONMENTAL_ACTION",  label: "Environmental Action",  emoji: "🌱", baseScore: 65 },
];

export const URGENCY_LEVELS = [
  { value: "CRITICAL", label: "Critical", color: "red",    multiplier: 3.0 },
  { value: "HIGH",     label: "High",     color: "orange", multiplier: 2.0 },
  { value: "MEDIUM",   label: "Medium",   color: "yellow", multiplier: 1.5 },
  { value: "LOW",      label: "Low",      color: "green",  multiplier: 1.0 },
];

export const REPUTATION_RANKS = [
  { rank: "CITIZEN",   threshold: 0,     color: "gray",    icon: "citizen",   description: "Beginning the journey" },
  { rank: "GUARDIAN",  threshold: 100,   color: "blue",    icon: "guardian",  description: "Protector of the vulnerable" },
  { rank: "CHAMPION",  threshold: 500,   color: "purple",  icon: "champion",  description: "Champion of equity" },
  { rank: "SOVEREIGN", threshold: 2000,  color: "gold",    icon: "sovereign", description: "Sovereign of benevolence" },
  { rank: "APEX",      threshold: 10000, color: "rainbow", icon: "apex",      description: "Apex of humanity" },
];

export const getRank = (score: number) => {
  const ranks = [...REPUTATION_RANKS].reverse();
  return ranks.find((r) => score >= r.threshold) || REPUTATION_RANKS[0];
};