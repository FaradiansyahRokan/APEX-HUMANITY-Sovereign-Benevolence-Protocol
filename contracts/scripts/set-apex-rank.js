const hre = require("hardhat");

async function main() {
    const [admin] = await hre.ethers.getSigners();

    // Alamat Dompet yang mau di-cheat / diangkat pangkatnya jadi APEX
    const targetAddress = "0x881C46B5eBd520E045CD932190fB2F055AdF81dF"; // <- Bisa diganti ke alamat MetaMask siapa pun
    const bonusScore = 1500000; // Skor minimal APEX adalah 10,000

    console.log("🔥 Menginisialisasi Jalur Belakang Admin...");
    const ledgerAddress = process.env.REPUTATION_LEDGER_ADDRESS;
    const Ledger = await hre.ethers.getContractFactory("ReputationLedger");
    const ledger = Ledger.attach(ledgerAddress);

    // 1. Cek VAULT_ROLE (Siapa yang boleh nambah skor)
    const VAULT_ROLE = await ledger.VAULT_ROLE();
    const hasRole = await ledger.hasRole(VAULT_ROLE, admin.address);

    if (!hasRole) {
        console.log("🔐 Memberikan akses VAULT_ROLE sementara ke Admin...");
        const txGrant = await ledger.grantRole(VAULT_ROLE, admin.address);
        await txGrant.wait();
        console.log("✅ Akses VAULT_ROLE berhasil diberikan!");
    }

    // 2. Beri Skor (Update Reputation)
    console.log(`⚡ Mengirimkan ${bonusScore} poin reputasi (Pangkat APEX) ke ${targetAddress}...`);

    // Kita bikin event hash "dummy" / palsu khusus admin, harus unik tiap kali jalanin
    const adminEventHash = hre.ethers.id("ADMIN_CHEAT_CODE_" + Date.now());

    const txUpdate = await ledger.updateReputation(targetAddress, bonusScore, adminEventHash);
    await txUpdate.wait();

    console.log(`🎉 SUKSES! Target ${targetAddress} sekarang resmi berpangkat APEX (Skor: ${bonusScore}).`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
