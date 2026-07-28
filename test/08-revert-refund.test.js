const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { row, header, deployWithRetry } = require("./_helpers");

// Verifies the new "failed-tx refund" behaviour on top of the upgrade:
// pre-upgrade, a reverting tx burned the full gasLimit; post-upgrade,
// only the gas actually consumed is debited and the rest is refunded.
//
// We send raw transactions through `signer.sendTransaction` and read the
// receipt directly so we never depend on ethers' helpful-but-noisy error
// wrapping (which differs between hardhat and live RPC).
async function sendAndMine(signer, txReq) {
  // On hardhat, sendTransaction throws synchronously when the EVM reverts.
  // The thrown error still carries the hash of the included tx, so we can
  // pull the receipt out either way.
  let hash;
  try {
    const sent = await signer.sendTransaction(txReq);
    hash = sent.hash;
    try {
      await sent.wait();
    } catch (_) {
      // wait() rejects on revert — ignore; we'll inspect the receipt below.
    }
  } catch (e) {
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
}

// Re-runs the tx through debug_traceTransaction and returns the total gas the
// tracer reports. The default struct-logger response is
//   { gas, failed, returnValue, structLogs }
// where `gas` is the total gas used by the transaction. We compare this against
// the receipt's gasUsed to ensure the trace path (noderpc / tracestore on the
// sync node) and the block-execution path agree byte-for-byte on gas.
// Returns null if the node doesn't expose debug_traceTransaction.
async function traceGas(hash) {
  try {
    const res = await ethers.provider.send("debug_traceTransaction", [
      hash,
      // keep the payload small — we only need the top-level gas total.
      { disableStack: true, disableMemory: true, disableStorage: true },
    ]);
    if (res == null) return null;
    const g = res.gas ?? res.gasUsed;
    return g == null ? null : BigInt(g);
  } catch (_) {
    return null;
  }
}

// Asserts the traced gas equals the executed (receipt) gas, or reports that
// tracing is unavailable (e.g. on the in-process hardhat network).
async function expectTraceMatchesExec(hash, receiptGasUsed) {
  const traced = await traceGas(hash);
  if (traced === null) {
    row("trace gas", "debug_traceTransaction unavailable (skipped)");
    return;
  }
  row("trace gas", traced.toString());
  row("receipt gasUsed", receiptGasUsed.toString());
  row("trace == exec", traced === receiptGasUsed);
  expect(traced, "debug_traceTransaction gas must match receipt gasUsed").to.equal(
    receiptGasUsed
  );
}

describe("Refund on failed tx — only consumed gas is charged", function () {
  let probe, addr;

  before(async () => {
    const F = await ethers.getContractFactory("RevertProbe");
    probe = await deployWithRetry(F);
    addr = await probe.getAddress();
  });

  it("revert(): refunds gasLimit − gasUsed", async function () {
    header("revert() refund accounting");
    const [signer] = await ethers.getSigners();

    const data = probe.interface.encodeFunctionData("alwaysRevert");
    const gasLimit = 5_000_000n;

    const before = await ethers.provider.getBalance(signer.address);
    const receipt = await sendAndMine(signer, { to: addr, data, gasLimit });
    const after = await ethers.provider.getBalance(signer.address);

    const debited = before - after;
    const gasUsed = receipt.gasUsed;
    const effPrice = receipt.gasPrice ?? receipt.effectiveGasPrice;
    const expectedFee = gasUsed * effPrice;
    const fullLimitFee = gasLimit * effPrice;

    row("status", receipt.status === 0 ? "REVERTED ✗" : "succeeded");
    row("gasLimit", gasLimit.toString());
    row("gasUsed", gasUsed.toString());
    row("effectiveGasPrice (wei)", effPrice.toString());
    row("debited (wei)", debited.toString());
    row("expected (gasUsed × price)", expectedFee.toString());
    row("pre-upgrade would charge", fullLimitFee.toString());
    row("refund saved (wei)", (fullLimitFee - debited).toString());

    expect(receipt.status).to.equal(0);
    expect(debited).to.equal(expectedFee);
    expect(debited).to.be.lessThan(fullLimitFee);

    // trace gas must equal the gas actually consumed by execution.
    await expectTraceMatchesExec(receipt.hash, gasUsed);
  });

  it("OOG (infinite loop): consumes the full gasLimit (no refund)", async function () {
    // Hardhat's in-process node rejects OOG txs at the provider layer instead
    // of including them in a block, so we cannot inspect a receipt. On a real
    // node (mova / geth / anvil) OOG is mined as a failed tx — that's where
    // this assertion is meaningful. Skip when on hardhat.
    if (network.name === "hardhat") {
      this.skip();
    }
    header("Out-of-gas — no refund");
    const [signer] = await ethers.getSigners();

    const data = probe.interface.encodeFunctionData("burnAllGas");
    const gasLimit = 200_000n;

    const before = await ethers.provider.getBalance(signer.address);
    const receipt = await sendAndMine(signer, { to: addr, data, gasLimit });
    const after = await ethers.provider.getBalance(signer.address);

    const debited = before - after;
    const effPrice = receipt.gasPrice ?? receipt.effectiveGasPrice;

    row("status", receipt.status === 0 ? "REVERTED (OOG) ✗" : "succeeded");
    row("gasLimit", gasLimit.toString());
    row("gasUsed", receipt.gasUsed.toString());
    row("debited (wei)", debited.toString());

    expect(receipt.status).to.equal(0);
    expect(receipt.gasUsed).to.equal(gasLimit);
    expect(debited).to.equal(gasLimit * effPrice);

    // trace gas must equal the gas actually consumed by execution.
    await expectTraceMatchesExec(receipt.hash, receipt.gasUsed);
  });

  it("success tx: only gasUsed is charged (gasLimit − gasUsed refunded); trace matches", async function () {
    if (network.name === "hardhat") {
      this.skip();
    }
    header("success tx — gas accounting + trace");
    const [signer] = await ethers.getSigners();

    const data     = probe.interface.encodeFunctionData("storeValue", [12345n]);
    const gasLimit = 1_000_000n; // deliberately far above actual cost

    const before  = await ethers.provider.getBalance(signer.address);
    const receipt = await sendAndMine(signer, { to: addr, data, gasLimit });
    const after   = await ethers.provider.getBalance(signer.address);

    const debited   = before - after;
    const gasUsed   = receipt.gasUsed;
    const effPrice  = receipt.gasPrice ?? receipt.effectiveGasPrice;
    const expected  = gasUsed * effPrice;
    const fullFee   = gasLimit * effPrice;

    row("status",                    receipt.status === 1 ? "OK ✓" : "FAILED");
    row("gasLimit",                  gasLimit.toString());
    row("gasUsed",                   gasUsed.toString());
    row("effectiveGasPrice (wei)",   effPrice.toString());
    row("debited (wei)",             debited.toString());
    row("expected (gasUsed × price)", expected.toString());
    row("would-charge without fix",  fullFee.toString());
    row("refund saved (wei)",        (fullFee - debited).toString());
    row("gasUsed < gasLimit",        (gasUsed < gasLimit).toString() + " ✓");

    // Verify the stored value was written (tx actually succeeded)
    const stored = await probe.lastStored();
    row("lastStored on-chain",       stored.toString());

    expect(receipt.status).to.equal(1);
    expect(stored).to.equal(12345n);
    expect(debited).to.equal(expected);          // only gasUsed × price charged
    expect(debited).to.be.lessThan(fullFee);     // gasLimit was not fully consumed

    // trace gas must match receipt gasUsed on the success path too
    await expectTraceMatchesExec(receipt.hash, gasUsed);
  });
});
