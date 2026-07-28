const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

describe("EIP-7907 contract code-size limit", function () {
  let factory;
  let signer;

  before(async () => {
    [signer] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("LargeCodeFactory");
    factory = await deployWithRetry(Factory);
  });

  async function deployAndRead(size) {
    const receipt = await writeCall(factory, signer, "deployRuntimeStore", [size], 30_000_000n);
    const address = await factory.lastDeployed();
    const codeSize = address === ethers.ZeroAddress ? 0n : await factory.codeSizeOf(address);
    return { receipt, address, codeSize };
  }

  it("deploys a 40000-byte runtime above the EIP-170 limit", async function () {
    header("EIP-7907: deploy 40000-byte runtime");
    const { receipt, address, codeSize } = await deployAndRead(40_000);
    row("tx status", receipt.status === 1 ? "OK" : "FAILED");
    row("deployed address", address);
    row("on-chain code size", codeSize.toString());

    expect(receipt.status).to.equal(1);
    expect(address).to.not.equal(ethers.ZeroAddress);
    expect(codeSize).to.equal(40_000n);
  });
});
