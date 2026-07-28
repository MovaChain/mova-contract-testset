const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

describe("EIP-7883  ModExp re-pricing — Osaka", function () {
  before(function () {
    if (require("hardhat").network.name === "hardhat") this.skip();
  });

  let probe;
  let signer;

  before(async () => {
    [signer] = await ethers.getSigners();
    const F = await ethers.getContractFactory("ModExpProbe");
    probe = await deployWithRetry(F);
  });

  it("write tx computes 3^65537 mod 4096; read returns result + gas", async function () {
    header("ModExp small (≤32-byte) operands (write → read)");

    // WRITE: run ModExp in a real tx and persist result + gas consumed.
    const rcpt = await writeCall(probe, signer, "compute", ["0x03", "0x010001", "0x1000"]);
    row("write tx status", rcpt.status === 1 ? "OK" : "FAILED");

    // READ back the persisted result and gas.
    const out = await probe.lastResult();
    const gas = await probe.lastGas();
    row("stored result", out);
    row("stored gas (staticcall)", gas.toString());

    expect(rcpt.status).to.equal(1);
    expect(BigInt(out)).to.equal(3n ** 65537n % 4096n);
  });

  it("write tx computes a 64-byte modulus exponentiation; read reports gas", async function () {
    header("ModExp large (>32-byte) operands (write → read)");
    const modHex = "00".padStart(64 * 2, "f"); // 64-byte mod = 0xfff...ff

    const rcpt = await writeCall(probe, signer, "compute", [
      "0x02",
      "0x0100",
      "0x" + modHex,
    ]);
    row("write tx status", rcpt.status === 1 ? "OK" : "FAILED");

    const out = await probe.lastResult();
    const gas = await probe.lastGas();
    row("stored output length", `${(out.length - 2) / 2} bytes`);
    row("stored gas (staticcall)", gas.toString());

    // After EIP-7883 the large case consumes at least the new floor (500).
    expect(rcpt.status).to.equal(1);
    expect(gas).to.be.greaterThan(500n);
  });
});
