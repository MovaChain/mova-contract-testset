const { ethers, network } = require("hardhat");
const { row } = require("./_helpers");

const DEVELOPMENT_NETWORKS = new Set(["hardhat", "localhost"]);

function getConfiguredAdminAddress() {
  const value = process.env.SYSTEM_ADMIN_ADDRESS;
  if (!value) {
    throw new Error(
      "SYSTEM_ADMIN_ADDRESS must be set when running system-contract tests"
    );
  }
  if (!ethers.isAddress(value)) {
    throw new Error(`SYSTEM_ADMIN_ADDRESS is not a valid address: ${value}`);
  }
  return ethers.getAddress(value);
}

async function attachSystemContract(mochaContext, contractName, address) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    if (DEVELOPMENT_NETWORKS.has(network.name)) {
      row(`${contractName} system address`, `${address} (not installed; skipped)`);
      mochaContext.skip();
    }
    throw new Error(
      `${contractName} has no code at ${address} on network "${network.name}"`
    );
  }

  const [currentUser] = await ethers.getSigners();
  if (!currentUser) {
    throw new Error(`Network "${network.name}" does not provide a test signer`);
  }

  const adminAddress = getConfiguredAdminAddress();
  const currentUserAddress = await currentUser.getAddress();
  const isAdmin = currentUserAddress.toLowerCase() === adminAddress.toLowerCase();
  const contract = await ethers.getContractAt(contractName, address, currentUser);

  row(`${contractName} system address`, address);
  row("current user", currentUserAddress);
  row("configured admin", adminAddress);
  row("test role", isAdmin ? "administrator" : "non-administrator");

  return { contract, currentUser, currentUserAddress, adminAddress, isAdmin };
}

module.exports = { attachSystemContract };
