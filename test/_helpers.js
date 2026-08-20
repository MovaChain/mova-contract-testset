// Pretty-print helpers shared across the tests so every spec produces a
// table of "before -> after / value" lines instead of just green ticks.
const { ethers, network } = require("hardhat");

function row(label, value) {
  // Indent under the mocha "  ✓ ..." line so output stays aligned.
  console.log(`        · ${label.padEnd(28)} ${value}`);
}

function header(title) {
  console.log(`\n      ── ${title} ─────────────────────────────`);
}

// Send a raw (write) transaction and return its receipt, tolerating reverts.
//
// Many of these probes deliberately exercise paths that may revert (EIP-3860
// over-limit, EIP-3541, OOG, ...). On a live geth/mova node the tx is mined as
// a failed tx; ethers' sendTransaction/estimateGas may throw instead, but the
// thrown error still carries the tx hash, so we recover the receipt either way.
// Pass an explicit gasLimit to bypass estimateGas when you expect a revert.
//
// Automatically retries up to 3 times on transient SocketErrors (stale
// keep-alive connections being closed by the server mid-run).
async function sendRaw(signer, txReq) {
  const isSocketError = (e) =>
    e?.message?.includes("SocketError") ||
    e?.message?.includes("other side closed") ||
    e?.cause?.message?.includes("SocketError") ||
    e?.code === "NETWORK_ERROR" ||
    e?.code === "UND_ERR_SOCKET";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let hash;
      try {
        const sent = await signer.sendTransaction(txReq);
        hash = sent.hash;
        try {
          await sent.wait();
        } catch (_) {
          // wait() rejects on revert — ignore; we inspect the receipt below.
        }
      } catch (e) {
        if (isSocketError(e) && attempt < 3) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
          continue;
        }
        hash =
          e.transactionHash ||
          e.transaction?.hash ||
          e.receipt?.hash ||
          e.receipt?.transactionHash;
        if (!hash) throw e;
      }
      const receipt = await ethers.provider.getTransactionReceipt(hash);
      if (!receipt) throw new Error(`no receipt for tx ${hash}`);
      return receipt;
    } catch (e) {
      if (isSocketError(e) && attempt < 3) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw e;
    }
  }
}

// Like sendRaw, but signs with ethers.Wallet(DEPLOY_PRIVATE_KEY) directly,
// bypassing hardhat's LocalAccountsProvider which uses micro-eth-signer and
// rejects transaction data larger than its internal limit (~32 KB).  Also uses
// the selected hardhat network's RPC URL with a 120-second HTTP timeout so
// undici doesn't time out waiting for headers on large (≥49 KB) request bodies.
async function sendRawLarge(txReq) {
  // The public Hardhat development key is safe only on the dedicated local
  // node. Every remote network still requires an explicit deployment key.
  const key = process.env.DEPLOY_PRIVATE_KEY ||
    (network.name === "localhost"
      ? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
      : undefined);
  if (!key) throw new Error("DEPLOY_PRIVATE_KEY not set for remote network");
  const rpcUrl = network.config.url;
  if (!rpcUrl) {
    throw new Error(`Network "${network.name}" does not define an RPC URL`);
  }

  // Build a JsonRpcProvider with a longer HTTP timeout for large payloads.
  const fetchReq = new ethers.FetchRequest(rpcUrl);
  fetchReq.timeout = 120_000; // ms — undici default is 30 s
  const longProvider = new ethers.JsonRpcProvider(fetchReq, undefined, {
    staticNetwork: true,
  });
  const wallet = new ethers.Wallet(key, longProvider);

  let hash;
  try {
    const sent = await wallet.sendTransaction(txReq);
    hash = sent.hash;
    await sent.wait().catch(() => {});
  } catch (e) {
    hash =
      e.transactionHash ||
      e.transaction?.hash ||
      e.receipt?.hash ||
      e.receipt?.transactionHash;
    if (!hash) throw e;
  }
  // Use the normal (already-connected) provider to fetch the receipt.
  const receipt = await ethers.provider.getTransactionReceipt(hash);
  if (!receipt) throw new Error(`no receipt for tx ${hash}`);
  return receipt;
}

// Convenience: invoke a write method on a contract by name and return the
// receipt. Uses an explicit gasLimit so a revert still produces a receipt
// (the call won't die at eth_estimateGas).
async function writeCall(contract, signer, method, args = [], gasLimit = 3_000_000n) {
  const data = contract.interface.encodeFunctionData(method, args);
  return sendRaw(signer, { to: await contract.getAddress(), data, gasLimit });
}

// Deploy a contract with retry on transient SocketErrors.
// Usage: const contract = await deployWithRetry(factory, [arg1, arg2]);
async function deployWithRetry(factory, args = [], overrides = {}) {
  const isSocketError = (e) =>
    e?.message?.includes("SocketError") ||
    e?.message?.includes("other side closed") ||
    e?.cause?.message?.includes("SocketError") ||
    e?.code === "NETWORK_ERROR" ||
    e?.code === "UND_ERR_SOCKET";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const contract = await factory.deploy(...args, ...(Object.keys(overrides).length ? [overrides] : []));
      await contract.waitForDeployment();
      return contract;
    } catch (e) {
      if (isSocketError(e) && attempt < 3) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw e;
    }
  }
}

module.exports = { row, header, sendRaw, sendRawLarge, writeCall, deployWithRetry };
