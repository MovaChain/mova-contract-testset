const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

// EIP-2612 Permit: off-chain EIP-712 signature authorises an allowance without
// the owner needing to send an approve() transaction.

describe("ERC-20 Permit — EIP-2612 gasless approve", function () {
  let token, deployer, spender;
  const SUPPLY = ethers.parseEther("1000000");

  before(async () => {
    await ethers.provider.getBlockNumber();
    [deployer] = await ethers.getSigners();
    spender = ethers.Wallet.createRandom();

    const F = await ethers.getContractFactory("PermitToken");
    token = await deployWithRetry(F);
    row("PermitToken deployed at", await token.getAddress());
  });

  // ── initial state ────────────────────────────────────────────────────────────
  it("constructor mints 1M PMT to deployer", async function () {
    header("constructor → initial state");
    const balance = await token.balanceOf(deployer.address);
    const supply  = await token.totalSupply();
    const name    = await token.name();
    const nonce   = await token.nonces(deployer.address);

    row("name",             name);
    row("deployer balance", ethers.formatEther(balance) + " PMT");
    row("total supply",     ethers.formatEther(supply)  + " PMT");
    row("nonce (deployer)", nonce.toString());

    expect(balance).to.equal(SUPPLY);
    expect(supply).to.equal(SUPPLY);
    expect(nonce).to.equal(0n);
  });

  // ── valid permit ─────────────────────────────────────────────────────────────
  it("permit() sets allowance via off-chain EIP-712 signature (no approve tx)", async function () {
    header("sign permit off-chain → permit() → allowance");

    const tokenAddr = await token.getAddress();
    const chainId   = (await ethers.provider.getNetwork()).chainId;
    const nonce     = await token.nonces(deployer.address);
    const deadline  = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const permitAmt = ethers.parseEther("5000");

    const domain = {
      name:              "PermitToken",
      version:           "1",
      chainId,
      verifyingContract: tokenAddr,
    };
    const types = {
      Permit: [
        { name: "owner",    type: "address" },
        { name: "spender",  type: "address" },
        { name: "value",    type: "uint256" },
        { name: "nonce",    type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const message = {
      owner:    deployer.address,
      spender:  spender.address,
      value:    permitAmt,
      nonce,
      deadline,
    };

    // Off-chain signature — no on-chain tx needed from owner
    const sig        = await deployer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    row("owner",       deployer.address);
    row("spender",     spender.address);
    row("amount",      ethers.formatEther(permitAmt) + " PMT");
    row("deadline",    deadline.toString());
    row("v",           v.toString());
    row("r",           r.slice(0, 18) + "…");

    const beforeAllowance = await token.allowance(deployer.address, spender.address);

    // Anyone can submit the permit tx (here deployer does it)
    const rcpt = await writeCall(
      token, deployer, "permit",
      [deployer.address, spender.address, permitAmt, deadline, v, r, s],
      300_000n
    );

    const afterAllowance = await token.allowance(deployer.address, spender.address);

    row("tx status",        rcpt.status === 1 ? "OK" : "FAILED");
    row("allowance before", ethers.formatEther(beforeAllowance) + " PMT");
    row("allowance after",  ethers.formatEther(afterAllowance)  + " PMT");

    expect(rcpt.status).to.equal(1);
    expect(beforeAllowance).to.equal(0n);
    expect(afterAllowance).to.equal(permitAmt);
  });

  // ── nonce replay protection ──────────────────────────────────────────────────
  it("nonce increments after permit (replay protection)", async function () {
    header("nonces(owner) after 1 permit");
    const nonce = await token.nonces(deployer.address);
    row("nonce", nonce.toString());
    expect(nonce).to.equal(1n);
  });

  // ── expired permit ───────────────────────────────────────────────────────────
  it("expired permit reverts", async function () {
    header("permit with past deadline → revert");

    const tokenAddr = await token.getAddress();
    const chainId   = (await ethers.provider.getNetwork()).chainId;
    const nonce     = await token.nonces(deployer.address);
    const deadline  = BigInt(Math.floor(Date.now() / 1000) - 3600); // 1 hour in the past
    const permitAmt = ethers.parseEther("1000");

    const domain = {
      name: "PermitToken", version: "1",
      chainId, verifyingContract: tokenAddr,
    };
    const types = {
      Permit: [
        { name: "owner", type: "address" }, { name: "spender", type: "address" },
        { name: "value", type: "uint256" }, { name: "nonce",   type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const sig = await deployer.signTypedData(domain, types,
      { owner: deployer.address, spender: spender.address, value: permitAmt, nonce, deadline });
    const { v, r, s } = ethers.Signature.from(sig);

    const rcpt = await writeCall(
      token, deployer, "permit",
      [deployer.address, spender.address, permitAmt, deadline, v, r, s],
      300_000n
    );

    row("deadline",  deadline.toString() + " (past)");
    row("tx status", rcpt.status === 1 ? "OK" : "REVERTED ✓");

    expect(rcpt.status).to.equal(0); // ERC2612ExpiredSignature revert
  });
});
