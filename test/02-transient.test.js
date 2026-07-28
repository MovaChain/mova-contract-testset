const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

describe("EIP-1153  Transient storage (TLOAD/TSTORE)", function () {
  let probe;
  let signer;

  before(async () => {
    [signer] = await ethers.getSigners();
    const F = await ethers.getContractFactory("TransientProbe");
    probe = await deployWithRetry(F);
  });

  it("TSTORE then TLOAD inside one tx persists the loaded value", async function () {
    header("TSTORE/TLOAD round-trip");
    // WRITE: a real tx that does tstore(1,v) -> tload(1) -> persist to storage.
    const tx = await probe.connect(signer).roundTrip(0xc0ffeen);
    const rcpt = await tx.wait();
    row("write tx status", rcpt.status === 1 ? "OK" : "FAILED");

    // READ: the value TLOAD observed inside the tx, now in normal storage.
    const got = await probe.storedRoundTrip();
    row("written  (slot 1)", "0xc0ffee");
    row("stored after tload", "0x" + got.toString(16));

    expect(rcpt.status).to.equal(1);
    expect(got).to.equal(0xc0ffeen);
  });

  it("transient storage is wiped at tx end (read in a new tx)", async function () {
    header("Cross-tx isolation");
    // WRITE 1: store something into transient slot 1.
    await (await probe.connect(signer).roundTrip(0xdeadbeefn)).wait();

    // WRITE 2: a *new* tx captures tload(1) into persistent storage.
    const rcpt = await writeCall(probe, signer, "captureSlot1");
    row("capture tx status", rcpt.status === 1 ? "OK" : "FAILED");

    // READ: must be zero — transient storage does not survive across txs.
    const got = await probe.storedSlot1();
    row("captured slot1 (new tx)", got.toString());

    expect(rcpt.status).to.equal(1);
    expect(got).to.equal(0n);
  });

  it("transient writes are rolled back on revert", async function () {
    header("Rollback on revert");
    // WRITE 1: writeAndRevert tstores slot 2 then reverts. The revert must
    // also undo the transient write. We tolerate any revert surfacing mode.
    const r1 = await writeCall(probe, signer, "writeAndRevert", [0x1234n], 200_000n);
    row("writeAndRevert status", r1.status === 0 ? "REVERTED (expected)" : "unexpected success");

    // WRITE 2: fresh tx captures tload(2) into persistent storage.
    const r2 = await writeCall(probe, signer, "captureSlot2");
    row("capture tx status", r2.status === 1 ? "OK" : "FAILED");

    // READ: slot 2 must be zero — the reverted transient write left nothing.
    const got = await probe.storedSlot2();
    row("captured slot2 after revert", got.toString());

    expect(r2.status).to.equal(1);
    expect(got).to.equal(0n);
  });
});
