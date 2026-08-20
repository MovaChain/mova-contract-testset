import { randomBytes } from "node:crypto";

import { genCrystals, XOF128 } from "@noble/post-quantum/_crystals.js";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { keccak_256, shake256 } from "@noble/hashes/sha3.js";

export const COMPACT_PUBLIC_KEY_SIZE = 1312;
export const EXPANDED_PUBLIC_KEY_SIZE = 20512;
export const SIGNATURE_SIZE = 2420;

const N = 256;
const Q = 8380417;
const K = 4;
const L = 4;
const POLY_T1_SIZE = 320;

const crystals = genCrystals({
  N,
  Q,
  F: 8347681,
  ROOT_OF_UNITY: 1753,
  brvBits: 8,
  isKyber: false,
  newPoly: (length) => new Int32Array(length),
});
const t1Coder = crystals.bitsCoder(10, {
  encode: (value) => value,
  decode: (value) => value,
});

function bytes(value, expectedLength, label) {
  const result = Uint8Array.from(value);
  if (result.length !== expectedLength) {
    throw new Error(`${label} must be ${expectedLength} bytes, got ${result.length}`);
  }
  return result;
}

function concat(...values) {
  const length = values.reduce((sum, value) => sum + value.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function createKeccakPrng(input) {
  const state = keccak_256(input);
  let counter = 0n;
  let block = new Uint8Array(0);
  let offset = 0;

  return (length) => {
    const output = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      if (offset === block.length) {
        const counterBytes = new Uint8Array(8);
        new DataView(counterBytes.buffer).setBigUint64(0, counter);
        block = keccak_256(concat(state, counterBytes));
        counter++;
        offset = 0;
      }
      output[i] = block[offset++];
    }
    return output;
  };
}

function keccakPrngHash(length, ...inputs) {
  return createKeccakPrng(concat(...inputs))(length);
}

function samplePolynomial(readBlock) {
  const polynomial = new Int32Array(N);
  for (let coefficient = 0; coefficient < N;) {
    const block = readBlock();
    for (let offset = 0; offset + 2 < block.length && coefficient < N; offset += 3) {
      const candidate =
        (block[offset] | (block[offset + 1] << 8) | (block[offset + 2] << 16)) & 0x7fffff;
      if (candidate < Q) polynomial[coefficient++] = candidate;
    }
  }
  return polynomial;
}

function writePolynomial(view, offset, polynomial) {
  for (const coefficient of polynomial) {
    view.setUint32(offset, coefficient);
    offset += 4;
  }
  return offset;
}

// The draft EIP uses tr[32] and signs the raw 32-byte message. This differs
// from noble's public FIPS 204 API, so the internal API receives a precomputed
// EIP-8051 message representative instead.
export function generateNistKeyPair(seed = randomBytes(32)) {
  const privateSeed = bytes(seed, 32, "private seed");
  const { publicKey, secretKey } = ml_dsa44.keygen(privateSeed);
  return { privateSeed, publicKey, secretKey };
}

export function signNist(message, secretKey, randomness = randomBytes(32)) {
  const msg = bytes(message, 32, "message");
  const rnd = bytes(randomness, 32, "signing randomness");
  const publicKey = ml_dsa44.getPublicKey(secretKey);
  const tr = shake256(publicKey, { dkLen: 32 });
  const mu = shake256.create({ dkLen: 64 }).update(tr).update(msg).digest();
  return ml_dsa44.internal.sign(mu, secretKey, {
    externalMu: true,
    extraEntropy: rnd,
  });
}

export function verifyNistLocally(message, signature, publicKey) {
  const msg = bytes(message, 32, "message");
  const sig = bytes(signature, SIGNATURE_SIZE, "signature");
  const key = bytes(publicKey, COMPACT_PUBLIC_KEY_SIZE, "compact public key");
  const tr = shake256(key, { dkLen: 32 });
  const mu = shake256.create({ dkLen: 64 }).update(tr).update(msg).digest();
  return ml_dsa44.internal.verify(sig, mu, key, { externalMu: true });
}

// Expands rho || t1 into EIP-8051's A_hat || tr[32] || NTT(2^d * t1).
// The ETH variant only changes matrix/hash expansion; its signing algorithm is
// intentionally left to the Go reference implementation because no compatible
// maintained JS signer is currently available.
export function expandPublicKey(compactPublicKey, variant = "nist") {
  const publicKey = bytes(compactPublicKey, COMPACT_PUBLIC_KEY_SIZE, "compact public key");
  if (variant !== "nist" && variant !== "eth") {
    throw new Error(`unsupported EIP-8051 variant ${variant}`);
  }

  const output = new Uint8Array(EXPANDED_PUBLIC_KEY_SIZE);
  const view = new DataView(output.buffer);
  const rho = publicKey.subarray(0, 32);
  let outputOffset = 0;
  const xof = variant === "nist" ? XOF128(rho) : undefined;

  for (let row = 0; row < K; row++) {
    for (let column = 0; column < L; column++) {
      const readBlock = variant === "nist"
        ? xof.get(column, row)
        : (() => {
            const read = createKeccakPrng(concat(rho, Uint8Array.of(column, row)));
            return () => read(168);
          })();
      outputOffset = writePolynomial(view, outputOffset, samplePolynomial(readBlock));
    }
  }
  xof?.clean();

  const tr = variant === "nist"
    ? shake256(publicKey, { dkLen: 32 })
    : keccakPrngHash(32, publicKey);
  output.set(tr, outputOffset);
  outputOffset += tr.length;

  for (let row = 0; row < K; row++) {
    const start = 32 + row * POLY_T1_SIZE;
    const t1 = t1Coder.decode(publicKey.subarray(start, start + POLY_T1_SIZE));
    for (let i = 0; i < t1.length; i++) t1[i] *= 1 << 13;
    crystals.NTT.encode(t1);
    outputOffset = writePolynomial(view, outputOffset, t1);
  }

  if (outputOffset !== output.length) {
    throw new Error(`expanded public key has ${outputOffset} bytes, expected ${output.length}`);
  }
  return output;
}
