const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

const AC_GAS = 200_000n;

describe("Access control / Ownable", function () {
  let probe, deployer;

  before(async () => {
    await ethers.provider.getBlockNumber();
    [deployer] = await ethers.getSigners();

    const F = await ethers.getContractFactory("AccessControlProbe");
    probe = await deployWithRetry(F);
    row("AccessControlProbe deployed at", await probe.getAddress());
  });

  // ── owner can write ──────────────────────────────────────────────────────────
  it("owner can call setValue; adminValue updates", async function () {
    header("owner.setValue(42)");
    const rcpt  = await writeCall(probe, deployer, "setValue", [42n], AC_GAS);
    const value = await probe.adminValue();

    row("tx status",    rcpt.status === 1 ? "OK" : "FAILED");
    row("adminValue",   value.toString());

    expect(rcpt.status).to.equal(1);
    expect(value).to.equal(42n);
  });

  // ── non-operator state check ─────────────────────────────────────────────────
  it("random address is not an operator (operators mapping = false)", async function () {
    header("operators[stranger] == false");
    const stranger = ethers.Wallet.createRandom();
    const isOp     = await probe.operators(stranger.address);

    row("stranger address", stranger.address);
    row("is operator",      isOp.toString());

    expect(isOp).to.be.false;
  });

  // ── add operator ─────────────────────────────────────────────────────────────
  it("addOperator() grants operator role; operators mapping updates", async function () {
    header("addOperator(operator)");
    const operator = ethers.Wallet.createRandom();

    const before  = await probe.operators(operator.address);
    const rcpt    = await writeCall(probe, deployer, "addOperator", [operator.address], AC_GAS);
    const after   = await probe.operators(operator.address);

    row("tx status",        rcpt.status === 1 ? "OK" : "FAILED");
    row("operators before", before.toString());
    row("operators after",  after.toString());

    expect(rcpt.status).to.equal(1);
    expect(before).to.be.false;
    expect(after).to.be.true;
  });

  // ── remove operator ──────────────────────────────────────────────────────────
  it("removeOperator() revokes operator role", async function () {
    header("addOperator → removeOperator");
    const operator = ethers.Wallet.createRandom();

    await writeCall(probe, deployer, "addOperator",    [operator.address], AC_GAS);
    const beforeRemove = await probe.operators(operator.address);

    const rcpt         = await writeCall(probe, deployer, "removeOperator", [operator.address], AC_GAS);
    const afterRemove  = await probe.operators(operator.address);

    row("before remove",         beforeRemove.toString());
    row("removeOperator status", rcpt.status === 1 ? "OK" : "FAILED");
    row("after remove",          afterRemove.toString());

    expect(rcpt.status).to.equal(1);
    expect(beforeRemove).to.be.true;
    expect(afterRemove).to.be.false;
  });

  // ── transferOwnership ────────────────────────────────────────────────────────
  it("transferOwnership: owner() changes to new address", async function () {
    header("owner() + transferOwnership(newOwner)");
    const newOwner = ethers.Wallet.createRandom();

    const currentOwner = await probe.owner();
    row("owner before", currentOwner);
    expect(currentOwner.toLowerCase()).to.equal(deployer.address.toLowerCase());

    const rcpt      = await writeCall(probe, deployer, "transferOwnership", [newOwner.address], AC_GAS);
    const ownerAfter = await probe.owner();

    row("transferOwnership status", rcpt.status === 1 ? "OK" : "FAILED");
    row("owner after",              ownerAfter);
    row("expected",                 newOwner.address);

    expect(rcpt.status).to.equal(1);
    expect(ownerAfter.toLowerCase()).to.equal(newOwner.address.toLowerCase());
  });
});
