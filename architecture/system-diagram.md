# APEX HUMANITY — System Architecture Blueprint

## High-Level Architecture Diagram

```mermaid
graph TB
    subgraph USER_LAYER["👤 Layer 0 — Participants"]
        VOL[🙋 Volunteer / Doer of Good]
        BEN[💛 Beneficiary]
        DON[💰 Donor / DAO Treasury]
    end

    subgraph SATIN["🧠 SATIN AI Oracle Engine — Python"]
        API[⚡ FastAPI Gateway]
        CV[👁️ Computer Vision YOLOv8]
        NLP[💬 HuggingFace NLP]
        IMP[⚖️ ImpactEvaluator]
        ZKP[🔏 ZK-Proof Generator]
        SIGN[✍️ Oracle ECDSA Signer]
    end

    subgraph CONTRACTS["⛓️ Smart Contract Layer"]
        VAULT[🏦 BenevolenceVault.sol]
        TOKEN[🪙 ImpactToken.sol]
        LEDGER[📜 ReputationLedger.sol]
        ID_NFT[🆔 SovereignID.sol]
        GOV[🗳️ ApexDAO.sol]
    end

    VOL -->|Upload Evidence + GPS| API
    DON -->|Fund Treasury| VAULT
    API --> CV --> IMP
    API --> NLP --> IMP
    IMP --> ZKP --> SIGN
    SIGN -->|Signed Payload| VAULT
    VAULT -->|Release| TOKEN --> VOL
    VAULT -->|Update Score| LEDGER --> ID_NFT
    GOV --> VAULT
```

## Oracle to Contract Sequence

```mermaid
sequenceDiagram
    actor V as Volunteer
    participant dApp
    participant SATIN as SATIN Oracle
    participant Vault as BenevolenceVault

    V->>dApp: Submit evidence (img, GPS, action)
    dApp->>SATIN: POST /verify
    SATIN->>SATIN: CV + NLP + ImpactScore + ZKP
    SATIN->>SATIN: ECDSA sign oracle payload
    SATIN-->>dApp: {score, zk_proof, signature}
    dApp->>Vault: releaseReward(payload, sig)
    Vault->>Vault: ecrecover → verify Oracle
    Vault-->>V: Tokens + Reputation update
```

## Impact Score Formula

```
ImpactScore = (Urgency×0.35) + (Difficulty×0.25) + (Reach×0.20) + (Authenticity×0.20)
TokenReward = BaseReward × (ImpactScore/100) × LocationMultiplier
```
