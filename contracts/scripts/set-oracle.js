/**
 * APEX HUMANITY — Set Oracle Address
 * 
 * Run AFTER oracle server is running:
 *   npx hardhat run scripts/set-oracle.js --network apex_local
 *
 * What it does:
 *   1. Reads oracle_address from GET /health on the oracle server
 *   2. Compares with current oracleAddress() stored in BenevolenceVault
 *   3. If different → calls setOracleAddress() to update it
 *   4. Verifies the update was applied correctly
 */

const { ethers } = require("hardhat");
const fs         = require("fs");

// ── Config ────────────────────────────────────────────────────────────────────
const ORACLE_URL = process.env.NEXT_PUBLIC_ORACLE_URL || "http://localhost:8000";
const API_KEY    = process.env.NEXT_PUBLIC_SATIN_API_KEY || process.env.ORACLE_API_KEY || "apex-dev-key-change-in-prod";

// Load deployed addresses
let VAULT_ADDRESS;
try {
  const deployed = JSON.parse(fs.readFileSync("./deployed-addresses.json", "utf8"));
  VAULT_ADDRESS  = deployed.BenevolenceVault;
} catch {
  // Fallback to env or hardcoded from constants.ts
  VAULT_ADDRESS = process.env.BENEVOLENCE_VAULT_ADDRESS ||
                  "0x13f0b24F7E9246877d0De8925C884d72EBd57b5f";
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║     APEX HUMANITY — Set Oracle Address                ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(`Admin:          ${admin.address}`);
  console.log(`BenevolenceVault: ${VAULT_ADDRESS}`);
  console.log(`Oracle URL:     ${ORACLE_URL}\n`);

  // ── Step 1: Get oracle address from running server ─────────────────────────
  console.log("1/4 Fetching oracle address from SATIN server...");
  let serverOracleAddress;
  try {
    const resp = await fetch(`${ORACLE_URL}/health`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    serverOracleAddress = data.oracle_address;
    console.log(`   ✅ Server oracle address: ${serverOracleAddress}`);
  } catch (e) {
    console.error(`   ❌ Cannot reach oracle server at ${ORACLE_URL}/health`);
    console.error(`      Error: ${e.message}`);
    console.error(`      Make sure oracle server is running: uvicorn main:app --reload`);
    process.exit(1);
  }

  // ── Step 2: Get current oracle address from contract ──────────────────────
  console.log("2/4 Reading current oracle address from BenevolenceVault...");
  const vault = await ethers.getContractAt("BenevolenceVault", VAULT_ADDRESS);
  const contractOracleAddress = await vault.oracleAddress();
  console.log(`   Current contract oracle: ${contractOracleAddress}`);

  // ── Step 3: Compare and update if different ────────────────────────────────
  const normalise = (addr) => addr.toLowerCase();

  if (normalise(contractOracleAddress) === normalise(serverOracleAddress)) {
    console.log("3/4 ✅ Oracle address already matches — no update needed.");
  } else {
    console.log(`3/4 ⚠️  Mismatch detected! Updating oracle address...`);
    console.log(`        Old: ${contractOracleAddress}`);
    console.log(`        New: ${serverOracleAddress}`);

    // Check admin has DAO_ADMIN_ROLE
    const DAO_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DAO_ADMIN_ROLE"));
    const hasRole        = await vault.hasRole(DAO_ADMIN_ROLE, admin.address);
    if (!hasRole) {
      console.error(`   ❌ Admin ${admin.address} does not have DAO_ADMIN_ROLE`);
      console.error(`      Deploy was done with a different account, or role was revoked.`);
      process.exit(1);
    }

    const tx = await vault.setOracleAddress(serverOracleAddress);
    console.log(`   TX submitted: ${tx.hash}`);
    await tx.wait();
    console.log(`   ✅ Oracle address updated on-chain.`);
  }

  // ── Step 4: Final verification ─────────────────────────────────────────────
  console.log("4/4 Verifying final state...");
  const finalOracle = await vault.oracleAddress();
  const match = normalise(finalOracle) === normalise(serverOracleAddress);

  console.log(`   Contract oracleAddress():  ${finalOracle}`);
  console.log(`   Server oracle_address:     ${serverOracleAddress}`);
  console.log(`   Match: ${match ? "✅ YES" : "❌ NO — something went wrong"}`);

  if (!match) process.exit(1);

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║  Oracle address verified. System ready to accept TXes ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
}

main().catch((e) => { console.error(e); process.exit(1); });