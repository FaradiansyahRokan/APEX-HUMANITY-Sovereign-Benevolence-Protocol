# APEX HUMANITY — Sovereign Benevolence Protocol
## High-Level Architecture (v1.0)

```mermaid
graph TB
    subgraph IDENTITY["🔐 IDENTITY LAYER — Sovereign Digital ID"]
        SBT["Soulbound Token (SBT)\nERC-721 Non-Transferable\nReputation Non-Fungible"]
        DID["W3C DID Document\ndid:apex:0x..."]
        ZKP["ZK-Proof Engine\n(snarkjs + Groth16)"]
        SBT <--> DID
        DID <--> ZKP
    end

    subgraph ORACLE["🤖 ORACLE AI — SATIN ENGINE (Python)"]
        CV["Computer Vision\n(OpenCV + YOLO)\nImage & Video Verification"]
        SA["Sentiment Analysis\n(Transformers NLP)\nNarrative Scoring"]
        GPS["IoT / GPS Validator\nLocation Authenticity"]
        ISE["Impact Score Engine\nImpactEvaluator Class\nf(urgency, location, difficulty)"]
        HASH["Cryptographic Hasher\nSHA-256 + ECDSA Sign\nOracle Signature"]
        CV --> ISE
        SA --> ISE
        GPS --> ISE
        ISE --> HASH
    end

    subgraph CHAIN["⛓️ BLOCKCHAIN LAYER — (EVM Compatible)"]
        BV["BenevolenceVault.sol\nEscrow + Release Logic"]
        RL["ReputationLedger.sol\nImmutable Score Registry"]
        GT["GoodToken.sol\nERC-20 Impact Token"]
        BV --> RL
        BV --> GT
    end

    subgraph DISTRIBUTION["💸 DISTRIBUTION LAYER"]
        STABLE["Stablecoin Release\n(USDC / DAI Vault)"]
        IMPACT_TOKEN["GOOD Token Mint\nReputation Capital"]
        NOTIF["Push Notification\n(EPNS Protocol)"]
        STABLE --> NOTIF
        IMPACT_TOKEN --> NOTIF
    end

    subgraph FRONTEND["🌐 FRONTEND — React + Web3"]
        DAPP["dApp Interface\n(Next.js + Wagmi)"]
        WALLET["Wallet Connect\n(MetaMask / WalletConnect)"]
        IPFS_UI["IPFS Upload\nMedia Evidence"]
        DAPP <--> WALLET
        DAPP --> IPFS_UI
    end

    subgraph STORAGE["📦 DECENTRALIZED STORAGE"]
        IPFS["IPFS / Filecoin\nMedia & Metadata"]
        ARWEAVE["Arweave\nPermanent Record"]
        IPFS --> ARWEAVE
    end

    %% Flow connections
    FRONTEND --> ORACLE
    IPFS_UI --> STORAGE
    STORAGE --> ORACLE
    ORACLE --> CHAIN
    CHAIN --> DISTRIBUTION
    IDENTITY --> CHAIN
    ZKP --> BV

    style IDENTITY fill:#1a1a2e,color:#e0e0ff,stroke:#4a4aff
    style ORACLE fill:#0d1b2a,color:#e0ffe0,stroke:#00ff88
    style CHAIN fill:#1a0a0a,color:#ffe0e0,stroke:#ff4444
    style DISTRIBUTION fill:#0a1a0a,color:#e0ffe0,stroke:#44ff44
    style FRONTEND fill:#1a1500,color:#ffffe0,stroke:#ffff44
    style STORAGE fill:#150a1a,color:#f0e0ff,stroke:#aa44ff
```

## Data Flow — Proof of Beneficial Action (PoBA)

```mermaid
sequenceDiagram
    actor V as 🙋 Volunteer
    actor B as 👤 Beneficiary (ZK-Protected)
    participant APP as 📱 dApp
    participant IPFS as 📦 IPFS
    participant SATIN as 🤖 SATIN Oracle
    participant VAULT as 🔐 BenevolenceVault
    participant LEDGER as 📜 ReputationLedger

    V->>APP: Submit Impact Proof\n(Photo + GPS + Narrative)
    APP->>IPFS: Upload encrypted media
    IPFS-->>APP: CID (Content Hash)
    APP->>SATIN: Send ImpactMetadata JSON\n{cid, gps, timestamp, zkp_hash}

    Note over SATIN: AI Verification Pipeline
    SATIN->>SATIN: Computer Vision Analysis
    SATIN->>SATIN: GPS Authenticity Check
    SATIN->>SATIN: Calculate ImpactScore
    SATIN->>SATIN: Sign with Oracle Private Key (ECDSA)

    SATIN-->>VAULT: oracleSignedMessage\n{score, volunteer_addr, beneficiary_zkp}

    Note over VAULT: Smart Contract Execution
    VAULT->>VAULT: verify(oracleSignature)
    VAULT->>VAULT: releaseFunds() to volunteer
    VAULT->>LEDGER: updateReputation(volunteer, score)
    VAULT->>B: Release aid to beneficiary\n(via ZKP address)

    LEDGER-->>V: 🏆 Reputation Score Updated
    VAULT-->>V: 💰 GOOD Tokens Minted
    VAULT-->>B: 💵 USDC Released (aid)
```

## Impact Score Formula

```
ImpactScore = (BaseScore × UrgencyMultiplier × LocationMultiplier × DifficultyMultiplier) / NormalizationFactor

Where:
- BaseScore          = AI confidence (0.0 – 1.0) × 100
- UrgencyMultiplier  = {CRITICAL: 3.0, HIGH: 2.0, MEDIUM: 1.5, LOW: 1.0}
- LocationMultiplier = 1 + (poverty_index × 0.5)   [UN HDI poverty index]
- DifficultyMultiplier = 1 + (effort_hours × 0.1)
- NormalizationFactor  = 10 (to keep scores in 0–100 range)
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.x, Hardhat, OpenZeppelin |
| ZK Proofs | snarkjs, Circom, Groth16 |
| AI Oracle | Python 3.11, OpenCV, HuggingFace Transformers, FastAPI |
| Blockchain | EVM (Polygon / Ethereum L2) |
| Frontend | Next.js 14, Wagmi v2, RainbowKit, TailwindCSS |
| Storage | IPFS (web3.storage), Arweave |
| Database (Off-chain) | PostgreSQL + Redis (oracle cache) |
| Messaging | The Graph Protocol (indexing), EPNS (notifications) |
