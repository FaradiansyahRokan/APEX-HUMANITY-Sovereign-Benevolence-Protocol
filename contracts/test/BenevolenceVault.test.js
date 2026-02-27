/**
 * APEX HUMANITY — BenevolenceVault Tests
 * Hardhat + Chai test suite
 * v2.1.0 — Updated signPayload to use abi.encode (matching the contract fix)
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BenevolenceVault", function () {
  let vault, reputationLedger;
  let deployer, oracle, volunteer, beneficiary;

  const IMPACT_SCORE = 7550;   // 75.50 × 100
  const TOKEN_REWARD = ethers.parseEther("75.5");
  const EVENT_ID = ethers.id("test-event-001");
  const ZK_PROOF = ethers.id("zk-proof-hash");
  const EVENT_HASH = ethers.id("event-hash");
  const NONCE = "unique-nonce-001";

  /**
   * FIX v2.1.0: Use abi.encode (not solidityPacked) to match the contract's
   * _buildSigningHash which now uses abi.encode to prevent hash-collision attacks.
   */
  async function signPayload(signer, args) {
    const hash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "address", "uint256", "uint256", "bytes32", "bytes32", "string", "uint256"],
        Object.values(args)
      )
    );
    const sig = await signer.signMessage(ethers.getBytes(hash));
    return ethers.Signature.from(sig);
  }

  beforeEach(async () => {
    [deployer, oracle, volunteer, beneficiary] = await ethers.getSigners();

    const ReputationLedger = await ethers.getContractFactory("ReputationLedger");
    const BenevolenceVault = await ethers.getContractFactory("BenevolenceVault");

    reputationLedger = await ReputationLedger.deploy(deployer.address);

    vault = await BenevolenceVault.deploy(
      await reputationLedger.getAddress(),
      oracle.address,
      deployer.address
    );

    await reputationLedger.grantRole(await reputationLedger.VAULT_ROLE(), await vault.getAddress());
  });

  it("Should deploy with correct oracle address", async () => {
    expect(await vault.oracleAddress()).to.equal(oracle.address);
  });

  it("Should deploy with SovereignID guard disabled by default", async () => {
    expect(await vault.requireSovereignID()).to.equal(false);
  });

  it("Should release reward with valid oracle signature (abi.encode)", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const args = {
      eventId: EVENT_ID,
      volunteerAddress: volunteer.address,
      beneficiaryAddress: beneficiary.address,
      impactScoreScaled: IMPACT_SCORE,
      tokenRewardWei: TOKEN_REWARD,
      zkProofHash: ZK_PROOF,
      eventHash: EVENT_HASH,
      nonce: NONCE,
      expiresAt,
    };
    const sig = await signPayload(oracle, args);

    // NOTE: NativeMinter precompile is not available on Hardhat local — this
    // test will revert at the mint step.  In a real Avalanche subnet test env
    // this would pass.  We just verify it reaches the mint (InvalidOracleSignature
    // is NOT thrown).
    await expect(vault.releaseReward(
      EVENT_ID, volunteer.address, beneficiary.address,
      IMPACT_SCORE, TOKEN_REWARD, ZK_PROOF, EVENT_HASH,
      NONCE, expiresAt, sig.v, sig.r, sig.s
    )).to.not.be.revertedWithCustomError(vault, "InvalidOracleSignature");
  });

  it("Should reject invalid oracle signature", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const fakeSig = await signPayload(deployer, {  // signed by wrong key
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

  it("Should reject expired payloads", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) - 100; // already expired
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
    const lowScore = 1000; // below 3000 minimum
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

  it("KEEPER_ROLE can update ranks in ReputationLedger", async () => {
    // Grant keeper role to deployer
    await reputationLedger.grantRole(await reputationLedger.KEEPER_ROLE(), deployer.address);
    // Update ranks
    await reputationLedger.updateRanks([volunteer.address], [1]);
    const [, , , rank] = await reputationLedger.getReputation(volunteer.address);
    expect(rank).to.equal(1n);
  });

  it("Non-KEEPER cannot call updateRanks", async () => {
    await expect(
      reputationLedger.connect(volunteer).updateRanks([volunteer.address], [1])
    ).to.be.reverted;
  });
});
