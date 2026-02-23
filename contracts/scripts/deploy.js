const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance    = await ethers.provider.getBalance(deployer.address);

  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║     APEX HUMANITY — Contract Deployment v2.0          ║");
  console.log("║     Native Token Minting (GOOD = L1 Coin)             ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log("Deployer: ", deployer.address);
  console.log("Balance:  ", ethers.formatEther(balance), "GOOD\n");

  // ── 1. ReputationLedger ──────────────────────────────────────────────────
  console.log("1/3 Deploying ReputationLedger...");
  const ReputationLedger = await ethers.getContractFactory("ReputationLedger");
  const reputationLedger = await ReputationLedger.deploy(deployer.address);
  await reputationLedger.waitForDeployment();
  console.log("   ✅ ReputationLedger: ", await reputationLedger.getAddress());

  // ── 2. SovereignID ───────────────────────────────────────────────────────
  console.log("2/3 Deploying SovereignID...");
  const SovereignID = await ethers.getContractFactory("SovereignID");
  const sovereignID = await SovereignID.deploy(deployer.address, await reputationLedger.getAddress())
  await sovereignID.waitForDeployment();
  console.log("   ✅ SovereignID:      ", await sovereignID.getAddress());

  // ── 3. BenevolenceVault (Native Minter) ─────────────────────────────────
  console.log("3/3 Deploying BenevolenceVault (NativeMinter)...");
  const BenevolenceVault = await ethers.getContractFactory("BenevolenceVault");
  const benevolenceVault = await BenevolenceVault.deploy(
    await reputationLedger.getAddress(),  // _reputationLedger
    deployer.address,                      // _oracleAddress (ganti nanti dengan oracle address)
    deployer.address                       // _daoAdmin
  );
  await benevolenceVault.waitForDeployment();
  console.log("   ✅ BenevolenceVault: ", await benevolenceVault.getAddress());

  // ── 4. Grant Roles ───────────────────────────────────────────────────────
  console.log("\n4/4 Configuring roles...");
  const VAULT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VAULT_ROLE"));
  await reputationLedger.grantRole(VAULT_ROLE, await benevolenceVault.getAddress());
  console.log("   ✅ VAULT_ROLE granted to BenevolenceVault on ReputationLedger");

  // ── Summary ──────────────────────────────────────────────────────────────
  const addresses = {
    ReputationLedger: await reputationLedger.getAddress(),
    SovereignID:      await sovereignID.getAddress(),
    BenevolenceVault: await benevolenceVault.getAddress(),
    OracleAddress:    deployer.address,
    DeployedAt:       new Date().toISOString(),
    Network:          "apex_local",
    ChainId:          (await ethers.provider.getNetwork()).chainId.toString(),
    Note:             "ImpactToken removed — GOOD is now native L1 coin minted via NativeMinter precompile",
  };

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║              DEPLOYMENT COMPLETE ✅                   ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(JSON.stringify(addresses, null, 2));

  fs.writeFileSync("./deployed-addresses.json", JSON.stringify(addresses, null, 2));
  console.log("\n📁 Addresses saved to ./deployed-addresses.json");
  console.log("\n⚠️  PENTING: Update oracle address di BenevolenceVault setelah oracle server jalan:");
  console.log("   npx hardhat run scripts/set-oracle.js --network apex_local");
}

main().catch((e) => { console.error(e); process.exit(1); });