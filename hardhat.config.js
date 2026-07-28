require("@nomicfoundation/hardhat-toolbox");

require("dotenv").config()
const PRIV = process.env.PRIV_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";


// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners()

  for (const account of accounts) {
    console.log(account.address)
  }
})

// Define mnemonic for accounts.
let mnemonic = process.env.MNEMONIC
if (!mnemonic) {
  // NOTE: this fallback is for development only!
  // When using other networks, set the secret in .env.
  // DO NOT commit or share your mnemonic with others!
  mnemonic = "test test test test test test test test test test test junk"
}

// contract owner: 0x9f8fb0488dE145E7467FDeD872098e1115d6ea4C
// contract admin: 0x9f8fb0488dE145E7467FDeD872098e1115d6ea4C
// const fs = require('fs');
// const mnemonic = fs.readFileSync(".secret").toString().trim();
const privateKey = process.env.DEPLOY_PRIVATE_KEY
const accounts = { mnemonic }
const remoteAccounts = privateKey ? [privateKey] : []

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.36",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "osaka",
        },
      },
    ],
  },
  networks: {
    hardhat: {
      accounts,
      hardfork: "osaka",
      initialBaseFeePerGas: 1_000_000_000,
      // Keep failed transactions observable through their receipts, matching
      // the behaviour expected from a testnet or mainnet JSON-RPC endpoint.
      throwOnTransactionFailures: false,
    },
    // Run `npm run node` in one terminal, then `npm run test:node` in another.
    // The node inherits the `hardhat` network's Osaka execution rules above.
    localhost: {
      url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
      accounts,
      timeout: 120_000,
    },
    local: {
      url: process.env.RPC_URL || "http://13.215.139.94:26660",
      accounts: remoteAccounts,
      timeout: 120_000,
    },
    origin: {
      url: process.env.RPC_URL || "http://13.215.139.94:26658",
      accounts: remoteAccounts,
      timeout: 120_000,
    },
    mova: {
      url: "http://13.229.88.173:26658",
      accounts: remoteAccounts,
      timeout: 120_000,
    },
  },
  mocha: {
    timeout: 120_000,
    reporter: "spec",
  },
};
