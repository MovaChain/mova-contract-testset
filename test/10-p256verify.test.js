const { expect } = require("chai");
const { ethers } = require("hardhat");
const crypto = require("crypto");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

// Generate a P-256 keypair and a signature using node's webcrypto, then
// extract raw (r, s, x, y) for the precompile input.
//
// WebCrypto's subtle.sign({name:"ECDSA", hash:"SHA-256"}, key, data) hashes
// the data internally, producing a signature over SHA256(data).  So we must
// pass the RAW message bytes to subtle.sign and compute msgHash = SHA256(msg)
// ourselves — that is the actual hash that was signed and what the precompile
// expects as its first 32-byte input field.
async function genSig(msg) {
  const { subtle } = crypto.webcrypto;
  const kp = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  // Sign the raw message; subtle.sign hashes it with SHA-256 internally.
  const sig = new Uint8Array(
    await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, msg)
  );
  // SHA-256(msg) is the exact hash that was signed — pass this to the precompile.
  const msgHash = crypto.createHash("sha256").update(msg).digest();
  const r = sig.slice(0, 32);
  const s = sig.slice(32, 64);
  const jwk = await subtle.exportKey("jwk", kp.publicKey);
  const b64uTo32 = (b64u) => {
    const b = Buffer.from(b64u.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (b.length !== 32) throw new Error(`bad coord length ${b.length}`);
    return Uint8Array.from(b);
  };
  return {
    msgHash: Uint8Array.from(msgHash),
    r,
    s,
    qx: b64uTo32(jwk.x),
    qy: b64uTo32(jwk.y),
  };
}

const u8ToBytes32 = (u8) => "0x" + Buffer.from(u8).toString("hex");

describe("EIP-7951  P256VERIFY precompile — Osaka", function () {
  before(function () {
    if (require("hardhat").network.name === "hardhat") this.skip();
  });

  let probe;
  let signer;

  before(async () => {
    [signer] = await ethers.getSigners();
    const F = await ethers.getContractFactory("P256VerifyProbe");
    probe = await deployWithRetry(F);
  });

  it("write tx verifies a valid secp256r1 signature; read returns true", async function () {
    header("P256VERIFY — valid signature (write → read)");
    const sig = await genSig(Buffer.from("hello osaka"));

    // WRITE: run the precompile in a real tx and persist the boolean result.
    const rcpt = await writeCall(probe, signer, "writeVerify", [
      u8ToBytes32(sig.msgHash),
      u8ToBytes32(sig.r),
      u8ToBytes32(sig.s),
      u8ToBytes32(sig.qx),
      u8ToBytes32(sig.qy),
    ]);
    row("write tx status", rcpt.status === 1 ? "OK" : "FAILED");

    // READ back the persisted result.
    const ok = await probe.lastOk();
    row("stored lastOk", ok);
    row("raw output", await probe.lastRaw());

    expect(rcpt.status).to.equal(1);
    expect(ok).to.equal(true);
  });

  it("write tx rejects a tampered signature; read returns false", async function () {
    header("P256VERIFY — tampered signature (write → read)");
    const sig = await genSig(Buffer.from("hello osaka"));
    sig.r[0] ^= 0x01; // flip a bit

    const rcpt = await writeCall(probe, signer, "writeVerify", [
      u8ToBytes32(sig.msgHash),
      u8ToBytes32(sig.r),
      u8ToBytes32(sig.s),
      u8ToBytes32(sig.qx),
      u8ToBytes32(sig.qy),
    ]);
    row("write tx status", rcpt.status === 1 ? "OK" : "FAILED");

    const ok = await probe.lastOk();
    const raw = await probe.lastRaw();
    row("stored lastOk", ok);
    row("raw output", raw === "0x" ? "<empty>" : raw);

    expect(rcpt.status).to.equal(1);
    expect(ok).to.equal(false);
  });
});
