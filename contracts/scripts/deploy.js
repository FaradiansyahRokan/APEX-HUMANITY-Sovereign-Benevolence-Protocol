/**
 * APEX HUMANITY — Deployment Script (Hardhat)
 * Deploys all contracts in the correct dependency order.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network polygon_mumbai
 *   npx hardhat run scripts/deploy.js --network localhost
 */

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║     APEX HUMANITY — Contract Deployment               ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH\n`);

  // ── Step 1: Deploy ImpactToken ─────────────────────────────────────────────
  console.log("1/5 Deploying ImpactToken (APEX)...");
  const ImpactToken = await ethers.getContractFactory("ImpactToken");
  const impactToken = await ImpactToken.deploy(deployer.address);
  await impactToken.waitForDeployment();
  console.log(`   ✅ ImpactToken:       ${await impactToken.getAddress()}`);

  // ── Step 2: Deploy ReputationLedger ───────────────────────────────────────
  console.log("2/5 Deploying ReputationLedger...");
  const ReputationLedger = await ethers.getContractFactory("ReputationLedger");
  const reputationLedger = await ReputationLedger.deploy(deployer.address);
  await reputationLedger.waitForDeployment();
  console.log(`   ✅ ReputationLedger:  ${await reputationLedger.getAddress()}`);

  // ── Step 3: Deploy SovereignID ────────────────────────────────────────────
  console.log("3/5 Deploying SovereignID...");
  const SovereignID = await ethers.getContractFactory("SovereignID");
  const sovereignID = await SovereignID.deploy(
    deployer.address,
    await reputationLedger.getAddress()
  );
  await sovereignID.waitForDeployment();
  console.log(`   ✅ SovereignID:       ${await sovereignID.getAddress()}`);

  // ── Step 4: Deploy BenevolenceVault ───────────────────────────────────────
  // For testnet: use a mock USDC or deploy a test ERC-20
  const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || deployer.address;

  console.log("4/5 Deploying MockUSDC...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
  await mockUSDC.waitForDeployment();
  const STABLECOIN_ADDRESS = await mockUSDC.getAddress();
  console.log(`   ✅ MockUSDC:          ${STABLECOIN_ADDRESS}`);

  

  console.log("4/5 Deploying BenevolenceVault...");
  const BenevolenceVault = await ethers.getContractFactory("BenevolenceVault");
  const vault = await BenevolenceVault.deploy(
    await impactToken.getAddress(),
    await reputationLedger.getAddress(),
    STABLECOIN_ADDRESS,
    ORACLE_ADDRESS,
    deployer.address
  );
  await vault.waitForDeployment();
  console.log(`   ✅ BenevolenceVault:  ${await vault.getAddress()}`);

  // ── Step 5: Wire Permissions ───────────────────────────────────────────────
  console.log("5/5 Configuring roles and permissions...");

  const MINTER_ROLE = await impactToken.MINTER_ROLE();
  const VAULT_ROLE  = await reputationLedger.VAULT_ROLE();

  await (await impactToken.grantRole(MINTER_ROLE, await vault.getAddress())).wait();
  console.log(`   ✅ MINTER_ROLE granted to BenevolenceVault on ImpactToken`);

  await (await reputationLedger.grantRole(VAULT_ROLE, await vault.getAddress())).wait();
  console.log(`   ✅ VAULT_ROLE granted to BenevolenceVault on ReputationLedger`);

  // ── Deployment Summary ────────────────────────────────────────────────────
  const deployedAddresses = {
    ImpactToken:       await impactToken.getAddress(),
    ReputationLedger:  await reputationLedger.getAddress(),
    SovereignID:       await sovereignID.getAddress(),
    BenevolenceVault:  await vault.getAddress(),
    OracleAddress:     ORACLE_ADDRESS,
    DeployedAt:        new Date().toISOString(),
    Network:           (await ethers.provider.getNetwork()).name,
    ChainId:           String((await ethers.provider.getNetwork()).chainId),
  };

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║              DEPLOYMENT COMPLETE ✅                   ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(JSON.stringify(deployedAddresses, null, 2));

  // Save to file for frontend use
  const fs = require("fs");
  fs.writeFileSync(
    "./deployed-addresses.json",
    JSON.stringify(deployedAddresses, null, 2)
  );
  console.log("\n📁 Addresses saved to ./deployed-addresses.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
