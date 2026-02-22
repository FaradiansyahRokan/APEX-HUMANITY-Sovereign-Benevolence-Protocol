import { ethers } from "hardhat";
import { parseUnits } from "ethers";

/**
 * APEX HUMANITY — Full Deployment Script
 * Deploys: GoodToken → ReputationLedger → BenevolenceVault
 * Then wires them together via admin functions.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🚀 Deploying APEX HUMANITY contracts...");
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   Balance:  ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH\n`);

  // ── Config ─────────────────────────────────────────────────────────────────
  const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || deployer.address; // Replace with real oracle address
  const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x0000000000000000000000000000000000000000"; // Set for mainnet

  // ── 1. Deploy GoodToken ────────────────────────────────────────────────────
  console.log("📦 Deploying GoodToken (GOOD)...");
  const GoodToken = await ethers.getContractFactory("GoodToken");
  const goodToken = await GoodToken.deploy(deployer.address);
  await goodToken.waitForDeployment();
  const goodTokenAddress = await goodToken.getAddress();
  console.log(`   ✅ GoodToken deployed: ${goodTokenAddress}`);

  // ── 2. Deploy ReputationLedger ─────────────────────────────────────────────
  console.log("📦 Deploying ReputationLedger...");
  const ReputationLedger = await ethers.getContractFactory("ReputationLedger");
  const reputationLedger = await ReputationLedger.deploy(deployer.address);
  await reputationLedger.waitForDeployment();
  const ledgerAddress = await reputationLedger.getAddress();
  console.log(`   ✅ ReputationLedger deployed: ${ledgerAddress}`);

  // ── 3. Deploy Mock USDC (for testnet only) ─────────────────────────────────
  let stablecoinAddress = USDC_ADDRESS;
  if (USDC_ADDRESS === "0x0000000000000000000000000000000000000000") {
    console.log("📦 Deploying MockUSDC (testnet)...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6, deployer.address);
    await mockUSDC.waitForDeployment();
    stablecoinAddress = await mockUSDC.getAddress();
    console.log(`   ✅ MockUSDC deployed: ${stablecoinAddress}`);

    // Mint initial supply for testing
    await mockUSDC.mint(deployer.address, parseUnits("1000000", 6)); // 1M USDC
    console.log(`   💰 Minted 1,000,000 USDC to deployer`);
  }

  // ── 4. Deploy BenevolenceVault ─────────────────────────────────────────────
  console.log("📦 Deploying BenevolenceVault...");
  const BenevolenceVault = await ethers.getContractFactory("BenevolenceVault");
  const vault = await BenevolenceVault.deploy(
    stablecoinAddress,
    goodTokenAddress,
    ledgerAddress,
    ORACLE_ADDRESS,
    deployer.address
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`   ✅ BenevolenceVault deployed: ${vaultAddress}`);

  // ── 5. Wire contracts together ────────────────────────────────────────────
  console.log("\n🔗 Wiring contracts...");

  // Grant vault MINTER_ROLE on GoodToken
  const MINTER_ROLE = await goodToken.MINTER_ROLE();
  await goodToken.addMinter(vaultAddress);
  console.log(`   ✅ BenevolenceVault granted MINTER_ROLE on GoodToken`);

  // Set vault address on ReputationLedger (one-time, immutable after)
  await reputationLedger.setBenevolenceVault(vaultAddress);
  console.log(`   ✅ BenevolenceVault registered on ReputationLedger`);

  // ── 6. Fund the vault with initial USDC ───────────────────────────────────
  if (USDC_ADDRESS === "0x0000000000000000000000000000000000000000") {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockUSDC = MockERC20.attach(stablecoinAddress) as any;
    const seedAmount = parseUnits("100000", 6); // 100k USDC seed
    await mockUSDC.approve(vaultAddress, seedAmount);
    await vault.donate(seedAmount);
    console.log(`   💰 Seeded vault with 100,000 USDC`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("🎉 APEX HUMANITY DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`  GoodToken (GOOD):      ${goodTokenAddress}`);
  console.log(`  ReputationLedger:      ${ledgerAddress}`);
  console.log(`  BenevolenceVault:      ${vaultAddress}`);
  console.log(`  Stablecoin (USDC):     ${stablecoinAddress}`);
  console.log(`  Oracle Address:        ${ORACLE_ADDRESS}`);
  console.log("=".repeat(60));

  // ── Save deployment artifacts ─────────────────────────────────────────────
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      GoodToken: goodTokenAddress,
      ReputationLedger: ledgerAddress,
      BenevolenceVault: vaultAddress,
      Stablecoin: stablecoinAddress,
    },
    oracle: ORACLE_ADDRESS,
  };

  const fs = await import("fs");
  fs.writeFileSync(
    "./deployments/latest.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\n📄 Deployment saved to ./deployments/latest.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
