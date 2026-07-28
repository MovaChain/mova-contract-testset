const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, sendRaw, deployWithRetry } = require("./_helpers");

describe("EIP-6780  SELFDESTRUCT semantics", function () {
  let signer;
  const dead = "0x000000000000000000000000000000000000dEaD";

  before(async () => {
    [signer] = await ethers.getSigners();
  });

  it("pre-existing contract: SELFDESTRUCT moves balance but preserves code", async function () {
    header("Case 1 — pre-existing contract calls SELFDESTRUCT");
    const Probe = await ethers.getContractFactory("SelfDestructProbe");
    const victim = await deployWithRetry(Probe);
    const vaddr = await victim.getAddress();

    // fund the victim so we can also assert balance is moved
    await sendRaw(signer, { to: vaddr, value: ethers.parseEther("0.01"), gasLimit: 21_000n });

    const balBefore  = await ethers.provider.getBalance(vaddr);
    const sizeBefore = await victim.codeSizeOf(vaddr);

    // WRITE: pre-existing contract selfdestructs in a real tx (via helper).
    const rcpt = await writeCall(victim, signer, "kill", [dead]);
    row("kill tx status", rcpt.status === 1 ? "OK" : "FAILED");

    const balAfter  = await ethers.provider.getBalance(vaddr);
    const sizeAfter = await victim.codeSizeOf(vaddr);

    row("balance moved to 0xdead", balBefore > 0n && balAfter === 0n);
    row("code size before/after", `${sizeBefore} -> ${sizeAfter}`);
    row("runtime preserved (post-Prague)", sizeAfter > 0n && sizeAfter === sizeBefore);

    expect(rcpt.status).to.equal(1);
    expect(balAfter).to.equal(0n);
    expect(sizeAfter).to.equal(sizeBefore); // post-Prague: code preserved
    expect(sizeAfter).to.be.greaterThan(0n);
  });

  it("same-tx create + SELFDESTRUCT DOES delete the account", async function () {
    header("Case 2 — same-tx create + SELFDESTRUCT");
    const Killer = await ethers.getContractFactory("SameTxKiller");
    const k = await deployWithRetry(Killer);

    // WRITE: deploy + selfdestruct in the same tx, persisting the victim addr.
    const rcpt = await writeCall(k, signer, "deployAndKillStore", [dead]);
    row("write tx status", rcpt.status === 1 ? "OK" : "FAILED");

    // READ back the victim address and its code size — must be empty.
    const created = await k.lastVictim();
    const size    = await k.codeSizeOf(created);
    row("victim address", created);
    row("victim code size post-tx", size.toString() + (size === 0n ? " (deleted)" : ""));

    expect(rcpt.status).to.equal(1);
    expect(created).to.not.equal(ethers.ZeroAddress);
    expect(size).to.equal(0n);
  });
});
