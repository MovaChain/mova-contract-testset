const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, sendRaw, deployWithRetry } = require("./_helpers");

// CREATE2 deterministic deployment test
//
// Verifies:
//   1. computeAddress() predicts the deployed address correctly (before deploy).
//   2. deploy() actually creates a contract at the predicted address.
//   3. The deployed contract is functional (Counter.increment works).
//   4. A second deploy with the SAME salt fails (address already occupied).
//   5. A second deploy with a DIFFERENT salt produces a distinct address.

const DEPLOY_GAS = 500_000n;

describe("CREATE2 — deterministic deployment", function () {
  let factory, Counter;
  let deployer;

  before(async () => {
    [deployer] = await ethers.getSigners();
    const FF = await ethers.getContractFactory("Create2Factory");
    factory = await deployWithRetry(FF);
    Counter = await ethers.getContractFactory("Counter");
  });

  // ── address prediction ───────────────────────────────────────────────────
  it("computeAddress() predicts the deployed address before deployment", async function () {
    header("CREATE2 address prediction");

    const salt        = ethers.id("salt-alpha");
    const bytecode    = Counter.bytecode;
    const bytecodeHash = ethers.keccak256(bytecode);
    const factoryAddr = await factory.getAddress();

    const predicted = await factory.computeAddress(salt, bytecodeHash);
    row("factory address",  factoryAddr);
    row("salt",             salt);
    row("bytecodeHash",     bytecodeHash);
    row("predicted address", predicted);

    // Deploy
    const rcpt = await writeCall(factory, deployer, "deploy", [salt, bytecode], DEPLOY_GAS);
    const deployed = await factory.lastDeployed();
    const success  = await factory.lastSuccess();

    row("deploy tx status", rcpt.status === 1 ? "OK" : "FAILED");
    row("deployed address", deployed);
    row("matches prediction", deployed.toLowerCase() === predicted.toLowerCase());

    expect(rcpt.status).to.equal(1);
    expect(success).to.be.true;
    expect(deployed.toLowerCase()).to.equal(predicted.toLowerCase());
  });

  // ── deployed contract is functional ─────────────────────────────────────
  it("deployed Counter contract is functional at the CREATE2 address", async function () {
    header("CREATE2 deployed contract functionality");

    const deployed = await factory.lastDeployed();
    const counter  = Counter.attach(deployed);

    row("counter address",    deployed);
    row("count (before)",     (await counter.count()).toString());

    // Increment via write tx
    const rcpt = await writeCall(counter, deployer, "increment", [], 100_000n);
    const countAfter = await counter.count();

    row("increment tx status", rcpt.status === 1 ? "OK" : "FAILED");
    row("count (after)",       countAfter.toString());

    expect(rcpt.status).to.equal(1);
    expect(countAfter).to.equal(1n);
  });

  // ── same salt → collision ────────────────────────────────────────────────
  it("re-deploying with the SAME salt fails (address already occupied)", async function () {
    header("CREATE2 same-salt collision");

    const salt     = ethers.id("salt-alpha");   // same as first test
    const bytecode = Counter.bytecode;

    const rcpt  = await writeCall(factory, deployer, "deploy", [salt, bytecode], DEPLOY_GAS);
    const ok    = await factory.lastSuccess();
    const addr  = await factory.lastDeployed();

    row("deploy tx status",  rcpt.status === 1 ? "OK" : "FAILED");
    row("lastSuccess",       ok.toString());
    row("lastDeployed",      addr);
    row("is zero address",   addr === ethers.ZeroAddress);

    expect(rcpt.status).to.equal(1);      // tx itself succeeds
    expect(ok).to.be.false;               // but CREATE2 returned address(0)
    expect(addr).to.equal(ethers.ZeroAddress);
  });

  // ── different salt → different address ───────────────────────────────────
  it("different salt produces a distinct address", async function () {
    header("CREATE2 different-salt deployment");

    const saltA = ethers.id("salt-alpha");
    const saltB = ethers.id("salt-beta");
    const bytecode = Counter.bytecode;
    const bytecodeHash = ethers.keccak256(bytecode);

    const addrA = await factory.computeAddress(saltA, bytecodeHash);
    const addrB = await factory.computeAddress(saltB, bytecodeHash);

    const rcpt = await writeCall(factory, deployer, "deploy", [saltB, bytecode], DEPLOY_GAS);
    const deployed = await factory.lastDeployed();

    row("address A (alpha)", addrA);
    row("address B (beta)",  addrB);
    row("deployed B",        deployed);
    row("A ≠ B",             addrA.toLowerCase() !== addrB.toLowerCase());

    expect(rcpt.status).to.equal(1);
    expect(deployed.toLowerCase()).to.equal(addrB.toLowerCase());
    expect(addrA.toLowerCase()).to.not.equal(addrB.toLowerCase());
  });
});
