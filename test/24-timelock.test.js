const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

const TL_GAS = 200_000n;

describe("Timelock — block.timestamp enforcement", function () {
  let deployer;

  before(async () => {
    await ethers.provider.getBlockNumber();
    [deployer] = await ethers.getSigners();
  });

  // ── delay=0: immediately unlocked ───────────────────────────────────────────
  it("delay=0: execute() succeeds immediately after deploy", async function () {
    header("deploy(delay=0) → execute(42)");
    const F  = await ethers.getContractFactory("TimelockProbe");
    const tl = await deployWithRetry(F, [0n]);

    const remaining = await tl.timeRemaining();
    row("unlockTime",    (await tl.unlockTime()).toString());
    row("timeRemaining", remaining.toString());

    const rcpt    = await writeCall(tl, deployer, "execute", [42n], TL_GAS);
    const value   = await tl.value();
    const executed = await tl.executed();

    row("execute(42) status", rcpt.status === 1 ? "OK" : "FAILED");
    row("value after",        value.toString());
    row("executed flag",      executed.toString());

    expect(rcpt.status).to.equal(1);
    expect(value).to.equal(42n);
    expect(executed).to.be.true;
  });

  // ── delay=3600: still locked ─────────────────────────────────────────────────
  it("delay=3600: execute() reverts with LOCKED while timelock is active", async function () {
    header("deploy(delay=3600) → execute() → LOCKED revert");
    const F  = await ethers.getContractFactory("TimelockProbe");
    const tl = await deployWithRetry(F, [3600n]);

    const remaining = await tl.timeRemaining();
    row("timeRemaining (s)", remaining.toString());

    const rcpt    = await writeCall(tl, deployer, "execute", [99n], TL_GAS);
    const value   = await tl.value();
    const executed = await tl.executed();

    row("execute(99) status",  rcpt.status === 1 ? "OK" : "REVERTED ✓");
    row("value (unchanged)",   value.toString());
    row("executed flag",       executed.toString());

    expect(rcpt.status).to.equal(0); // LOCKED
    expect(value).to.equal(0n);
    expect(executed).to.be.false;
    expect(remaining).to.be.gt(0n);
  });

  // ── already executed ─────────────────────────────────────────────────────────
  it("execute() twice: second call reverts with ALREADY_EXECUTED", async function () {
    header("deploy(0) → execute(1) → execute(2) → ALREADY_EXECUTED");
    const F  = await ethers.getContractFactory("TimelockProbe");
    const tl = await deployWithRetry(F, [0n]);

    const rcpt1 = await writeCall(tl, deployer, "execute", [1n], TL_GAS);
    const rcpt2 = await writeCall(tl, deployer, "execute", [2n], TL_GAS);

    const value    = await tl.value();
    const executed = await tl.executed();

    row("1st execute status", rcpt1.status === 1 ? "OK" : "FAILED");
    row("2nd execute status", rcpt2.status === 1 ? "OK" : "REVERTED ✓");
    row("value (from 1st)",   value.toString());
    row("executed flag",      executed.toString());

    expect(rcpt1.status).to.equal(1);
    expect(rcpt2.status).to.equal(0); // ALREADY_EXECUTED
    expect(value).to.equal(1n);       // value stays as set by 1st call
    expect(executed).to.be.true;
  });

  // ── timeRemaining reflects delay ─────────────────────────────────────────────
  it("timeRemaining reports positive value and stays within configured delay", async function () {
    header("timeRemaining ∈ (0, delay]");
    const F     = await ethers.getContractFactory("TimelockProbe");
    const delay = 7200n; // 2 hours
    const tl    = await deployWithRetry(F, [delay]);

    const remaining   = await tl.timeRemaining();
    const unlockTime  = await tl.unlockTime();

    row("delay (s)",        delay.toString());
    row("unlockTime",       unlockTime.toString());
    row("timeRemaining (s)", remaining.toString());
    row("0 < remaining ≤ delay", (remaining > 0n && remaining <= delay).toString() + " ✓");

    expect(remaining).to.be.gt(0n);
    expect(remaining).to.be.lte(delay);
  });
});
