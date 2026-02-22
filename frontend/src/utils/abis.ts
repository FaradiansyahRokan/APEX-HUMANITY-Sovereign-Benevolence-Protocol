// frontend/src/utils/abis.ts
// Complete ABI for BenevolenceVault contract

export const BENEVOLENCE_VAULT_ABI = [
  // ── View Functions ─────────────────────────────────────────────
  {
    "inputs": [],
    "name": "vaultBalance",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "volunteer", "type": "address" }
    ],
    "name": "getVolunteerReputation",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getStats",
    "outputs": [
      { "internalType": "uint256", "name": "deposited",      "type": "uint256" },
      { "internalType": "uint256", "name": "distributed",    "type": "uint256" },
      { "internalType": "uint256", "name": "eventsVerified", "type": "uint256" },
      { "internalType": "uint256", "name": "currentBalance", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "eventId", "type": "bytes32" }],
    "name": "isEventProcessed",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "oracleAddress",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalEventsVerified",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },

  // ── Write Functions ────────────────────────────────────────────
  {
    "inputs": [
      { "internalType": "bytes32",  "name": "eventId",            "type": "bytes32"  },
      { "internalType": "address",  "name": "volunteerAddress",   "type": "address"  },
      { "internalType": "address",  "name": "beneficiaryAddress", "type": "address"  },
      { "internalType": "uint256",  "name": "impactScoreScaled",  "type": "uint256"  },
      { "internalType": "uint256",  "name": "tokenRewardWei",     "type": "uint256"  },
      { "internalType": "bytes32",  "name": "zkProofHash",        "type": "bytes32"  },
      { "internalType": "bytes32",  "name": "eventHash",          "type": "bytes32"  },
      { "internalType": "string",   "name": "nonce",              "type": "string"   },
      { "internalType": "uint256",  "name": "expiresAt",          "type": "uint256"  },
      { "internalType": "uint8",    "name": "v",                  "type": "uint8"    },
      { "internalType": "bytes32",  "name": "r",                  "type": "bytes32"  },
      { "internalType": "bytes32",  "name": "s",                  "type": "bytes32"  }
    ],
    "name": "releaseReward",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32",  "name": "eventHash",          "type": "bytes32"  },
      { "internalType": "address",  "name": "volunteerAddress",   "type": "address"  },
      { "internalType": "bytes32",  "name": "beneficiaryZkpHash", "type": "bytes32"  },
      { "internalType": "uint256",  "name": "impactScoreScaled",  "type": "uint256"  },
      { "internalType": "string",   "name": "actionType",         "type": "string"   },
      { "internalType": "bytes",    "name": "oracleSignature",    "type": "bytes"    }
    ],
    "name": "submitVerifiedImpact",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "deposit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },

  // ── Events (for wagmi useWatchContractEvent) ──────────────────
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "bytes32", "name": "eventId",            "type": "bytes32" },
      { "indexed": true,  "internalType": "address", "name": "volunteer",          "type": "address" },
      { "indexed": true,  "internalType": "address", "name": "beneficiary",        "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "impactScore",        "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "tokenReward",        "type": "uint256" },
      { "indexed": false, "internalType": "bytes32", "name": "zkProofHash",        "type": "bytes32" },
      { "indexed": false, "internalType": "bytes32", "name": "eventHash",          "type": "bytes32" },
      { "indexed": false, "internalType": "uint256", "name": "timestamp",          "type": "uint256" }
    ],
    "name": "RewardReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "address", "name": "donor",        "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount",       "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "totalBalance", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "timestamp",    "type": "uint256" }
    ],
    "name": "FundsDeposited",
    "type": "event"
  }
] as const;

// ── Reputation Ledger ABI ──────────────────────────────────────────────────────
export const REPUTATION_LEDGER_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "volunteer", "type": "address" }],
    "name": "getReputation",
    "outputs": [
      { "internalType": "uint256", "name": "cumulativeScore",  "type": "uint256" },
      { "internalType": "uint256", "name": "eventCount",       "type": "uint256" },
      { "internalType": "uint256", "name": "lastUpdatedAt",    "type": "uint256" },
      { "internalType": "uint256", "name": "rank",             "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "offset", "type": "uint256" },
      { "internalType": "uint256", "name": "limit",  "type": "uint256" }
    ],
    "name": "getLeaderboardPage",
    "outputs": [
      { "internalType": "address[]", "name": "addresses", "type": "address[]" },
      { "internalType": "uint256[]", "name": "scores",    "type": "uint256[]" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getGlobalStats",
    "outputs": [
      { "internalType": "uint256", "name": "participants", "type": "uint256" },
      { "internalType": "uint256", "name": "totalScore",   "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// ── ImpactToken ABI ────────────────────────────────────────────────────────────
export const IMPACT_TOKEN_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "circulatingSupply",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;