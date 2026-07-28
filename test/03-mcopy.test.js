const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, deployWithRetry } = require("./_helpers");

describe("EIP-5656  MCOPY", function () {
  it("write tx MCOPYs bytes and persists them; read confirms exact copy", async function () {
    header("MCOPY round-trip");
    const [signer] = await ethers.getSigners();
    const F = await ethers.getContractFactory("McopyProbe");
    const c = await deployWithRetry(F);

    const src = "0x" + "ab".repeat(96); // 96 bytes, 3 words

    // WRITE: MCOPY src into memory and persist the copied bytes.
    const tx = await c.connect(signer).copyAndStore(src);
    const rcpt = await tx.wait();
    row("write tx status", rcpt.status === 1 ? "OK" : "FAILED");

    // READ back the persisted copy and its hash.
    const stored = await c.stored();
    const storedHash = await c.storedHash();
    row("input  length", "96 bytes");
    row("stored length", `${(stored.length - 2) / 2} bytes`);
    row("stored == input", stored.toLowerCase() === src.toLowerCase());
    row("hash matches", storedHash === ethers.keccak256(src));

    const code = await ethers.provider.getCode(await c.getAddress());
    row("runtime contains 0x5e", code.toLowerCase().includes("5e"));

    expect(rcpt.status).to.equal(1);
    expect(stored.toLowerCase()).to.equal(src.toLowerCase());
    expect(storedHash).to.equal(ethers.keccak256(src));
  });
});
