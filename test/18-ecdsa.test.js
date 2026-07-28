const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

// ECDSA signature verification test
//
// Covers two modes:
//   1. EIP-191 personal_sign — the standard eth_sign / personal_sign format.
//      JS: wallet.signMessage(bytes)  →  contract: ECDSA.recover(toEthSignedMessageHash(hash), sig)
//
//   2. EIP-712 typed data — structured data with a domain separator.
//      JS: wallet._signTypedData(domain, types, value)
//      Contract: ECDSA.recover(keccak256("\x19\x01" || domainSep || structHash), sig)
//
// For both modes: write tx (verifyXxx) → read lastXxxOk / lastXxxSigner → assert.

const VERIFY_GAS = 300_000n;

describe("ECDSA signature verification", function () {
  let probe;
  let wallet;     // random signer — private key known only in JS
  let deployer;

  before(async () => {
    [deployer] = await ethers.getSigners();
    wallet = ethers.Wallet.createRandom();   // fresh keypair for this test run

    const F = await ethers.getContractFactory("ECDSAProbe");
    probe = await deployWithRetry(F);
  });

  // ── EIP-191 personal sign — valid ────────────────────────────────────────
  it("personal_sign: valid signature — on-chain recover returns expected signer", async function () {
    header("EIP-191 personal_sign — valid");

    const message     = "Hello, EVM upgrade!";
    const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));

    // eth_sign adds "\x19Ethereum Signed Message:\n32" prefix internally.
    const sig = await wallet.signMessage(ethers.getBytes(messageHash));

    row("signer address",  wallet.address);
    row("message",         message);
    row("messageHash",     messageHash);
    row("signature",       sig.slice(0, 20) + "…");

    const rcpt = await writeCall(
      probe, deployer, "verifyPersonalSign",
      [messageHash, sig, wallet.address], VERIFY_GAS
    );

    const recovered = await probe.lastPersonalSigner();
    const ok        = await probe.lastPersonalOk();

    row("tx status",       rcpt.status === 1 ? "OK" : "FAILED");
    row("recovered",       recovered);
    row("lastPersonalOk",  ok.toString());

    expect(rcpt.status).to.equal(1);
    expect(ok).to.be.true;
    expect(recovered.toLowerCase()).to.equal(wallet.address.toLowerCase());
  });

  // ── EIP-191 personal sign — wrong signer ────────────────────────────────
  it("personal_sign: tampered signature — on-chain recover returns wrong address", async function () {
    header("EIP-191 personal_sign — wrong signer");

    const message     = "Hello, EVM upgrade!";
    const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));

    // Sign with a different (intruder) wallet — produces a validly-formatted
    // ECDSA signature that recovers to the intruder's address, not wallet's.
    // (Flipping individual sig bytes risks producing an OZ-rejected high-s value.)
    const intruder    = ethers.Wallet.createRandom();
    const wrongSig    = await intruder.signMessage(ethers.getBytes(messageHash));

    row("legitimate signer", wallet.address);
    row("actual signer",     intruder.address);
    row("signature from",    "intruder (≠ wallet)");

    const rcpt = await writeCall(
      probe, deployer, "verifyPersonalSign",
      [messageHash, wrongSig, wallet.address], VERIFY_GAS
    );

    const ok        = await probe.lastPersonalOk();
    const recovered = await probe.lastPersonalSigner();

    row("tx status",      rcpt.status === 1 ? "OK" : "FAILED");
    row("recovered",      recovered);
    row("lastPersonalOk", ok.toString());

    expect(rcpt.status).to.equal(1);
    expect(ok).to.be.false;
    expect(recovered.toLowerCase()).to.not.equal(wallet.address.toLowerCase());
    expect(recovered.toLowerCase()).to.equal(intruder.address.toLowerCase());
  });

  // ── EIP-712 typed data — valid ───────────────────────────────────────────
  it("EIP-712 typed order: valid signature — on-chain recover returns expected signer", async function () {
    header("EIP-712 typed data — valid");

    const probeAddr  = await probe.getAddress();
    const chainId    = (await ethers.provider.getNetwork()).chainId;

    const domain = {
      name:              "ECDSAProbe",
      chainId:           chainId,
      verifyingContract: probeAddr,
    };
    const types = {
      Order: [
        { name: "from",   type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce",  type: "uint256" },
      ],
    };
    const order = { from: wallet.address, amount: 1000n, nonce: 1n };

    const sig = await wallet.signTypedData(domain, types, order);

    row("signer",   wallet.address);
    row("amount",   order.amount.toString());
    row("nonce",    order.nonce.toString());
    row("chainId",  chainId.toString());
    row("signature", sig.slice(0, 20) + "…");

    const rcpt = await writeCall(
      probe, deployer, "verifyTypedOrder",
      [order, sig, wallet.address], VERIFY_GAS
    );

    const recovered = await probe.lastTypedSigner();
    const ok        = await probe.lastTypedOk();

    row("tx status",     rcpt.status === 1 ? "OK" : "FAILED");
    row("recovered",     recovered);
    row("lastTypedOk",   ok.toString());

    expect(rcpt.status).to.equal(1);
    expect(ok).to.be.true;
    expect(recovered.toLowerCase()).to.equal(wallet.address.toLowerCase());
  });

  // ── EIP-712 — wrong signer ───────────────────────────────────────────────
  it("EIP-712 typed order: different signer — verification fails", async function () {
    header("EIP-712 typed data — wrong signer");

    const probeAddr = await probe.getAddress();
    const chainId   = (await ethers.provider.getNetwork()).chainId;

    const domain = {
      name: "ECDSAProbe", chainId, verifyingContract: probeAddr,
    };
    const types  = { Order: [
      { name: "from",   type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce",  type: "uint256" },
    ]};
    const order = { from: wallet.address, amount: 500n, nonce: 2n };

    const intruder = ethers.Wallet.createRandom();  // a different key
    const sig      = await intruder.signTypedData(domain, types, order);

    row("legitimate signer", wallet.address);
    row("actual signer",     intruder.address);

    const rcpt = await writeCall(
      probe, deployer, "verifyTypedOrder",
      [order, sig, wallet.address], VERIFY_GAS  // claim wallet signed it
    );

    const ok        = await probe.lastTypedOk();
    const recovered = await probe.lastTypedSigner();

    row("tx status",    rcpt.status === 1 ? "OK" : "FAILED");
    row("recovered",    recovered);
    row("lastTypedOk",  ok.toString());

    expect(rcpt.status).to.equal(1);
    expect(ok).to.be.false;
  });
});
