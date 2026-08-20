const { expect } = require("chai");
const { ethers } = require("hardhat");
const { header, row, writeCall } = require("./_helpers");
const { attachSystemContract } = require("./_system-helpers");

const BLACKLIST_ADDRESS = ethers.getAddress(
  "0x000000000000000000000000000000000000b1ac"
);
const TX_GAS = 300_000n;
const PAGE_SIZE = 20n;

describe("System contract — Movax blacklist", function () {
  let blacklist, currentUser, currentUserAddress, isAdmin;

  before(async function () {
    ({ contract: blacklist, currentUser, currentUserAddress, isAdmin } =
      await attachSystemContract(this, "IMovaxBlacklist", BLACKLIST_ADDRESS));
  });

  it("reads membership for multiple addresses", async function () {
    header("inBlackList(address[])");
    const probeAddress = ethers.Wallet.createRandom().address;
    const values = await blacklist.inBlackList([currentUserAddress, probeAddress]);

    row("current user blacklisted", values[0].toString());
    row("probe address blacklisted", values[1].toString());

    expect(values).to.have.length(2);
    expect(values[0]).to.be.a("boolean");
    expect(values[1]).to.be.a("boolean");
  });

  it("reads a paginated blacklist page", async function () {
    header("getBlackList(offset=0, len=20)");
    const [total, addresses] = await blacklist.getBlackList(0n, PAGE_SIZE);

    row("reported blacklist length", total.toString());
    row("returned page length", addresses.length.toString());

    expect(total).to.be.a("bigint");
    expect(addresses.length).to.be.at.most(Number(PAGE_SIZE));
    for (const address of addresses) expect(ethers.isAddress(address)).to.be.true;
  });

  it("administrator can update membership and restore it", async function () {
    if (!isAdmin) this.skip();

    header("administrator setBlackList → restore");
    const probeAddress = ethers.Wallet.createRandom().address;
    const before = (await blacklist.inBlackList([probeAddress]))[0];
    let setReceipt;
    let after;
    let restoreReceipt;

    try {
      setReceipt = await writeCall(
        blacklist,
        currentUser,
        "setBlackList",
        [[probeAddress], !before],
        TX_GAS
      );
      after = (await blacklist.inBlackList([probeAddress]))[0];
    } finally {
      if (setReceipt?.status === 1) {
        restoreReceipt = await writeCall(
          blacklist,
          currentUser,
          "setBlackList",
          [[probeAddress], before],
          TX_GAS
        );
      }
    }

    const restored = (await blacklist.inBlackList([probeAddress]))[0];
    row("initial membership", before.toString());
    row("set tx status", setReceipt?.status === 1 ? "OK" : "FAILED");
    row("updated membership", after?.toString() ?? "unavailable");
    row("restore tx status", restoreReceipt?.status === 1 ? "OK" : "FAILED");
    row("restored membership", restored.toString());

    expect(setReceipt?.status).to.equal(1);
    expect(after).to.equal(!before);
    expect(restoreReceipt?.status).to.equal(1);
    expect(restored).to.equal(before);
  });

  it("non-administrator cannot update membership", async function () {
    if (isAdmin) this.skip();

    header("non-administrator setBlackList → revert");
    const probeAddress = ethers.Wallet.createRandom().address;
    const before = (await blacklist.inBlackList([probeAddress]))[0];
    const receipt = await writeCall(
      blacklist,
      currentUser,
      "setBlackList",
      [[probeAddress], !before],
      TX_GAS
    );
    const after = (await blacklist.inBlackList([probeAddress]))[0];

    // If the configured role is wrong and the write unexpectedly succeeds,
    // restore the probe address before failing the assertion below.
    if (receipt.status === 1) {
      await writeCall(
        blacklist,
        currentUser,
        "setBlackList",
        [[probeAddress], before],
        TX_GAS
      );
    }

    row("tx status", receipt.status === 0 ? "REVERTED ✓" : "UNEXPECTED SUCCESS");
    row("membership unchanged", (after === before).toString());

    expect(receipt.status).to.equal(0);
    expect(after).to.equal(before);
  });
});
