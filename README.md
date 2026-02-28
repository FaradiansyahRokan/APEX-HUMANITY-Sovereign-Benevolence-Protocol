# ⚡ APEX HUMANITY — The Sovereign Benevolence Protocol
### *"A Digital Constitution for Humanity"*

> A revolutionary Layer 1 decentralized protocol where **Proof of Beneficial Action (PoBA)** transforms verifiable human kindness into a measurable, liquid, and prestigious asset.

APEX Humanity eliminates corruption in social funding, incentivizes goodness, and protects privacy using **AI Oracle verification (SATIN)**, **Zero-Knowledge Proofs**, **Anti-Fraud Integrity checks**, and **On-Chain Reputation**.

---

##  The "Stars" of the Application (Key Innovations)

### 1. Proof of Beneficial Action (PoBA)
Instead of mining blocks with graphics cards, APEX Humanity "mines" tokens through **real-world good deeds** (e.g., distributing food, providing medical aid, teaching children). This creates a completely new asset class backed by the intrinsic value of human benevolence.

### 2. SATIN Oracle — AI-Powered Verification
SATIN (Sovereign Autonomous Trust & Impact Network) is our custom Python-based AI Oracle. When you submit a photo of your good deed, SATIN runs it through a **CV Object Detection Engine (YOLOv8)** to confirm what the image portrays (e.g., detecting food, water, medical supplies). It independently calculates an **Impact Score** which dictates how many **APEX Tokens** you receive.

### 3. Fortified Anti-Fraud Engine (SATIN Perimeter Integrity Firewall)
To guarantee that nobody can "cheat" the system, we built the **SATIN Perimeter Integrity Firewall** — a multi-dimensional, 6-layer defense system that makes data manipulation nearly impossible:

| Layer | Name | Security Mechanism |
| :--- | :--- | :--- |
| **Layer 1** | **Digital Forensics** | **EXIF Auth:** Rejects photos without GPS/Timestamp metadata (Screenshots/Downloads). **ELA Analysis:** Detects Photoshop/Clone-tool edits via compression variance. |
| **Layer 2** | **Logic Constraint Matrix** | **Physical Hard-Caps:** Rejects impossible claims (e.g., 5000 people helped in 1 hour). Cross-validates Action Types vs Urgency Levels. |
| **Layer 3** | **CV Triangulation** | **YOLOv8 Object Detection:** Counts visible humans. If you claim 500 helped but YOLO sees 0 people in the photo → **High Risk Penalty**. |
| **Layer 4** | **Semantic NLP Audit** | **Keyword Analysis:** Ensures descriptions match action types (e.g., "Food Distribution" must contain food-related keywords). |
| **Layer 5** | **AI Consistency Auditor** | **LLM Cross-Validator (Anthropic Haiku):** AI reads your entire description and cross-matches it against your claimed numbers for logical contradictions. |
| **Layer 6** | **The Punisher (Clamping)** | **Adaptive Penalties:** Any high-risk flag triggers **Hard Clamping**, forcing your rewards to the absolute minimum and routing you for strict **Champion-Only Audit**. |

> [!IMPORTANT]
> **Anti-Manipulation Streak:** The system tracks manipulation attempts. 3 failed attempts in a row will result in an **Auto-Ban** of the wallet address from the APEX ecosystem.

### 4. Decentralized Community Voting 
What happens if the AI Oracle is unsure or flags a submission as suspicious? It's sent to the **Community Stream**.
- **Tier 1 (High Risk):** Submissions flagged as "High Risk" (missing EXIF, suspicious objects) require a **CHAMPION+ Audit**. Only top-reputation users can vote.
- **Tier 2 (Standard):** Low-confidence but clean submissions are open to all volunteers.
- **Slashing Logic:** If the community rejects a fraud attempt, any pending rewards are burned. Repeated rejections lead to reputation slashing.

### 5. On-Chain Reputation & Rank System
The *ReputationLedger.sol* smart contract tracks your cumulative impact. As you do good deeds, you "level up" through ranks: `INITIATE` ➔ `NOVICE` ➔ `CHAMPION` ➔ `LUMINARY` ➔ `APEX`. Your rank unlocks voting privileges and social proof.

---

##  Technical Architecture

### 1. Frontend (Next.js + React + Wagmi/Viem)
A stunning, responsive, glassmorphism UI offering:
- **Dashboard/Impact Feed:** A live feed of recent verifications globally occurring in the network.
- **Submit Impact Form:** The interactive portal for submitting proof. Extracts GPS, handles Live Camera capturing, requests Nonces, and manages the multi-step flow (IPFS Upload ➔ Oracle Verify ➔ On-Chain Transaction).
- **Reputation Profile:** Your Sovereign Identity, showing your Rank, total APEX earned, and Leaderboard standing.
- **P2P Transfer (Donate):** A direct portal to transfer APEX tokens directly to other addresses on the blockchain from your *BenevolenceVault*.

### 2. Backend Oracle (Python FastAPI)
The bridge between the real world and the blockchain.
- **endpoints:** `/api/v1/challenge`, `/api/v1/evaluate-with-image`, `/api/v1/stream`, etc.
- **engine:** Houses the `ImpactEvaluator`, `FraudDetector` (EXIF validation, ELA analysis, distance calculations), and Ethereum ECDSA `OracleSigner` which signs the calculated scores so the Smart Contract respects them.

### 3. Smart Contracts (Solidity/Hardhat)
- **BenevolenceVault.sol:** The main escrow that mints APEX Tokens. It validates the ECDSA signature sent by the Oracle so that *no one* (not even admins) can artificially mint tokens without passing the AI algorithm's verification.
- **ReputationLedger.sol:** Non-transferrable tracking of historical impact acts, keeping the "Game" of APEX Humanity trustless and un-hackable.
- **SovereignID.sol / MockERC20.sol:** Token infrastructure.

---

##  Project Structure

```
apex-humanity/
├── contracts/                  # Smart Contracts (Solidity 0.8.x)
│   ├── src/                    # BenelovenceVault, ReputationLedger, etc.
│   ├── scripts/                # Hardhat deployment scripts
│   ├── test/                   # Mocha/Chai tests
│   └── hardhat.config.js       # Hardhat configuration
│
├── frontend/                   # Modern Web dApp (Next.js 14)
│   ├── src/
│   │   ├── components/         # SubmitImpactForm, CommunityStream, Badges, etc.
│   │   ├── pages/              # index.tsx (Main App Shell)
│   │   ├── hooks/              # Wagmi web3 react hooks
│   │   └── utils/              # Contract ABIs, utility constants
│   └── package.json
│
├── oracle/                     # SATIN AI Oracle (Python 3.11)
│   ├── api/
│   │   └── main.py             # FastAPI gateway + routing
│   ├── engine/
│   │   ├── impact_evaluator.py # Core Evaluation Logic & Signature Generation
│   │   └── fraud_detector.py   # ELA, EXIF, & Haversine distance validation
│   └── Dockerfile              # Container orchestration
│
└── README.md
```

---

##  Quick Start Guide

### 1. Oracle Backend (SATIN)
Navigate to the `oracle` directory. You will need Python 3.11+.
```bash
cd oracle
# Create virtual environment and install dependencies
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start the FastAPI Server
uvicorn api.main:app --reload --port 8000
```
> Note: The Oracle requires a `.env` file with `ORACLE_PRIVATE_KEY_HEX` to sign transactions.

### 2. Smart Contracts (Hardhat)
Navigate to the `contracts` directory.
```bash
cd contracts
npm install

# Start local hardhat node (Open a separate terminal)
npx hardhat node

# Deploy contracts and configure the oracle
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/set-oracle.js --network localhost
npx hardhat run scripts/enable-minter.js --network localhost
```

### 3. Frontend Web App (Next.js)
Navigate to the `frontend` directory. Ensure you have the deployed contract addresses ready.
```bash
cd frontend
npm install

# Configure your .env.local with NEXT_PUBLIC_CONTRACT_ADDRESS, etc.

# Start the development server
npm run dev
```
Open `http://localhost:3000` in your browser.

---

## 📜 License
MIT — *Built for Humanity*
