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

### 3. Fortified Anti-Fraud Engine 
To guarantee that nobody can "cheat" the system, we built a multi-layered verification firewall:
- **Challenge Nonce System:** Before uploading, the Oracle generates a unique cryptographic nonce. The photo *must* be uploaded during the 5-minute validity window of this nonce, preventing replay attacks.
- **EXIF Metadata Authentication:** The Oracle extracts EXIF data from the photo. It checks the **Timestamp** (rejecting photos older than 24 hours) and calculates the Haversine distance between the photo's **GPS coordinates** and the location you claim to be at. If they don't match, you lose your score!
- **ELA (Error Level Analysis):** A digital forensics module detects if an image has been manipulated (e.g., Photoshopped) by analyzing compression inconsistencies.
- **Live Camera Bonus:** The frontend integrates a direct WebRTC camera module. Taking a photo *Live* via the dApp earns you a bonus score compared to uploading from the gallery.

### 4. Decentralized Community Voting 
What happens if the AI Oracle is unsure (Confidence Score < 30%)? The submission is sent to the **Community Stream**.
- **Phase 1 (First 10 mins):** Only highly trusted users (Rank **CHAMPION** or above, Reputation Score > 500) can vote to Approve or Reject the proof.
- **Phase 2:** Voting opens to all verified volunteers.
- **Fairness Logic:** Once a Quorum (3 votes) approves the submission, the volunteer is guaranteed a minimum payout (~12.4 APEX) signed securely by the Oracle. *Anti-abuse rule: You cannot vote on your own submission, nor submit new ones while another is pending community review!*

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
