const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

const MC_GAS = 500_000n;

describe("Multicall — batch operations in one tx", function () {
  let probe, deployer;

  before(async () => {
    await ethers.provider.getBlockNumber();
    [deployer] = await ethers.getSigners();

    const F = await ethers.getContractFactory("MulticallProbe");
    probe = await deployWithRetry(F);
    row("MulticallProbe deployed at", await probe.getAddress());
  });

  // ── single call ──────────────────────────────────────────────────────────────
  it("single call via multicall works like a direct call", async function () {
    header("multicall([increment()])");
    const before = await probe.counter();
    const calls  = [probe.interface.encodeFunctionData("increment", [])];
    const rcpt   = await writeCall(probe, deployer, "multicall", [calls], MC_GAS);
    const after  = await probe.counter();

    row("tx status",      rcpt.status === 1 ? "OK" : "FAILED");
    row("counter before", before.toString());
    row("counter after",  after.toString());

    expect(rcpt.status).to.equal(1);
    expect(after).to.equal(before + 1n);
  });

  // ── batch increments ─────────────────────────────────────────────────────────
  it("5 increment()s in one tx: counter += 5", async function () {
    header("multicall([increment() × 5])");
    const before = await probe.counter();
    const inc    = probe.interface.encodeFunctionData("increment", []);
    const calls  = [inc, inc, inc, inc, inc];
    const rcpt   = await writeCall(probe, deployer, "multicall", [calls], MC_GAS);
    const after  = await probe.counter();

    row("tx status",      rcpt.status === 1 ? "OK" : "FAILED");
    row("counter before", before.toString());
    row("counter after",  after.toString());
    row("delta",          (after - before).toString());

    expect(rcpt.status).to.equal(1);
    expect(after - before).to.equal(5n);
  });

  // ── mixed batch ──────────────────────────────────────────────────────────────
  it("mixed batch: increment + setMessage execute in one tx", async function () {
    header("multicall([increment(), setMessage('hello from multicall')])");
    const before = await probe.counter();
    const calls  = [
      probe.interface.encodeFunctionData("increment", []),
      probe.interface.encodeFunctionData("setMessage", ["hello from multicall"]),
    ];
    const rcpt   = await writeCall(probe, deployer, "multicall", [calls], MC_GAS);
    const after   = await probe.counter();
    const message = await probe.lastMessage();

    row("tx status",   rcpt.status === 1 ? "OK" : "FAILED");
    row("counter",     before.toString() + " → " + after.toString());
    row("lastMessage", message);

    expect(rcpt.status).to.equal(1);
    expect(after).to.equal(before + 1n);
    expect(message).to.equal("hello from multicall");
  });

  // ── addN batch ───────────────────────────────────────────────────────────────
  it("addN batch: counter increases by exact sum", async function () {
    header("multicall([addN(10), addN(20), addN(30)])");
    const before = await probe.counter();
    const calls  = [
      probe.interface.encodeFunctionData("addN", [10n]),
      probe.interface.encodeFunctionData("addN", [20n]),
      probe.interface.encodeFunctionData("addN", [30n]),
    ];
    const rcpt  = await writeCall(probe, deployer, "multicall", [calls], MC_GAS);
    const after = await probe.counter();

    row("tx status",      rcpt.status === 1 ? "OK" : "FAILED");
    row("counter before", before.toString());
    row("counter after",  after.toString());
    row("delta (=60)",    (after - before).toString());

    expect(rcpt.status).to.equal(1);
    expect(after - before).to.equal(60n);
  });

  // ── atomic failure ───────────────────────────────────────────────────────────
  it("atomic failure: if one call reverts, entire multicall reverts", async function () {
    header("multicall([increment(), alwaysRevert()]) → atomic revert");
    const before = await probe.counter();
    const calls  = [
      probe.interface.encodeFunctionData("increment", []),
      probe.interface.encodeFunctionData("alwaysRevert", []),
    ];
    const rcpt  = await writeCall(probe, deployer, "multicall", [calls], MC_GAS);
    const after = await probe.counter();

    row("tx status",         rcpt.status === 1 ? "OK" : "REVERTED ✓");
    row("counter before",    before.toString());
    row("counter after",     after.toString());
    row("counter unchanged", (after === before).toString() + " ✓");

    expect(rcpt.status).to.equal(0);   // entire tx reverted
    expect(after).to.equal(before);    // increment rolled back too
  });
});
