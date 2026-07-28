const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

// ERC-20 smoke test: deploy TestToken, mint additional tokens, verify balances.
//
// Pattern: write tx (deploy / mint) → read (balanceOf) → assert.
// gasLimit is set explicitly on mint to bypass estimateGas quirks on mova.
const MINT_GAS = 200_000n;

describe("ERC-20 TestToken — deploy, mint, balanceOf", function () {
  let token;
  let deployer, recipient;
  const INITIAL_SUPPLY = ethers.parseEther("1" + "0".repeat(8)); // 1e8 ether

  before(async () => {
    [deployer] = await ethers.getSigners();
    // Use a fresh random wallet as recipient (read-only; no need to sign txs from it).
    recipient = ethers.Wallet.createRandom();
    const F = await ethers.getContractFactory("TestToken");
    token = await deployWithRetry(F);
  });

  // ── constructor mint ────────────────────────────────────────────────────────
  it("constructor mints 1e8 TTT to deployer", async function () {
    header("constructor mint → balanceOf(deployer)");

    const balance = await token.balanceOf(deployer.address);
    const symbol  = await token.symbol();
    const name    = await token.name();
    const supply  = await token.totalSupply();

    row("token name",        name);
    row("token symbol",      symbol);
    row("deployer address",  deployer.address);
    row("deployer balance",  ethers.formatEther(balance) + " TTT");
    row("total supply",      ethers.formatEther(supply)  + " TTT");

    expect(balance).to.equal(INITIAL_SUPPLY);
    expect(supply).to.equal(INITIAL_SUPPLY);
    expect(symbol).to.equal("TTT");
    expect(name).to.equal("Test");
  });

  // ── mint to recipient ───────────────────────────────────────────────────────
  it("mint() sends tokens to recipient; balanceOf reflects the change", async function () {
    header("mint(recipient, 1000 TTT) → balanceOf");

    const mintAmount = ethers.parseEther("1000");
    const beforeRecipient = await token.balanceOf(recipient.address);
    const beforeSupply    = await token.totalSupply();

    // Write tx: call mint and wait for it to be mined.
    const rcpt = await writeCall(token, deployer, "mint", [recipient.address, mintAmount], MINT_GAS);

    const afterRecipient = await token.balanceOf(recipient.address);
    const afterSupply    = await token.totalSupply();

    row("mint amount (TTT)",      ethers.formatEther(mintAmount));
    row("recipient (before)",     ethers.formatEther(beforeRecipient) + " TTT");
    row("recipient (after)",      ethers.formatEther(afterRecipient)  + " TTT");
    row("total supply (before)",  ethers.formatEther(beforeSupply)    + " TTT");
    row("total supply (after)",   ethers.formatEther(afterSupply)     + " TTT");
    row("mint tx status",         rcpt.status === 1 ? "OK" : "FAILED");
    row("mint tx gasUsed",        rcpt.gasUsed.toString());

    expect(rcpt.status).to.equal(1);
    expect(afterRecipient).to.equal(beforeRecipient + mintAmount);
    expect(afterSupply).to.equal(beforeSupply + mintAmount);
  });

  // ── transfer ────────────────────────────────────────────────────────────────
  it("transfer() moves tokens between accounts; both balances update", async function () {
    header("transfer(deployer → recipient, 500 TTT)");

    const transferAmount = ethers.parseEther("500");
    const beforeSender   = await token.balanceOf(deployer.address);
    const beforeReceiver = await token.balanceOf(recipient.address);

    // Write tx: deployer sends 500 TTT to recipient.
    const rcpt = await writeCall(token, deployer, "transfer", [recipient.address, transferAmount], MINT_GAS);

    const afterSender   = await token.balanceOf(deployer.address);
    const afterReceiver = await token.balanceOf(recipient.address);

    row("sender (deployer) before",    ethers.formatEther(beforeSender)   + " TTT");
    row("sender (deployer) after",     ethers.formatEther(afterSender)    + " TTT");
    row("receiver (recipient) before", ethers.formatEther(beforeReceiver) + " TTT");
    row("receiver (recipient) after",  ethers.formatEther(afterReceiver)  + " TTT");
    row("transfer tx status",          rcpt.status === 1 ? "OK" : "FAILED");

    expect(rcpt.status).to.equal(1);
    expect(afterSender).to.equal(beforeSender - transferAmount);
    expect(afterReceiver).to.equal(beforeReceiver + transferAmount);
  });
});
