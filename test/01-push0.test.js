const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, deployWithRetry } = require("./_helpers");

describe("EIP-3855  PUSH0", function () {
  it("write tx runs PUSH0 and persists zero; read returns it", async function () {
    header("PUSH0 (EIP-3855)");
    const [signer] = await ethers.getSigners();
    const Push0 = await ethers.getContractFactory("Push0Probe");
    const c = await deployWithRetry(Push0);

    const code = await ethers.provider.getCode(await c.getAddress());
    row("runtime contains 0x5f", code.toLowerCase().includes("5f"));

    // READ before: the sentinel must still be present.
    const before = await c.stored();
    row("stored before write", "0x" + before.toString(16));
    expect(before).to.equal(0xdeadn);

    // WRITE: run PUSH0 inside a real, mined transaction.
    const tx = await c.connect(signer).writeZero();
    const rcpt = await tx.wait();
    row("write tx status", rcpt.status === 1 ? "OK" : "FAILED");

    // READ after: the PUSH0-produced zero must now be stored.
    const after = await c.stored();
    row("stored after write", after.toString());

    expect(rcpt.status).to.equal(1);
    expect(after).to.equal(0n);
  });
});
