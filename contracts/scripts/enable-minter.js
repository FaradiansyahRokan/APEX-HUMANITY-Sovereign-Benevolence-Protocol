const { ethers } = require("hardhat");

async function main() {
  // Alamat sakti Precompile Native Minter di Avalanche
  const minterAddress = "0x0200000000000000000000000000000000000001";
  
  // Alamat Vault lu yang baru
  const vaultAddress = "0x74736ecAfdb001267f13Cd7314c512677B9cd465";

  // ABI khusus buat ngasih akses Enabled
  const MinterABI = ["function setEnabled(address addr) external"];
  
  // Ambil akun lu yang jadi Admin (0x24...)
  const [admin] = await ethers.getSigners();
  const minterContract = new ethers.Contract(minterAddress, MinterABI, admin);

  console.log("Mendaftarkan Vault ke Native Minter Precompile...");
  
  // Admin memberikan akses ke Vault
  const tx = await minterContract.setEnabled(vaultAddress);
  await tx.wait();

  console.log("🔥 SUKSES! Vault sekarang punya izin resmi untuk mencetak APEX L1!");
}

main().catch((error) => {
  console.error("Gagal:", error);
  process.exitCode = 1;
});