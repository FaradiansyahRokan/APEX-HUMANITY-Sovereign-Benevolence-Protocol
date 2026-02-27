const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1. Baca otomatis dari file json hasil deploy terbaru
  const deployed = JSON.parse(fs.readFileSync("./deployed-addresses.json", "utf8"));
  const VAULT  = deployed.BenevolenceVault;
  const LEDGER = deployed.ReputationLedger;

  // 2. Variabel ini wajib ada (jangan sampai terhapus)
  const MINTER = "0x0200000000000000000000000000000000000001";
  const VOLUNTEER = deployer.address;

  // ── Test 1: NativeMinter ─────────────────────────────────────────────
  console.log("\n[1] Testing NativeMinter.mintNativeCoin...");
  const minter = await ethers.getContractAt(
    ["function mintNativeCoin(address addr, uint256 amount) external"],
    MINTER
  );
  try {
    await minter.mintNativeCoin.staticCall(VOLUNTEER, ethers.parseEther("50"));
    console.log("    ✅ mintNativeCoin OK");
  } catch(e) {
    console.log("    ❌ mintNativeCoin REVERT:", e.message);
  }

  // ── Test 2: ReputationLedger.updateReputation ────────────────────────
  console.log("\n[2] Testing ReputationLedger.updateReputation...");
  const ledger = await ethers.getContractAt(
    ["function updateReputation(address volunteer, uint256 scoreDelta) returns (uint256)"],
    LEDGER
  );
  try {
    const r = await ledger.updateReputation.staticCall(VOLUNTEER, 10000n);
    console.log("    ✅ updateReputation OK, result:", r.toString());
  } catch(e) {
    console.log("    ❌ updateReputation REVERT:", e.message);
  }

  // ── Test 3: BenevolenceVault full releaseReward simulation ───────────
  console.log("\n[3] Testing BenevolenceVault.releaseReward (static)...");
  const vault = await ethers.getContractAt(
    ["function releaseReward(bytes32,address,address,uint256,uint256,bytes32,bytes32,string,uint256,uint8,bytes32,bytes32) external"],
    VAULT
  );
  // Pakai dummy args untuk melihat apakah error yang dikembalikan sesuai (bukan BAD_DATA)
  try {
    await vault.releaseReward.staticCall(
      "0x00000000000000000000000000000000fac2e943fe9a43c7bb81432c3e2155cf",
      VOLUNTEER, VOLUNTEER,
      10000n, ethers.parseEther("50"),
      "0x44be4a68f296f990846e9456dbc032cf23abaa9a327b5cbebb68d648707a6ae8",
      "0x4db8410f097892fa6906129e6c6e676b927f4a83cad531b4690832327eae9996",
      "5e11d7afdfb34bfba6665d91e8d58a79",
      1771824436n,
      27,
      "0x31bc29676d595d77e14f6262abf3594c32c0f93660bec94774c8e780b900ddba",
      "0x34d25a0cb9769a251a8a04407a1f8508f4680e9b29d66b091f748bcdcc4b5265"
    );
    console.log("    ✅ releaseReward OK");
  } catch(e) {
    console.log("    ❌ releaseReward REVERT:", e.message);
  }
}

main().catch(console.error);