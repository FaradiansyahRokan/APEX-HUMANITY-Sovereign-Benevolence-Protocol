require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "shanghai", // ← WAJIB untuk Avalanche Subnet-EVM
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },

    // ─── APEX NETWORK (L1 Sovereign) ─────────────────────────────────────────
    apex_local: {
  url: "http://127.0.0.1:9654/ext/bc/2hGMsKi551C3hgc27H3ryiktbdJmbNxujbXZ7u1NprGLN7Aupi/rpc",
  chainId: 6969,
  accounts: process.env.APEX_ADMIN_PRIVATE_KEY ? [process.env.APEX_ADMIN_PRIVATE_KEY] : [],
  gasPrice: 25000000000,
  gas: 8000000,
},
    // ─────────────────────────────────────────────────────────────────────────

    polygon_mumbai: {
      url: process.env.POLYGON_MUMBAI_RPC || "https://rpc-mumbai.maticvigil.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId: 80001,
    },
    polygon_mainnet: {
      url: process.env.POLYGON_MAINNET_RPC || "https://polygon-rpc.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId: 137,
    },
    arbitrum_sepolia: {
      url: process.env.ARB_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId: 421614,
    },
  },
  etherscan: {
    apiKey: {
      polygon:       process.env.POLYGONSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    token: "MATIC",
  },
  paths: {
    sources:   "./src",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};