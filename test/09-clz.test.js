const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, deployWithRetry } = require("./_helpers");

// EIP-7939 CLZ (count leading zeros, opcode 0x1e). The Osaka compiler target
// makes `clz` available in Yul; ClzProbe exercises it via a WRITE transaction
// (`compute`) that persists the result, then reads it back from storage.
describe("EIP-7939  CLZ (count leading zeros) — Osaka", function () {
  before(function () {
    if (require("hardhat").network.name === "hardhat") this.skip();
  });

  let probe;
  let signer;

  before(async () => {
    [signer] = await ethers.getSigners();
    const F = await ethers.getContractFactory("ClzProbe");
    probe = await deployWithRetry(F);
  });

  const cases = [
    { input: 0n, expected: 256n },
    { input: 1n, expected: 255n },
    { input: 2n, expected: 254n },
    { input: 0xffn, expected: 248n },
    { input: 1n << 128n, expected: 127n },
    { input: (1n << 256n) - 1n, expected: 0n },
  ];

  it("write tx computes CLZ; read returns the leading-zero count", async function () {
    header("CLZ table (write → read)");
    for (const { input, expected } of cases) {
      // WRITE: compute CLZ(input) inside a real tx and persist the result.
      const rcpt = await (await probe.connect(signer).compute(input)).wait();
      expect(rcpt.status).to.equal(1);

      // READ back the persisted result.
      const r = await probe.lastResult();
      row(`clz(0x${input.toString(16)})`, `${r}  (expected ${expected})`);
      expect(r).to.equal(expected);
    }
  });
});
