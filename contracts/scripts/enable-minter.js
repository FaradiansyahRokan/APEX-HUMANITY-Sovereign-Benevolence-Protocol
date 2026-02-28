const { ethers } = require("hardhat");

async function main() {
  // Alamat sakti Precompile Native Minter di Avalanche
  const minterAddress = "0x0200000000000000000000000000000000000001";

  // Alamat Vault lu yang baru
  const vaultAddress = "0x13f0b24F7E9246877d0De8925C884d72EBd57b5f";

  // ABI khusus buat ngasih akses Enabled
  const MinterABI = ["function setEnabled(address addr) external"];

  // Ambil akun lu yang jadi Admin (0x24...)
  const [admin] = await ethers.getSigners();

  if (!admin) {
    throw new Error("Admin signer is undefined! Check your .env file or hardhat.config.js.");
  }

  // Gunakan getContractAt untuk mengikat signer dengan benar di Ethers v6
  const minterContract = await ethers.getContractAt(MinterABI, minterAddress, admin);

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