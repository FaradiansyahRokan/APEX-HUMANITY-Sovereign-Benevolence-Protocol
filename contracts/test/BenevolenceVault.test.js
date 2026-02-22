/**
 * APEX HUMANITY — BenevolenceVault Tests
 * Hardhat + Chai test suite
 */

const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("BenevolenceVault", function () {
  let vault, impactToken, reputationLedger;
  let deployer, oracle, volunteer, beneficiary, donor;

  const IMPACT_SCORE  = 7550;   // 75.50 × 100
  const TOKEN_REWARD  = ethers.parseEther("75.5");
  const EVENT_ID      = ethers.id("test-event-001");
  const ZK_PROOF      = ethers.id("zk-proof-hash");
  const EVENT_HASH    = ethers.id("event-hash");
  const NONCE         = "unique-nonce-001";

  async function signPayload(signer, args) {
    const hash = ethers.keccak256(ethers.solidityPacked(
      ["bytes32","address","address","uint256","uint256","bytes32","bytes32","string","uint256"],
      Object.values(args)
    ));
    const ethHash = ethers.hashMessage(ethers.getBytes(hash));
    const sig = await signer.signMessage(ethers.getBytes(hash));
    return ethers.Signature.from(sig);
  }

  beforeEach(async () => {
    [deployer, oracle, volunteer, beneficiary, donor] = await ethers.getSigners();

    const ImpactToken      = await ethers.getContractFactory("ImpactToken");
    const ReputationLedger = await ethers.getContractFactory("ReputationLedger");
    const BenevolenceVault = await ethers.getContractFactory("BenevolenceVault");

    impactToken      = await ImpactToken.deploy(deployer.address);
    reputationLedger = await ReputationLedger.deploy(deployer.address);

    vault = await BenevolenceVault.deploy(
      await impactToken.getAddress(),
      await reputationLedger.getAddress(),
      ethers.ZeroAddress,      // No stablecoin for this test
      oracle.address,
      deployer.address
    );

    // Grant roles
    await impactToken.grantRole(await impactToken.MINTER_ROLE(), await vault.getAddress());
    await reputationLedger.grantRole(await reputationLedger.VAULT_ROLE(), await vault.getAddress());
  });

  it("Should deploy with correct oracle address", async () => {
    expect(await vault.oracleAddress()).to.equal(oracle.address);
  });

  it("Should release reward with valid oracle signature", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const args = {
      eventId:           EVENT_ID,
      volunteerAddress:  volunteer.address,
      beneficiaryAddress: beneficiary.address,
      impactScoreScaled: IMPACT_SCORE,
      tokenRewardWei:    TOKEN_REWARD,
      zkProofHash:       ZK_PROOF,
      eventHash:         EVENT_HASH,
      nonce:             NONCE,
      expiresAt,
    };
    const sig = await signPayload(oracle, args);

    await expect(vault.releaseReward(
      EVENT_ID, volunteer.address, beneficiary.address,
      IMPACT_SCORE, TOKEN_REWARD, ZK_PROOF, EVENT_HASH,
      NONCE, expiresAt, sig.v, sig.r, sig.s
    )).to.emit(vault, "RewardReleased");

    expect(await impactToken.balanceOf(volunteer.address)).to.equal(TOKEN_REWARD);
  });

  it("Should reject invalid oracle signature", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const fakeSig = await signPayload(deployer, {
      eventId: EVENT_ID, volunteerAddress: volunteer.address,
      beneficiaryAddress: beneficiary.address, impactScoreScaled: IMPACT_SCORE,
      tokenRewardWei: TOKEN_REWARD, zkProofHash: ZK_PROOF, eventHash: EVENT_HASH,
      nonce: NONCE, expiresAt,
    });
    await expect(
      vault.releaseReward(
        EVENT_ID, volunteer.address, beneficiary.address,
        IMPACT_SCORE, TOKEN_REWARD, ZK_PROOF, EVENT_HASH,
        NONCE, expiresAt, fakeSig.v, fakeSig.r, fakeSig.s
      )
    ).to.be.revertedWithCustomError(vault, "InvalidOracleSignature");
  });

  it("Should prevent replay attacks (same nonce twice)", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const args = {
      eventId: EVENT_ID, volunteerAddress: volunteer.address,
      beneficiaryAddress: beneficiary.address, impactScoreScaled: IMPACT_SCORE,
      tokenRewardWei: TOKEN_REWARD, zkProofHash: ZK_PROOF, eventHash: EVENT_HASH,
      nonce: NONCE, expiresAt,
    };
    const sig = await signPayload(oracle, args);
    const callArgs = [
      EVENT_ID, volunteer.address, beneficiary.address,
      IMPACT_SCORE, TOKEN_REWARD, ZK_PROOF, EVENT_HASH,
      NONCE, expiresAt, sig.v, sig.r, sig.s
    ];

    await vault.releaseReward(...callArgs);
    await expect(vault.releaseReward(...callArgs))
      .to.be.revertedWithCustomError(vault, "EventAlreadyProcessed");
  });

  it("Should reject expired payloads", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) - 100; // Expired
    const args = {
      eventId: ethers.id("expired-event"), volunteerAddress: volunteer.address,
      beneficiaryAddress: beneficiary.address, impactScoreScaled: IMPACT_SCORE,
      tokenRewardWei: TOKEN_REWARD, zkProofHash: ZK_PROOF, eventHash: EVENT_HASH,
      nonce: "expired-nonce", expiresAt,
    };
    const sig = await signPayload(oracle, args);
    await expect(
      vault.releaseReward(
        ethers.id("expired-event"), volunteer.address, beneficiary.address,
        IMPACT_SCORE, TOKEN_REWARD, ZK_PROOF, EVENT_HASH,
        "expired-nonce", expiresAt, sig.v, sig.r, sig.s
      )
    ).to.be.revertedWithCustomError(vault, "PayloadExpired");
  });

  it("Should reject score below minimum", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const lowScore = 1000; // Below 3000 minimum
    const args = {
      eventId: ethers.id("low-score-event"), volunteerAddress: volunteer.address,
      beneficiaryAddress: beneficiary.address, impactScoreScaled: lowScore,
      tokenRewardWei: TOKEN_REWARD, zkProofHash: ZK_PROOF, eventHash: EVENT_HASH,
      nonce: "low-nonce", expiresAt,
    };
    const sig = await signPayload(oracle, args);
    await expect(
      vault.releaseReward(
        ethers.id("low-score-event"), volunteer.address, beneficiary.address,
        lowScore, TOKEN_REWARD, ZK_PROOF, EVENT_HASH,
        "low-nonce", expiresAt, sig.v, sig.r, sig.s
      )
    ).to.be.revertedWithCustomError(vault, "ScoreBelowMinimum");
  });
});
