const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

const MINT_GAS = 400_000n;
const TX_GAS   = 200_000n;

describe("ERC-721 TestNFT — mint, transfer, approve", function () {
  let nft, deployer, recipient, spender;

  before(async () => {
    await ethers.provider.getBlockNumber(); // warm up connection
    [deployer] = await ethers.getSigners();
    recipient = ethers.Wallet.createRandom();
    spender   = ethers.Wallet.createRandom();

    const F = await ethers.getContractFactory("TestNFT");
    nft = await deployWithRetry(F);
    row("TestNFT deployed at", await nft.getAddress());
  });

  // ── mint ────────────────────────────────────────────────────────────────────
  it("mint() assigns tokenId=0, sets tokenURI, ownerOf returns minter", async function () {
    header("mint(deployer, tokenId=0, uri)");
    const uri  = "ipfs://QmTestHash/0.json";
    const rcpt = await writeCall(nft, deployer, "mint", [deployer.address, uri], MINT_GAS);

    const owner    = await nft.ownerOf(0);
    const tokenURI = await nft.tokenURI(0);
    const nextId   = await nft.nextId();

    row("tx status",  rcpt.status === 1 ? "OK" : "FAILED");
    row("tokenId",    "0");
    row("ownerOf(0)", owner);
    row("tokenURI",   tokenURI);
    row("nextId",     nextId.toString());

    expect(rcpt.status).to.equal(1);
    expect(owner.toLowerCase()).to.equal(deployer.address.toLowerCase());
    expect(tokenURI).to.equal(uri);
    expect(nextId).to.equal(1n);
  });

  // ── safeTransferFrom ────────────────────────────────────────────────────────
  it("safeTransferFrom transfers ownership; ownerOf updates", async function () {
    header("mint(tokenId=1) then safeTransferFrom(deployer → recipient)");
    // mint tokenId=1
    await writeCall(nft, deployer, "mint",
      [deployer.address, "ipfs://QmTestHash/1.json"], MINT_GAS);

    const before = await nft.ownerOf(1);
    const rcpt = await writeCall(
      nft, deployer,
      "safeTransferFrom(address,address,uint256)",
      [deployer.address, recipient.address, 1n],
      TX_GAS
    );
    const after = await nft.ownerOf(1);

    row("tx status",         rcpt.status === 1 ? "OK" : "FAILED");
    row("ownerOf(1) before", before);
    row("ownerOf(1) after",  after);
    row("recipient",         recipient.address);

    expect(rcpt.status).to.equal(1);
    expect(before.toLowerCase()).to.equal(deployer.address.toLowerCase());
    expect(after.toLowerCase()).to.equal(recipient.address.toLowerCase());
  });

  // ── approve ─────────────────────────────────────────────────────────────────
  it("approve(spender, tokenId=0): getApproved returns spender", async function () {
    header("approve(spender, tokenId=0)");
    const rcpt     = await writeCall(nft, deployer, "approve", [spender.address, 0n], TX_GAS);
    const approved = await nft.getApproved(0);

    row("tx status",          rcpt.status === 1 ? "OK" : "FAILED");
    row("getApproved(0)",     approved);
    row("expected spender",   spender.address);

    expect(rcpt.status).to.equal(1);
    expect(approved.toLowerCase()).to.equal(spender.address.toLowerCase());
  });

  // ── setApprovalForAll ───────────────────────────────────────────────────────
  it("setApprovalForAll: grants then revokes blanket operator permission", async function () {
    header("setApprovalForAll(operator, true) then (false)");
    const operator = ethers.Wallet.createRandom();

    const rcptGrant  = await writeCall(
      nft, deployer, "setApprovalForAll", [operator.address, true], TX_GAS);
    const afterGrant = await nft.isApprovedForAll(deployer.address, operator.address);

    const rcptRevoke  = await writeCall(
      nft, deployer, "setApprovalForAll", [operator.address, false], TX_GAS);
    const afterRevoke = await nft.isApprovedForAll(deployer.address, operator.address);

    row("grant tx status",         rcptGrant.status  === 1 ? "OK" : "FAILED");
    row("isApprovedForAll (grant)", afterGrant.toString());
    row("revoke tx status",        rcptRevoke.status === 1 ? "OK" : "FAILED");
    row("isApprovedForAll (revoke)", afterRevoke.toString());

    expect(rcptGrant.status).to.equal(1);
    expect(afterGrant).to.be.true;
    expect(rcptRevoke.status).to.equal(1);
    expect(afterRevoke).to.be.false;
  });
});
