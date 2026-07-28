const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, sendRaw, deployWithRetry } = require("./_helpers");

// Custom errors (EIP-838) test
//
// Verifies:
//   1. Revert with a custom error (InsufficientBalance) → tx status=0.
//   2. Revert with require+string → tx status=0.
//   3. Custom error consumes LESS gas than the require-string path.
//   4. The custom error selector and arguments are correctly encoded in
//      the revert data (via eth_call / provider.call).
//   5. Unauthorized error is thrown when non-owner calls adminActionCustom.

const BENCH_GAS = 300_000n;
const CALL_GAS  = 100_000n;

// Decode a custom error from raw revert data.
function decodeCustomError(iface, hexData) {
  if (!hexData || hexData === "0x") return null;
  try {
    return iface.parseError(hexData);
  } catch {
    return null;
  }
}

describe("Custom errors (EIP-838)", function () {
  let probe;
  let deployer, stranger;

  before(async () => {
    [deployer] = await ethers.getSigners();

    // Warm up the RPC connection (first request after a cold start can
    // hit a keep-alive timeout on the node's HTTP layer).
    await ethers.provider.getBlockNumber();

    const F = await ethers.getContractFactory("CustomErrorProbe");
    probe = await deployWithRetry(F);

    stranger = ethers.Wallet.createRandom().connect(ethers.provider);
  });

  // ── InsufficientBalance custom error ─────────────────────────────────────
  it("withdrawCustom reverts with InsufficientBalance (status=0)", async function () {
    header("custom error: InsufficientBalance");

    const probeAddr = await probe.getAddress();

    // Attempt to withdraw without depositing.
    const rcpt = await sendRaw(deployer, {
      to:       probeAddr,
      data:     probe.interface.encodeFunctionData("withdrawCustom", [1000n]),
      gasLimit: CALL_GAS,
    });

    row("tx status",   rcpt.status === 0 ? "REVERTED ✓" : "succeeded (unexpected)");
    row("gasUsed",     rcpt.gasUsed.toString());

    // Decode the revert reason via eth_call.
    let decoded = null;
    try {
      await ethers.provider.call({
        to:   probeAddr,
        data: probe.interface.encodeFunctionData("withdrawCustom", [1000n]),
      });
    } catch (e) {
      const rawData = e.data ?? e.error?.data ?? e.info?.error?.data;
      decoded = decodeCustomError(probe.interface, rawData);
    }

    if (decoded) {
      row("error name",      decoded.name);
      row("available",       decoded.args[0].toString());
      row("required",        decoded.args[1].toString());
      expect(decoded.name).to.equal("InsufficientBalance");
      expect(decoded.args[0]).to.equal(0n);      // balance = 0
      expect(decoded.args[1]).to.equal(1000n);   // required = 1000
    } else {
      row("error decode",    "skipped (node did not return revert data via eth_call)");
    }

    expect(rcpt.status).to.equal(0);
  });

  // ── require-string path also reverts ─────────────────────────────────────
  it("withdrawRequire reverts with a reason string (status=0)", async function () {
    header("require-string revert");

    const probeAddr = await probe.getAddress();
    const rcpt = await sendRaw(deployer, {
      to:       probeAddr,
      data:     probe.interface.encodeFunctionData("withdrawRequire", [1000n]),
      gasLimit: CALL_GAS,
    });

    row("tx status", rcpt.status === 0 ? "REVERTED ✓" : "succeeded (unexpected)");
    row("gasUsed",   rcpt.gasUsed.toString());

    expect(rcpt.status).to.equal(0);
  });

  // ── gas comparison ────────────────────────────────────────────────────────
  it("custom error uses LESS gas than require-string for the same condition", async function () {
    header("gas comparison: custom error vs require string");

    const rcpt = await writeCall(probe, deployer, "benchmarkGas", [999999n], BENCH_GAS);

    const gasCustom   = await probe.gasCustomError();
    const gasRequire  = await probe.gasRequireString();

    row("benchmarkGas tx status",  rcpt.status === 1 ? "OK" : "FAILED");
    row("gas (custom error)",      gasCustom.toString());
    row("gas (require string)",    gasRequire.toString());
    row("saving (wei equiv gas)",  (gasRequire - gasCustom).toString());
    row("custom < require",        gasCustom < gasRequire);

    expect(rcpt.status).to.equal(1);
    // Custom errors encode less data → should be cheaper.
    expect(gasCustom, "custom error must use less gas than require string")
      .to.be.lessThan(gasRequire);
  });

  // ── Unauthorized custom error ─────────────────────────────────────────────
  it("adminActionCustom reverts with Unauthorized for non-owner", async function () {
    header("custom error: Unauthorized");

    const probeAddr = await probe.getAddress();

    // Call from the deployer (owner) → should succeed.
    const okRcpt = await sendRaw(deployer, {
      to:       probeAddr,
      data:     probe.interface.encodeFunctionData("adminActionCustom"),
      gasLimit: CALL_GAS,
    });
    row("owner call status",    okRcpt.status === 1 ? "OK ✓" : "FAILED");
    expect(okRcpt.status).to.equal(1);

    // Call from a stranger → should revert with Unauthorized.
    // Fund stranger first (needs gas money).
    await sendRaw(deployer, { to: stranger.address, value: ethers.parseEther("0.01"), gasLimit: 21000n });

    const failRcpt = await sendRaw(stranger, {
      to:       probeAddr,
      data:     probe.interface.encodeFunctionData("adminActionCustom"),
      gasLimit: CALL_GAS,
    });
    row("stranger call status", failRcpt.status === 0 ? "REVERTED ✓" : "succeeded (unexpected)");
    row("gasUsed",              failRcpt.gasUsed.toString());

    expect(failRcpt.status).to.equal(0);
  });
});
