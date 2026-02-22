# ⚡ APEX HUMANITY — The Sovereign Benevolence Protocol
### *"A Digital Constitution for Humanity"*

> A revolutionary Layer 1 decentralized protocol where **Proof of Beneficial Action (PoBA)** transforms verifiable human kindness into a measurable, liquid, and prestigious asset.

---

## 🌍 Vision

The world's most *valuable* person is not the one with the most gold — it is the one who has helped the most people.

APEX HUMANITY eliminates corruption in social funding, incentivizes goodness, and protects privacy using **Zero-Knowledge Proofs**, **AI Oracle verification**, and **Soulbound Reputation NFTs**.

---

## 🗂 Project Structure

```
apex-humanity/
├── architecture/               # System blueprints & diagrams
│   ├── system-diagram.md       # Mermaid architecture diagram
│   └── interaction-flow.md     # Oracle ↔ Contract flow
│
├── oracle/                     # SATIN AI Oracle (Python)
│   ├── api/
│   │   ├── main.py             # FastAPI gateway
│   │   ├── routes.py           # API endpoints
│   │   └── middleware.py       # Auth & rate-limiting
│   ├── engine/
│   │   ├── impact_evaluator.py # Core ImpactEvaluator class ⭐
│   │   ├── cv_analyzer.py      # Computer Vision module
│   │   ├── nlp_analyzer.py     # NLP / Sentiment module
│   │   └── signer.py           # ECDSA Oracle Signer
│   ├── zkp/
│   │   └── proof_generator.py  # Zero-Knowledge Proof logic
│   ├── requirements.txt
│   └── Dockerfile
│
├── contracts/                  # Smart Contracts (Solidity)
│   ├── src/
│   │   ├── BenevolenceVault.sol    # Escrow + Distribution ⭐
│   │   ├── ImpactToken.sol         # ERC-20 Reward Token
│   │   ├── ReputationLedger.sol    # Soulbound Score Store ⭐
│   │   ├── SovereignID.sol         # ERC-5114 Identity NFT
│   │   └── ApexDAO.sol             # Governance Contract
│   ├── scripts/
│   │   └── deploy.js           # Hardhat deployment script
│   ├── test/
│   │   └── BenevolenceVault.test.js
│   ├── hardhat.config.js
│   └── package.json
│
├── frontend/                   # Next.js dApp
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/             # Shadcn UI components
│   │   │   ├── dashboard/      # Main dashboard
│   │   │   ├── impact/         # Impact submission UI
│   │   │   └── identity/       # Sovereign ID UI
│   │   ├── hooks/              # Web3 + contract hooks
│   │   ├── pages/              # Next.js pages
│   │   ├── utils/              # Contract ABIs + helpers
│   │   └── context/            # Global state
│   └── package.json
│
├── data/
│   └── schemas/
│       └── impact-metadata.schema.json   # JSON Schema ⭐
│
├── scripts/
│   └── setup.sh                # One-command project setup
│
└── docs/
    └── apex-whitepaper.md      # Technical whitepaper
```

---

## 🚀 Quick Start

```bash
# 1. Clone & Setup
git clone https://github.com/your-org/apex-humanity
chmod +x scripts/setup.sh && ./scripts/setup.sh

# 2. Start Oracle Engine
cd oracle && uvicorn api.main:app --reload --port 8000

# 3. Deploy Contracts (local)
cd contracts && npx hardhat node
npx hardhat run scripts/deploy.js --network localhost

# 4. Start Frontend
cd frontend && npm run dev
```

---

## ⚙️ Core Technologies

| Layer | Technology |
|---|---|
| Blockchain | Ethereum L2 (Polygon / Arbitrum) |
| Smart Contracts | Solidity 0.8.x + OpenZeppelin |
| AI Oracle | Python 3.11, FastAPI, YOLOv8, HuggingFace |
| ZK Proofs | snarkjs + Circom circuits |
| Identity | ERC-5114 Soulbound NFT |
| Storage | IPFS / Filecoin (via web3.storage) |
| Frontend | Next.js 14, wagmi, viem, TailwindCSS |
| Signing | ECDSA secp256k1 |

---

## 📜 License
MIT — *Built for Humanity*
