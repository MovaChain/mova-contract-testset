const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const vectors = require("./fixtures/eip8051.json");
const { row, header, deployWithRetry } = require("./_helpers");

const decode = (value) => Uint8Array.from(Buffer.from(value, "base64"));
const expandedKeyHashes = {
  nist: "0xd39fd77dbe4aa90aea935105f2651c425c2f0db2136827942ddb91a82ebca0f4",
  eth: "0xae75c7d33bebda0a0c4bd05d68fa7e173469db2e6892fb2e2b6f4d66f7882c36",
};

describe("EIP-8051 JS key preparation", function () {
  let pqc;

  before(async function () {
    pqc = await import("./_eip8051.mjs");
  });

  it("generates and signs the NIST vector identically to the Go implementation", function () {
    const expected = vectors.nist;
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index);
    const randomness = new Uint8Array(32);
    const message = decode(expected.message);
    const { publicKey, secretKey } = pqc.generateNistKeyPair(seed);
    const signature = pqc.signNist(message, secretKey, randomness);

    header("EIP-8051 NIST JS keygen → sign → local verify");
    row("private seed", `${seed.length} bytes`);
    row("compact public key", `${publicKey.length} bytes`);
    row("signature", `${signature.length} bytes`);
    row("Go vector match", Buffer.from(signature).equals(Buffer.from(expected.signature, "base64")));

    expect(Buffer.from(publicKey)).to.deep.equal(Buffer.from(expected.publicKey, "base64"));
    expect(Buffer.from(signature)).to.deep.equal(Buffer.from(expected.signature, "base64"));
    expect(pqc.verifyNistLocally(message, signature, publicKey)).to.equal(true);
  });

  for (const variant of ["nist", "eth"]) {
    it(`expands the ${variant} compact public key to the precompile format`, function () {
      const expanded = pqc.expandPublicKey(decode(vectors[variant].publicKey), variant);
      const expandedHash = ethers.keccak256(expanded);
      row(`${variant} expanded key`, `${expanded.length} bytes`);
      row(`${variant} expanded hash`, expandedHash);
      expect(expanded).to.have.lengthOf(pqc.EXPANDED_PUBLIC_KEY_SIZE);
      expect(expandedHash).to.equal(expandedKeyHashes[variant]);
    });
  }
});

describe("EIP-8051 ML-DSA precompiles", function () {
  let pqc;
  let verifier;

  before(function () {
    if (network.name === "hardhat") this.skip();
  });

  before(async function () {
    pqc = await import("./_eip8051.mjs");
    const Verifier = await ethers.getContractFactory("EIP8051VerifierDemo");
    verifier = await deployWithRetry(Verifier);
    row("EIP-8051 verifier", await verifier.getAddress());
  });

  for (const variant of ["nist", "eth"]) {
    it(`verifies a valid ${variant} signature`, async function () {
      const vector = vectors[variant];
      const message = decode(vector.message);
      const signature = decode(vector.signature);
      const expanded = pqc.expandPublicKey(decode(vector.publicKey), variant);
      const method = variant === "nist" ? "verifyMldsa" : "verifyMldsaEth";

      header(`EIP-8051 ${variant} valid signature`);
      const valid = await verifier[method](ethers.hexlify(message), signature, expanded);
      row("precompile", variant === "nist" ? "0x12" : "0x13");
      row("calldata payload", `${message.length + signature.length + expanded.length} bytes`);
      row("verification", valid);
      expect(valid).to.equal(true);
    });

    it(`rejects a modified ${variant} signature`, async function () {
      const vector = vectors[variant];
      const message = decode(vector.message);
      const signature = decode(vector.signature);
      signature[0] ^= 1;
      const expanded = pqc.expandPublicKey(decode(vector.publicKey), variant);
      const method = variant === "nist" ? "verifyMldsa" : "verifyMldsaEth";

      const valid = await verifier[method](ethers.hexlify(message), signature, expanded);
      row(`${variant} modified sig`, valid);
      expect(valid).to.equal(false);
    });
  }

  it("rejects wrong input lengths before calling a precompile", async function () {
    const message = decode(vectors.nist.message);
    const signature = decode(vectors.nist.signature).subarray(1);
    const expanded = pqc.expandPublicKey(decode(vectors.nist.publicKey), "nist");
    const valid = await verifier.verifyMldsa(ethers.hexlify(message), signature, expanded);
    row("short signature", valid);
    expect(valid).to.equal(false);
  });
});
