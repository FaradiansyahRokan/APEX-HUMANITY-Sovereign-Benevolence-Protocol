// Contract addresses — update after deployment
export const CONTRACTS = {
  // Alamat BenevolenceVault dari hasil deploy
  BENEVOLENCE_VAULT: process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  
  // Alamat ReputationLedger dari hasil deploy
  REPUTATION_LEDGER: process.env.NEXT_PUBLIC_LEDGER_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  
  // Alamat ImpactToken (GOOD) dari hasil deploy
  GOOD_TOKEN: process.env.NEXT_PUBLIC_GOOD_TOKEN_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  
  // USDC bisa dibiarkan Zero Address dulu untuk testing lokal, atau diisi mock contract nanti
  USDC: process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x0000000000000000000000000000000000000000",
};

export const ACTION_TYPES = [
  { value: "FOOD_DISTRIBUTION", label: "Food Distribution", emoji: "🍚", baseScore: 80 },
  { value: "MEDICAL_AID", label: "Medical Aid", emoji: "🏥", baseScore: 85 },
  { value: "SHELTER_CONSTRUCTION", label: "Shelter Construction", emoji: "🏠", baseScore: 75 },
  { value: "EDUCATION_SESSION", label: "Education Session", emoji: "📚", baseScore: 70 },
  { value: "DISASTER_RELIEF", label: "Disaster Relief", emoji: "🆘", baseScore: 90 },
  { value: "CLEAN_WATER_PROJECT", label: "Clean Water Project", emoji: "💧", baseScore: 78 },
  { value: "MENTAL_HEALTH_SUPPORT", label: "Mental Health Support", emoji: "💚", baseScore: 72 },
  { value: "ENVIRONMENTAL_ACTION", label: "Environmental Action", emoji: "🌱", baseScore: 65 },
];

export const URGENCY_LEVELS = [
  { value: "CRITICAL", label: "Critical", color: "red", multiplier: 3.0 },
  { value: "HIGH", label: "High", color: "orange", multiplier: 2.0 },
  { value: "MEDIUM", label: "Medium", color: "yellow", multiplier: 1.5 },
  { value: "LOW", label: "Low", color: "green", multiplier: 1.0 },
];

export const REPUTATION_RANKS = [
  { rank: "CITIZEN", threshold: 0, color: "gray", icon: "👤", description: "Beginning the journey" },
  { rank: "GUARDIAN", threshold: 100, color: "blue", icon: "🛡️", description: "Protector of the vulnerable" },
  { rank: "CHAMPION", threshold: 500, color: "purple", icon: "⚔️", description: "Champion of equity" },
  { rank: "SOVEREIGN", threshold: 2000, color: "gold", icon: "👑", description: "Sovereign of benevolence" },
  { rank: "APEX", threshold: 10000, color: "rainbow", icon: "⚡", description: "Apex of humanity" },
];

export const getRank = (score: number) => {
  const ranks = [...REPUTATION_RANKS].reverse();
  return ranks.find((r) => score >= r.threshold) || REPUTATION_RANKS[0];
};
