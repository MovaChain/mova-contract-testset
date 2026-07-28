const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

describe("EIP-3541  reject runtime starting with 0xEF", function () {
  it("write tx attempts the 0xEF CREATE and persists address(0)", async function () {
    header("CREATE of 0xEF runtime");
    const [signer] = await ethers.getSigners();
    const F = await ethers.getContractFactory("Eip3541Probe");
    const c = await deployWithRetry(F);

    // WRITE: run the CREATE inside a real tx and persist the result address.
    const rcpt = await writeCall(c, signer, "tryDeployEfStore");
    row("write tx status", rcpt.status === 1 ? "OK" : "FAILED");

    // READ back the persisted CREATE result — must be zero (EIP-3541 rejected).
    const out = await c.lastDeployed();
    row("attempted", (await c.attempted()).toString());
    row("returned address", out);
    row("is zero (rejected)", out === ethers.ZeroAddress);

    expect(rcpt.status).to.equal(1);
    expect(await c.attempted()).to.equal(true);
    expect(out).to.equal(ethers.ZeroAddress);
  });
});
