const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { header, row, deployWithRetry } = require("./_helpers");

const TX_GAS = 240_000n;
const LOW_GAS = 21_000n;
const FEE_CAP = 5_000_000_000n;
const DELEGATION_PREFIX = "0xef0100";

function quantity(value) {
  return ethers.toQuantity(BigInt(value));
}

function rlpInteger(value) {
  value = BigInt(value);
  return value === 0n ? "0x" : ethers.toBeHex(value);
}

function authorizationJson(auth) {
  return {
    chainId: quantity(auth.chainId),
    address: auth.address,
    nonce: quantity(auth.nonce),
    yParity: quantity(auth.signature.yParity),
    r: quantity(auth.signature.r),
    s: quantity(auth.signature.s),
  };
}

function delegatedTarget(code) {
  if (!code.toLowerCase().startsWith(DELEGATION_PREFIX) || ethers.dataLength(code) !== 23) {
    return null;
  }
  return ethers.getAddress(ethers.dataSlice(code, 3));
}

async function waitReceipt(hash) {
  for (let i = 0; i < 120; i++) {
    const receipt = await ethers.provider.getTransactionReceipt(hash);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`receipt timeout: ${hash}`);
}

async function signedAuthorization(wallet, target, nonce, chainId) {
  return wallet.authorize({ address: target, nonce, chainId });
}

async function rawType4(wallet, request) {
  const nonce = request.nonce ?? await ethers.provider.getTransactionCount(wallet.address, "latest");
  const networkInfo = await ethers.provider.getNetwork();
  return wallet.signTransaction({
    type: 4,
    chainId: request.chainId ?? networkInfo.chainId,
    nonce,
    to: request.to,
    value: request.value ?? 0n,
    data: request.data ?? "0x",
    gasLimit: request.gasLimit ?? TX_GAS,
    maxPriorityFeePerGas: request.maxPriorityFeePerGas ?? 0n,
    maxFeePerGas: request.maxFeePerGas ?? FEE_CAP,
    accessList: request.accessList ?? [],
    authorizationList: request.authorizationList ?? [],
  });
}

async function sendType4(wallet, request) {
  const raw = await rawType4(wallet, request);
  const hash = await ethers.provider.send("eth_sendRawTransaction", [raw]);
  return { raw, hash, receipt: await waitReceipt(hash) };
}

// Ethers intentionally refuses to construct an invalid Signature. Build the
// one malformed authorization case at the RLP layer, then re-sign the outer
// transaction so the node reaches ApplyAuthorization instead of rejecting the
// outer signature.
async function withInvalidAuthorizationParity(wallet, validRaw) {
  const fields = ethers.decodeRlp(ethers.dataSlice(validRaw, 1));
  fields[9][0][3] = "0x02";
  const unsignedFields = fields.slice(0, 10);
  const digest = ethers.keccak256(
    ethers.concat(["0x04", ethers.encodeRlp(unsignedFields)])
  );
  const signature = wallet.signingKey.sign(digest);
  return ethers.concat([
    "0x04",
    ethers.encodeRlp([
      ...unsignedFields,
      rlpInteger(signature.yParity),
      ethers.stripZerosLeft(signature.r),
      ethers.stripZerosLeft(signature.s),
    ]),
  ]);
}

describe("EIP-7702 — set-code transactions", function () {
  let chainId;
  let payer;
  let sponsoredAuthority;
  let probe;
  let probeV2;
  let probeAddress;
  let probeV2Address;

  before(async function () {
    if (network.name === "hardhat") {
      this.skip();
    }
    if (!process.env.DEPLOY_PRIVATE_KEY) {
      throw new Error("DEPLOY_PRIVATE_KEY is required for EIP-7702 tests");
    }
    if (!process.env.EIP7702_AUTHORITY_PRIVATE_KEY) {
      throw new Error("EIP7702_AUTHORITY_PRIVATE_KEY is required for sponsored tests");
    }

    chainId = (await ethers.provider.getNetwork()).chainId;
    payer = new ethers.Wallet(process.env.DEPLOY_PRIVATE_KEY, ethers.provider);
    sponsoredAuthority = new ethers.Wallet(
      process.env.EIP7702_AUTHORITY_PRIVATE_KEY,
      ethers.provider
    );
    expect(sponsoredAuthority.address).not.to.equal(payer.address);

    probe = await deployWithRetry(await ethers.getContractFactory("EIP7702Probe", payer));
    probeV2 = await deployWithRetry(await ethers.getContractFactory("EIP7702ProbeV2", payer));
    probeAddress = await probe.getAddress();
    probeV2Address = await probeV2.getAddress();
  });

  async function clearDelegation(authority, outer = authority) {
    if ((await ethers.provider.getCode(authority.address)) === "0x") return;
    const outerNonce = await ethers.provider.getTransactionCount(outer.address, "latest");
    const authorityNonce = authority.address === outer.address
      ? outerNonce + 1
      : await ethers.provider.getTransactionCount(authority.address, "latest");
    const auth = await signedAuthorization(authority, ethers.ZeroAddress, authorityNonce, chainId);
    const { receipt } = await sendType4(outer, {
      nonce: outerNonce,
      to: authority.address,
      authorizationList: [auth],
    });
    expect(receipt.status).to.equal(1);
    expect(await ethers.provider.getCode(authority.address)).to.equal("0x");
  }

  afterEach(async function () {
    await clearDelegation(payer).catch(() => {});
    await clearDelegation(sponsoredAuthority, payer).catch(() => {});
  });

  it("completes estimateGas, eth_call, send, execute, receipt lookup and trace", async function () {
    header("type-4 full JSON-RPC lifecycle");
    const nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const auth = await signedAuthorization(payer, probeAddress, nonce + 1, chainId);
    const data = probe.interface.encodeFunctionData("answer");
    const request = {
      type: 4,
      from: payer.address,
      to: payer.address,
      nonce,
      data,
      gasLimit: TX_GAS,
      maxPriorityFeePerGas: 0n,
      maxFeePerGas: FEE_CAP,
      accessList: [],
      authorizationList: [auth],
    };

    const estimate = await ethers.provider.estimateGas(request);
    const simulated = await ethers.provider.call(request);
    const { hash, receipt } = await sendType4(payer, request);
    const transaction = await ethers.provider.send("eth_getTransactionByHash", [hash]);
    const rpcReceipt = await ethers.provider.send("eth_getTransactionReceipt", [hash]);
    const trace = await ethers.provider.send("debug_traceTransaction", [hash, { tracer: "callTracer" }]);
    const code = await ethers.provider.getCode(payer.address);
    const delegated = new ethers.Contract(payer.address, probe.interface, ethers.provider);

    row("estimateGas", estimate.toString());
    row("eth_call answer", ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], simulated)[0]);
    row("transaction", hash);
    row("delegation target", delegatedTarget(code));
    row("gas used", receipt.gasUsed.toString());

    expect(estimate).to.be.greaterThan(21_000n);
    expect(ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], simulated)[0]).to.equal(42n);
    expect(receipt.status).to.equal(1);
    expect(receipt.type).to.equal(4);
    expect(rpcReceipt.type).to.equal("0x4");
    expect(transaction.type).to.equal("0x4");
    expect(transaction.authorizationList).to.have.length(1);
    expect(delegatedTarget(code)).to.equal(probeAddress);
    expect(await delegated.answer()).to.equal(42n);
    expect(trace).to.be.an("object");
  });

  it("supports redelegation and sequential entries for the same authority", async function () {
    header("redelegation + duplicate authority entries");
    let nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    let first = await signedAuthorization(payer, probeAddress, nonce + 1, chainId);
    let result = await sendType4(payer, {
      nonce,
      to: payer.address,
      data: probe.interface.encodeFunctionData("answer"),
      authorizationList: [first],
    });
    expect(result.receipt.status).to.equal(1);

    nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const toV2 = await signedAuthorization(payer, probeV2Address, nonce + 1, chainId);
    result = await sendType4(payer, {
      nonce,
      to: payer.address,
      data: probeV2.interface.encodeFunctionData("answer"),
      authorizationList: [toV2],
    });
    expect(result.receipt.status).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(payer.address))).to.equal(probeV2Address);

    nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    first = await signedAuthorization(payer, probeAddress, nonce + 1, chainId);
    const second = await signedAuthorization(payer, probeV2Address, nonce + 2, chainId);
    result = await sendType4(payer, {
      nonce,
      to: payer.address,
      data: probeV2.interface.encodeFunctionData("answer"),
      gasLimit: 320_000n,
      authorizationList: [first, second],
    });

    const delegatedV2 = new ethers.Contract(payer.address, probeV2.interface, ethers.provider);
    row("final target", delegatedTarget(await ethers.provider.getCode(payer.address)));
    row("final answer", await delegatedV2.answer());
    expect(result.receipt.status).to.equal(1);
    expect(await delegatedV2.answer()).to.equal(43n);
    expect(await ethers.provider.getTransactionCount(payer.address, "latest")).to.equal(nonce + 3);
  });

  it("ignores invalid nonce, chain ID and yParity without replacing existing delegation", async function () {
    header("invalid authorization entries are ignored");
    let nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    let auth = await signedAuthorization(payer, probeV2Address, nonce + 1, chainId);
    let result = await sendType4(payer, {
      nonce,
      to: payer.address,
      data: probeV2.interface.encodeFunctionData("answer"),
      authorizationList: [auth],
    });
    expect(result.receipt.status).to.equal(1);

    nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    auth = await signedAuthorization(payer, probeAddress, nonce + 100, chainId);
    result = await sendType4(payer, {
      nonce,
      to: payer.address,
      data: probeV2.interface.encodeFunctionData("answer"),
      authorizationList: [auth],
    });
    expect(result.receipt.status).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(payer.address))).to.equal(probeV2Address);

    nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    auth = await signedAuthorization(payer, probeAddress, nonce + 1, chainId + 1n);
    result = await sendType4(payer, {
      nonce,
      to: payer.address,
      data: probeV2.interface.encodeFunctionData("answer"),
      authorizationList: [auth],
    });
    expect(result.receipt.status).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(payer.address))).to.equal(probeV2Address);

    nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    auth = await signedAuthorization(payer, probeAddress, nonce + 1, chainId);
    const validRaw = await rawType4(payer, {
      nonce,
      to: payer.address,
      data: probeV2.interface.encodeFunctionData("answer"),
      authorizationList: [auth],
    });
    const invalidRaw = await withInvalidAuthorizationParity(payer, validRaw);
    const hash = await ethers.provider.send("eth_sendRawTransaction", [invalidRaw]);
    const receipt = await waitReceipt(hash);

    row("invalid yParity tx", hash);
    row("retained target", delegatedTarget(await ethers.provider.getCode(payer.address)));
    expect(receipt.status).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(payer.address))).to.equal(probeV2Address);
  });

  it("keeps an authorization when delegated execution reverts", async function () {
    header("authorization survives call revert");
    const nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const auth = await signedAuthorization(payer, probeAddress, nonce + 1, chainId);
    const { hash, receipt } = await sendType4(payer, {
      nonce,
      to: payer.address,
      data: probe.interface.encodeFunctionData("fail"),
      authorizationList: [auth],
    });
    const trace = await ethers.provider.send("debug_traceTransaction", [hash, { tracer: "callTracer" }]);

    row("reverted tx", hash);
    row("delegation retained", delegatedTarget(await ethers.provider.getCode(payer.address)));
    expect(receipt.status).to.equal(0);
    expect(delegatedTarget(await ethers.provider.getCode(payer.address))).to.equal(probeAddress);
    expect(trace).to.be.an("object");
  });

  it("accepts wildcard chain IDs and accounts for access lists in estimateGas", async function () {
    header("wildcard authorization + access-list estimate");
    const nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const wildcard = await signedAuthorization(payer, probeAddress, nonce + 1, 0n);
    const base = {
      type: 4,
      from: payer.address,
      to: payer.address,
      nonce,
      data: probe.interface.encodeFunctionData("answer"),
      gasLimit: TX_GAS,
      maxPriorityFeePerGas: 0n,
      maxFeePerGas: FEE_CAP,
      authorizationList: [wildcard],
      accessList: [],
    };
    const baseEstimate = await ethers.provider.estimateGas(base);
    const accessEstimate = await ethers.provider.estimateGas({
      ...base,
      accessList: [{ address: probeAddress, storageKeys: [ethers.zeroPadValue("0x01", 32)] }],
    });
    const { receipt } = await sendType4(payer, base);

    row("base estimate", baseEstimate.toString());
    row("access-list estimate", accessEstimate.toString());
    expect(accessEstimate).to.be.greaterThan(baseEstimate);
    expect(receipt.status).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(payer.address))).to.equal(probeAddress);
  });

  it("supports sponsored authorization and sponsored clearing", async function () {
    header("distinct payer and authority");
    let payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    let authorityNonce = await ethers.provider.getTransactionCount(sponsoredAuthority.address, "latest");
    let auth = await signedAuthorization(sponsoredAuthority, probeAddress, authorityNonce, chainId);
    let result = await sendType4(payer, {
      nonce: payerNonce,
      to: sponsoredAuthority.address,
      data: probe.interface.encodeFunctionData("answer"),
      authorizationList: [auth],
    });

    const delegated = new ethers.Contract(sponsoredAuthority.address, probe.interface, ethers.provider);
    expect(result.receipt.status).to.equal(1);
    expect(await delegated.answer()).to.equal(42n);
    expect(await ethers.provider.getTransactionCount(payer.address, "latest")).to.equal(payerNonce + 1);
    expect(await ethers.provider.getTransactionCount(sponsoredAuthority.address, "latest")).to.equal(authorityNonce + 1);

    payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    authorityNonce = await ethers.provider.getTransactionCount(sponsoredAuthority.address, "latest");
    auth = await signedAuthorization(sponsoredAuthority, ethers.ZeroAddress, authorityNonce, chainId);
    result = await sendType4(payer, {
      nonce: payerNonce,
      to: sponsoredAuthority.address,
      authorizationList: [auth],
    });

    row("sponsored clear tx", result.hash);
    expect(result.receipt.status).to.equal(1);
    expect(await ethers.provider.getCode(sponsoredAuthority.address)).to.equal("0x");
  });

  it("uses the authority address and storage as delegated execution context", async function () {
    header("ADDRESS and SSTORE execution context");
    let nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    let auth = await signedAuthorization(payer, probeAddress, nonce + 1, chainId);
    let result = await sendType4(payer, {
      nonce,
      to: payer.address,
      data: probe.interface.encodeFunctionData("contextAddress"),
      authorizationList: [auth],
    });
    expect(result.receipt.status).to.equal(1);

    const delegated = new ethers.Contract(payer.address, probe.interface, ethers.provider);
    expect(await delegated.contextAddress()).to.equal(payer.address);

    nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    auth = await signedAuthorization(payer, probeAddress, nonce + 1, chainId);
    result = await sendType4(payer, {
      nonce,
      to: payer.address,
      data: probe.interface.encodeFunctionData("store", [42n]),
      authorizationList: [auth],
    });

    row("authority slot 0", await ethers.provider.getStorage(payer.address, 0));
    row("implementation slot 0", await ethers.provider.getStorage(probeAddress, 0));
    expect(result.receipt.status).to.equal(1);
    expect(await delegated.value()).to.equal(42n);
    expect(await probe.value()).to.equal(0n);
  });

  it("allows delegation to an address with no code", async function () {
    header("empty delegation target");
    const emptyTarget = ethers.getAddress("0x00000000000000000000000000000000DeaDBeef");
    const nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const auth = await signedAuthorization(payer, emptyTarget, nonce + 1, chainId);
    const { receipt } = await sendType4(payer, {
      nonce,
      to: payer.address,
      authorizationList: [auth],
    });

    expect(receipt.status).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(payer.address))).to.equal(emptyTarget);
    expect(await ethers.provider.call({ to: payer.address })).to.equal("0x");
  });

  it("rejects low intrinsic gas, empty lists, RPC type mismatch and wrong outer chain", async function () {
    header("type-4 validation failures");
    const nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const auth = await signedAuthorization(payer, probeAddress, nonce + 1, chainId);

    const lowGasRaw = await rawType4(payer, {
      nonce,
      to: payer.address,
      gasLimit: LOW_GAS,
      authorizationList: [auth],
    });
    await expect(
      ethers.provider.send("eth_sendRawTransaction", [lowGasRaw])
    ).to.be.rejected;

    const emptyRaw = await rawType4(payer, {
      nonce,
      to: payer.address,
      authorizationList: [],
    });
    await expect(
      ethers.provider.send("eth_sendRawTransaction", [emptyRaw])
    ).to.be.rejected;

    await expect(
      ethers.provider.send("eth_estimateGas", [{
        type: "0x4",
        from: payer.address,
        to: payer.address,
        gas: quantity(TX_GAS),
        authorizationList: [],
      }])
    ).to.be.rejected;

    await expect(
      ethers.provider.send("eth_estimateGas", [{
        type: "0x2",
        from: payer.address,
        to: payer.address,
        gas: quantity(TX_GAS),
        authorizationList: [authorizationJson(auth)],
      }])
    ).to.be.rejected;

    const wrongChainRaw = await rawType4(payer, {
      chainId: chainId + 1n,
      nonce,
      to: payer.address,
      authorizationList: [auth],
    });
    await expect(
      ethers.provider.send("eth_sendRawTransaction", [wrongChainRaw])
    ).to.be.rejected;

    row("sender nonce unchanged", await ethers.provider.getTransactionCount(payer.address, "latest"));
    expect(await ethers.provider.getTransactionCount(payer.address, "latest")).to.equal(nonce);
  });
});
