const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

// All block-context values MUST be captured during real block execution. A
// read-only eth_call can surface different (often zero) values than an
// actually-mined transaction, because mova's consensus/sync nodes only inject
// the block context (BASEFEE fallback, PREVRANDAO from Tendermint
// LastCommitHash, coinbase from proposer, etc.) on the execution path.
//
// We send capture() with an EXPLICIT gasLimit to avoid the estimateGas
// binary-search + EIP-3529-refund interaction (see comment in contract).
const CAPTURE_GAS = 500_000n; // generous — charged only gasUsed

describe("Block environment variables — captured in a mined tx", function () {
  let probe;
  let signer;

  // Capture block context once before all assertions.
  let captured; // { number, timestamp, baseFee, prevrandao, gasLimit, chainId, coinbase, blockHash }

  before(async () => {
    [signer] = await ethers.getSigners();
    const F = await ethers.getContractFactory("BlockEnvProbe");
    probe = await deployWithRetry(F);

    // Capture block context inside a real tx.
    const rcpt = await writeCall(probe, signer, "capture", [], CAPTURE_GAS);
    expect(rcpt.status, "capture tx must succeed").to.equal(1);

    captured = {
      number:    await probe.lastNumber(),
      timestamp: await probe.lastTimestamp(),
      baseFee:   await probe.lastBaseFee(),
      prevrandao:await probe.lastPrevrandao(),
      gasLimit:  await probe.lastGasLimit(),
      chainId:   await probe.lastChainId(),
      coinbase:  await probe.lastCoinbase(),
      blockHash: await probe.lastBlockHash(),
    };
  });

  // ── block.number ────────────────────────────────────────────────────────
  it("block.number — is non-zero on a running chain", async function () {
    header("block.number");
    row("captured block.number", captured.number.toString());
    expect(captured.number).to.be.greaterThan(0n);
  });

  // ── block.timestamp ─────────────────────────────────────────────────────
  it("block.timestamp — is a plausible recent Unix timestamp", async function () {
    header("block.timestamp");
    row("captured block.timestamp", captured.timestamp.toString());
    row("as UTC date", new Date(Number(captured.timestamp) * 1000).toISOString());
    // Must be after 2024-01-01 (= 1704067200) and not in the far future.
    const MIN_TS = 1_704_067_200n; // 2024-01-01 UTC
    const MAX_TS = BigInt(Math.floor(Date.now() / 1000) + 3600); // now + 1 h slack
    expect(captured.timestamp).to.be.greaterThan(MIN_TS);
    expect(captured.timestamp).to.be.lessThan(MAX_TS);
  });

  // ── block.basefee (EIP-3198) ─────────────────────────────────────────────
  it("block.basefee — is non-zero (EIP-3198, DefaultGasPrice fallback)", async function () {
    header("block.basefee  (EIP-3198)");
    row("captured block.basefee (wei)", captured.baseFee.toString());
    row("in gwei", (captured.baseFee / 1_000_000_000n).toString());
    expect(captured.baseFee).to.be.greaterThan(0n);
  });

  // ── block.prevrandao (EIP-4399) ──────────────────────────────────────────
  it("block.prevrandao — non-zero and changes across blocks (EIP-4399)", async function () {
    header("block.prevrandao  (EIP-4399)");
    row("PREVRANDAO sample 1", "0x" + captured.prevrandao.toString(16).padStart(64, "0"));

    // Advance to a new block on hardhat; live nodes mine automatically.
    if (network.name === "hardhat") {
      await network.provider.send("evm_mine");
    }

    // Capture a second time in a new block.
    await writeCall(probe, signer, "capture", [], CAPTURE_GAS);
    const v2 = await probe.lastPrevrandao();
    const b2 = await probe.lastNumber();
    row("PREVRANDAO sample 2", "0x" + v2.toString(16).padStart(64, "0"));
    row("block advanced", `${captured.number} → ${b2}`);
    row("changed across blocks", (captured.prevrandao !== v2).toString());

    // On a live mova chain PREVRANDAO comes from Tendermint LastCommitHash —
    // always non-zero and unique each block.
    if (network.name !== "hardhat") {
      expect(captured.prevrandao).to.not.equal(0n);
      expect(v2).to.not.equal(0n);
      expect(captured.prevrandao).to.not.equal(v2);
    }
  });

  // ── block.gaslimit ───────────────────────────────────────────────────────
  it("block.gaslimit — is positive", async function () {
    header("block.gaslimit");
    row("captured block.gaslimit", captured.gasLimit.toString());
    expect(captured.gasLimit).to.be.greaterThan(0n);
  });

  // ── block.chainid ────────────────────────────────────────────────────────
  it("block.chainid — matches eth_chainId RPC and is > 0", async function () {
    header("block.chainid");
    row("captured block.chainid", captured.chainId.toString());
    const rpcChainId = (await ethers.provider.getNetwork()).chainId;
    row("eth_chainId  (RPC)", rpcChainId.toString());
    expect(captured.chainId).to.be.greaterThan(0n);
    expect(captured.chainId).to.equal(rpcChainId);
  });

  // ── block.coinbase ───────────────────────────────────────────────────────
  it("block.coinbase — proposer address (may be zero on Tendermint chains)", async function () {
    header("block.coinbase");
    row("captured block.coinbase", captured.coinbase);
    // On mova (Tendermint-based chain) the EVM coinbase field is NOT populated
    // with the proposer's Ethereum address — the chain leaves it as address(0).
    // This is a known characteristic: Tendermint block headers carry validator
    // addresses in a different format and the EVM context bridge does not map
    // them to an Ethereum address. We document the value without asserting ≠ 0.
    row("note", captured.coinbase === ethers.ZeroAddress
      ? "zero (Tendermint bridge does not map proposer to ETH addr)"
      : "non-zero proposer set");
    // No assertion — the value is chain-dependent.
  });

  // ── blockhash ────────────────────────────────────────────────────────────
  it("blockhash(n-1) — non-zero for a recent block", async function () {
    header("blockhash(block.number - 1)");
    row("captured blockhash", captured.blockHash);
    row("at block", captured.number.toString());
    // The EVM stores the 256 most-recent block hashes; block.number - 1 is
    // always within that window.
    const ZERO_HASH = "0x" + "00".repeat(32);
    if (network.name !== "hardhat") {
      expect(captured.blockHash).to.not.equal(ZERO_HASH);
    } else {
      // Hardhat returns 0 for blockhash in some configurations; just log.
      row("(hardhat blockhash may be zero)", "skip assertion");
    }
  });
});
