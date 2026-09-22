const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { header, row, deployWithRetry } = require("./_helpers");

const TX_GAS = 420_000n;
const FEE_CAP = 5_000_000_000n;
const AUTHORIZATION_GAS = 25_000n;
const DELEGATION_PREFIX = "0xef0100";
const SECP256K1_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

function rlpInteger(value) {
  value = BigInt(value);
  return value === 0n ? "0x" : ethers.toBeHex(value);
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

function resignType4Fields(wallet, fields) {
  const unsignedFields = fields.slice(0, 10);
  const digest = ethers.keccak256(ethers.concat(["0x04", ethers.encodeRlp(unsignedFields)]));
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

function mutateType4(wallet, raw, mutate) {
  const fields = ethers.decodeRlp(ethers.dataSlice(raw, 1));
  mutate(fields);
  return resignType4Fields(wallet, fields);
}

function errorText(error) {
  return [error?.shortMessage, error?.reason, error?.message, error?.info?.error?.message]
    .filter(Boolean)
    .join(" | ");
}

async function expectValidationFailure(action) {
  try {
    await action();
    expect.fail("expected the node to reject the request");
  } catch (error) {
    const message = errorText(error);
    expect(message).not.to.match(/ECONN|network error|timeout|socket hang up/i);
    expect(message).to.match(/invalid|intrinsic|authorization|chain|type|empty|rlp|decode|size|gas/i);
    return message;
  }
}

describe("EIP-7702 — advanced authorization and execution semantics", function () {
  let chainId;
  let payer;
  let sponsoredAuthority;
  let probe;
  let probeV2;
  let harness;
  let probeAddress;
  let probeV2Address;
  let transientAuthorities;

  before(async function () {
    if (network.name === "hardhat") this.skip();
    if (!process.env.DEPLOY_PRIVATE_KEY || !process.env.EIP7702_AUTHORITY_PRIVATE_KEY) {
      throw new Error("DEPLOY_PRIVATE_KEY and EIP7702_AUTHORITY_PRIVATE_KEY are required");
    }
    chainId = (await ethers.provider.getNetwork()).chainId;
    payer = new ethers.Wallet(process.env.DEPLOY_PRIVATE_KEY, ethers.provider);
    sponsoredAuthority = new ethers.Wallet(
      process.env.EIP7702_AUTHORITY_PRIVATE_KEY,
      ethers.provider
    );
    probe = await deployWithRetry(await ethers.getContractFactory("EIP7702Probe", payer));
    probeV2 = await deployWithRetry(await ethers.getContractFactory("EIP7702ProbeV2", payer));
    harness = await deployWithRetry(await ethers.getContractFactory("EIP7702CallHarness", payer));
    probeAddress = await probe.getAddress();
    probeV2Address = await probeV2.getAddress();
  });

  beforeEach(function () {
    transientAuthorities = [];
  });

  function newAuthority() {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    transientAuthorities.push(wallet);
    return wallet;
  }

  async function clearDelegation(authority, outer = payer) {
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
    await clearDelegation(payer, payer);
    await clearDelegation(sponsoredAuthority, payer);
    for (const authority of transientAuthorities) {
      await clearDelegation(authority, payer);
    }
  });

  it("continues through mixed invalid and valid entries, including multiple authorities", async function () {
    header("mixed authorization list + multiple authorities");
    const invalidAuthority = newAuthority();
    const first = newAuthority();
    const second = newAuthority();
    const payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const invalid = await signedAuthorization(invalidAuthority, probeAddress, 7n, chainId);
    const firstValid = await signedAuthorization(first, probeAddress, 0n, chainId);
    const secondValid = await signedAuthorization(second, probeV2Address, 0n, chainId);
    const { receipt } = await sendType4(payer, {
      nonce: payerNonce,
      to: payer.address,
      authorizationList: [invalid, firstValid, secondValid],
    });

    expect(receipt.status).to.equal(1);
    expect(await ethers.provider.getTransactionCount(payer.address, "latest")).to.equal(payerNonce + 1);
    expect(await ethers.provider.getTransactionCount(invalidAuthority.address, "latest")).to.equal(0);
    expect(await ethers.provider.getCode(invalidAuthority.address)).to.equal("0x");
    expect(await ethers.provider.getTransactionCount(first.address, "latest")).to.equal(1);
    expect(await ethers.provider.getTransactionCount(second.address, "latest")).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(first.address))).to.equal(probeAddress);
    expect(delegatedTarget(await ethers.provider.getCode(second.address))).to.equal(probeV2Address);
  });

  it("applies later valid entries after an invalid entry for the same authority", async function () {
    header("invalid + valid + valid for one authority");
    const authority = newAuthority();
    const payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const invalid = await signedAuthorization(authority, probeV2Address, 9n, chainId);
    const valid0 = await signedAuthorization(authority, probeAddress, 0n, chainId);
    const valid1 = await signedAuthorization(authority, probeV2Address, 1n, chainId);
    const { receipt } = await sendType4(payer, {
      nonce: payerNonce,
      to: authority.address,
      data: probeV2.interface.encodeFunctionData("answer"),
      authorizationList: [invalid, valid0, valid1],
    });

    expect(receipt.status).to.equal(1);
    expect(await ethers.provider.getTransactionCount(authority.address, "latest")).to.equal(2);
    expect(delegatedTarget(await ethers.provider.getCode(authority.address))).to.equal(probeV2Address);
    expect(await new ethers.Contract(authority.address, probeV2.interface, ethers.provider).answer()).to.equal(43n);
  });

  it("ignores duplicate authorizations and cross-transaction replays without incrementing authority nonce", async function () {
    header("duplicate and replay protection");
    const authority = newAuthority();
    let payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const authorization = await signedAuthorization(authority, probeAddress, 0n, chainId);
    let result = await sendType4(payer, {
      nonce: payerNonce,
      to: payer.address,
      authorizationList: [authorization, authorization],
    });
    expect(result.receipt.status).to.equal(1);
    expect(await ethers.provider.getTransactionCount(authority.address, "latest")).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(authority.address))).to.equal(probeAddress);

    payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    result = await sendType4(payer, {
      nonce: payerNonce,
      to: authority.address,
      data: probe.interface.encodeFunctionData("answer"),
      authorizationList: [authorization],
    });
    expect(result.receipt.status).to.equal(1);
    expect(await ethers.provider.getTransactionCount(authority.address, "latest")).to.equal(1);
    expect(await ethers.provider.getTransactionCount(payer.address, "latest")).to.equal(payerNonce + 1);
  });

  it("uses an installed delegation from a later ordinary type-2 transaction", async function () {
    header("ordinary type-2 use after delegation");
    const authorityNonce = await ethers.provider.getTransactionCount(sponsoredAuthority.address, "latest");
    const payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const auth = await signedAuthorization(sponsoredAuthority, probeAddress, authorityNonce, chainId);
    const installed = await sendType4(payer, {
      nonce: payerNonce,
      to: payer.address,
      authorizationList: [auth],
    });
    expect(installed.receipt.status).to.equal(1);

    const valueBefore = await new ethers.Contract(
      sponsoredAuthority.address,
      probe.interface,
      ethers.provider
    ).value();
    const newValue = valueBefore + 1001n;
    const raw = await sponsoredAuthority.signTransaction({
      type: 2,
      chainId,
      nonce: authorityNonce + 1,
      to: sponsoredAuthority.address,
      data: probe.interface.encodeFunctionData("store", [newValue]),
      gasLimit: 150_000n,
      maxPriorityFeePerGas: 0n,
      maxFeePerGas: FEE_CAP,
    });
    const hash = await ethers.provider.send("eth_sendRawTransaction", [raw]);
    const receipt = await waitReceipt(hash);

    expect(receipt.status).to.equal(1);
    expect(receipt.type).to.equal(2);
    expect(await new ethers.Contract(
      sponsoredAuthority.address,
      probe.interface,
      ethers.provider
    ).value()).to.equal(newValue);
    expect(await ethers.provider.getTransactionCount(sponsoredAuthority.address, "latest")).to.equal(authorityNonce + 2);
  });

  it("uses an installed delegation from a later ordinary legacy transaction", async function () {
    header("ordinary legacy transaction use after delegation");
    const authorityNonce = await ethers.provider.getTransactionCount(sponsoredAuthority.address, "latest");
    const payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const auth = await signedAuthorization(sponsoredAuthority, probeAddress, authorityNonce, chainId);
    const installed = await sendType4(payer, {
      nonce: payerNonce,
      to: payer.address,
      authorizationList: [auth],
    });
    expect(installed.receipt.status).to.equal(1);

    const delegated = new ethers.Contract(sponsoredAuthority.address, probe.interface, ethers.provider);
    const valueBefore = await delegated.value();
    const newValue = valueBefore + 2002n;
    const raw = await sponsoredAuthority.signTransaction({
      type: 0,
      chainId,
      nonce: authorityNonce + 1,
      to: sponsoredAuthority.address,
      data: probe.interface.encodeFunctionData("store", [newValue]),
      gasLimit: 150_000n,
      gasPrice: FEE_CAP,
    });
    const hash = await ethers.provider.send("eth_sendRawTransaction", [raw]);
    const receipt = await waitReceipt(hash);

    expect(receipt.status).to.equal(1);
    expect(receipt.type).to.equal(0);
    expect(await delegated.value()).to.equal(newValue);
    expect(await ethers.provider.getTransactionCount(sponsoredAuthority.address, "latest")).to.equal(authorityNonce + 2);
  });

  it("preserves authority context across CALL and uses caller context for DELEGATECALL and CALLCODE", async function () {
    header("CALL / STATICCALL / DELEGATECALL / CALLCODE");
    const authority = newAuthority();
    const payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const auth = await signedAuthorization(authority, probeAddress, 0n, chainId);
    const installed = await sendType4(payer, {
      nonce: payerNonce,
      to: payer.address,
      authorizationList: [auth],
    });
    expect(installed.receipt.status).to.equal(1);

    let tx = await harness.callStore(authority.address, 111n);
    expect((await tx.wait()).status).to.equal(1);
    expect(await ethers.provider.getStorage(authority.address, 0)).to.equal(ethers.zeroPadValue("0x6f", 32));

    const [staticOK, answerData] = await harness.staticAnswer(authority.address);
    expect(staticOK).to.equal(true);
    expect(ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], answerData)[0]).to.equal(42n);
    const [writeOK] = await harness.staticStore(authority.address, 222n);
    expect(writeOK).to.equal(false);
    expect(await ethers.provider.getStorage(authority.address, 0)).to.equal(ethers.zeroPadValue("0x6f", 32));

    tx = await harness.delegateStore(authority.address, 333n);
    expect((await tx.wait()).status).to.equal(1);
    expect(await harness.value()).to.equal(333n);
    tx = await harness.callcodeStore(authority.address, 444n);
    expect((await tx.wait()).status).to.equal(1);
    expect(await harness.value()).to.equal(444n);
  });

  it("exposes the designation to EXTCODE operations but implementation bytes to CODE operations", async function () {
    header("EXTCODE* and CODE* semantics");
    const authority = newAuthority();
    const auth = await signedAuthorization(authority, probeAddress, 0n, chainId);
    const result = await sendType4(payer, {
      to: payer.address,
      authorizationList: [auth],
    });
    expect(result.receipt.status).to.equal(1);

    const designation = await ethers.provider.getCode(authority.address);
    const [size, hash, firstWord] = await harness.codeInfo(authority.address);
    const paddedDesignation = ethers.concat([designation, new Uint8Array(32 - ethers.dataLength(designation))]);
    expect(size).to.equal(23n);
    expect(hash).to.equal(ethers.keccak256(designation));
    expect(firstWord).to.equal(ethers.hexlify(paddedDesignation));

    const directInfo = await probe.executingCodeInfo();
    const delegated = new ethers.Contract(authority.address, probe.interface, ethers.provider);
    const delegatedInfo = await delegated.executingCodeInfo();
    expect(delegatedInfo[0]).to.equal(directInfo[0]);
    expect(delegatedInfo[1]).to.equal(directInfo[1]);
  });

  it("reports sender, origin, value, balance, storage and event address in delegated execution", async function () {
    header("complete delegated execution context");
    const authority = newAuthority();
    const payerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const amount = 12_345n;
    const stored = 556677n;
    const balanceBefore = await ethers.provider.getBalance(authority.address);
    const auth = await signedAuthorization(authority, probeAddress, 0n, chainId);
    const data = probe.interface.encodeFunctionData("observe", [stored]);
    const { receipt } = await sendType4(payer, {
      nonce: payerNonce,
      to: authority.address,
      value: amount,
      data,
      authorizationList: [auth],
    });

    expect(receipt.status).to.equal(1);
    expect(await ethers.provider.getBalance(authority.address)).to.equal(balanceBefore + amount);
    expect(await ethers.provider.getStorage(authority.address, 0)).to.equal(ethers.zeroPadValue(ethers.toBeHex(stored), 32));
    expect(receipt.logs).to.have.length(1);
    expect(receipt.logs[0].address).to.equal(authority.address);
    const event = probe.interface.parseLog(receipt.logs[0]);
    expect(event.args.executionAddress).to.equal(authority.address);
    expect(event.args.sender).to.equal(payer.address);
    expect(event.args.origin).to.equal(payer.address);
    expect(event.args.msgValue).to.equal(amount);
    expect(event.args.storedValue).to.equal(stored);
  });

  it("preserves storage and balance across redelegation, clearing and reauthorization", async function () {
    header("state lifecycle across delegate / upgrade / clear / delegate");
    const authority = newAuthority();
    const stored = 7654321n;
    const balanceBefore = await ethers.provider.getBalance(authority.address);
    let authorityNonce = 0n;

    let auth = await signedAuthorization(authority, probeAddress, authorityNonce, chainId);
    let result = await sendType4(payer, { to: payer.address, authorizationList: [auth] });
    expect(result.receipt.status).to.equal(1);
    let tx = await harness.callStore(authority.address, stored);
    expect((await tx.wait()).status).to.equal(1);

    authorityNonce += 1n;
    auth = await signedAuthorization(authority, probeV2Address, authorityNonce, chainId);
    result = await sendType4(payer, { to: payer.address, authorizationList: [auth] });
    expect(result.receipt.status).to.equal(1);
    authorityNonce += 1n;
    auth = await signedAuthorization(authority, ethers.ZeroAddress, authorityNonce, chainId);
    result = await sendType4(payer, { to: payer.address, authorizationList: [auth] });
    expect(result.receipt.status).to.equal(1);
    expect(await ethers.provider.getCode(authority.address)).to.equal("0x");

    authorityNonce += 1n;
    auth = await signedAuthorization(authority, probeAddress, authorityNonce, chainId);
    result = await sendType4(payer, { to: payer.address, authorizationList: [auth] });
    expect(result.receipt.status).to.equal(1);
    const delegated = new ethers.Contract(authority.address, probe.interface, ethers.provider);
    expect(await delegated.value()).to.equal(stored);
    expect(await ethers.provider.getBalance(authority.address)).to.equal(balanceBefore);
    expect(await ethers.provider.getTransactionCount(authority.address, "latest")).to.equal(4);
  });

  it("retains authorization while reverting INVALID and out-of-gas execution", async function () {
    header("INVALID and OOG execution matrix");
    for (const [method, gasLimit] of [["failInvalid", 120_000n], ["burnGas", 80_000n]]) {
      const authority = newAuthority();
      const auth = await signedAuthorization(authority, probeAddress, 0n, chainId);
      const { receipt } = await sendType4(payer, {
        to: authority.address,
        data: probe.interface.encodeFunctionData(method),
        gasLimit,
        authorizationList: [auth],
      });
      expect(receipt.status, method).to.equal(0);
      expect(delegatedTarget(await ethers.provider.getCode(authority.address)), method).to.equal(probeAddress);
      expect(await ethers.provider.getTransactionCount(authority.address, "latest"), method).to.equal(1);
    }
  });

  it("handles chained, self, cyclic and precompile delegation targets without recursive resolution", async function () {
    header("one-hop, self, cycle and precompile targets");
    const first = newAuthority();
    const second = newAuthority();
    const self = newAuthority();
    const cycleA = newAuthority();
    const cycleB = newAuthority();
    const precompileAuthority = newAuthority();
    let authSecond = await signedAuthorization(second, probeAddress, 0n, chainId);
    let result = await sendType4(payer, { to: payer.address, authorizationList: [authSecond] });
    expect(result.receipt.status).to.equal(1);
    const authFirst = await signedAuthorization(first, second.address, 0n, chainId);
    result = await sendType4(payer, { to: payer.address, authorizationList: [authFirst] });
    expect(result.receipt.status).to.equal(1);

    await expectValidationFailure(() => ethers.provider.call({
      to: first.address,
      data: probe.interface.encodeFunctionData("answer"),
    }));
    expect(delegatedTarget(await ethers.provider.getCode(first.address))).to.equal(second.address);

    const selfAuth = await signedAuthorization(self, self.address, 0n, chainId);
    result = await sendType4(payer, { to: payer.address, authorizationList: [selfAuth] });
    expect(result.receipt.status).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(self.address))).to.equal(self.address);
    await expectValidationFailure(() => ethers.provider.call({
      to: self.address,
      data: probe.interface.encodeFunctionData("answer"),
    }));

    const cycleAAuth = await signedAuthorization(cycleA, cycleB.address, 0n, chainId);
    const cycleBAuth = await signedAuthorization(cycleB, cycleA.address, 0n, chainId);
    result = await sendType4(payer, {
      to: payer.address,
      authorizationList: [cycleAAuth, cycleBAuth],
    });
    expect(result.receipt.status).to.equal(1);
    expect(delegatedTarget(await ethers.provider.getCode(cycleA.address))).to.equal(cycleB.address);
    expect(delegatedTarget(await ethers.provider.getCode(cycleB.address))).to.equal(cycleA.address);
    await expectValidationFailure(() => ethers.provider.call({
      to: cycleA.address,
      data: probe.interface.encodeFunctionData("answer"),
    }));

    const precompile = ethers.getAddress("0x0000000000000000000000000000000000000001");
    const precompileAuth = await signedAuthorization(precompileAuthority, precompile, 0n, chainId);
    result = await sendType4(payer, { to: payer.address, authorizationList: [precompileAuth] });
    expect(result.receipt.status).to.equal(1);
    expect(await ethers.provider.call({ to: precompileAuthority.address, data: "0x" })).to.equal("0x");
  });

  it("charges every authorization entry and applies the existing-account refund", async function () {
    header("authorization intrinsic gas and refund relationships");
    const one = newAuthority();
    const twoA = newAuthority();
    const twoB = newAuthority();
    let invalid = await signedAuthorization(one, probeAddress, 99n, chainId);
    let result = await sendType4(payer, { to: payer.address, authorizationList: [invalid] });
    const oneEntryGas = result.receipt.gasUsed;
    const invalidA = await signedAuthorization(twoA, probeAddress, 99n, chainId);
    const invalidB = await signedAuthorization(twoB, probeAddress, 99n, chainId);
    result = await sendType4(payer, { to: payer.address, authorizationList: [invalidA, invalidB] });
    const twoEntryGas = result.receipt.gasUsed;
    expect(twoEntryGas - oneEntryGas).to.equal(AUTHORIZATION_GAS);

    const existingNonce = BigInt(await ethers.provider.getTransactionCount(sponsoredAuthority.address, "latest"));
    invalid = await signedAuthorization(sponsoredAuthority, probeAddress, existingNonce + 100n, chainId);
    result = await sendType4(payer, { to: payer.address, authorizationList: [invalid] });
    const invalidExistingGas = result.receipt.gasUsed;
    const valid = await signedAuthorization(sponsoredAuthority, probeAddress, existingNonce, chainId);
    result = await sendType4(payer, { to: payer.address, authorizationList: [valid] });
    const validExistingGas = result.receipt.gasUsed;
    row("one invalid entry gas", oneEntryGas.toString());
    row("two invalid entries gas", twoEntryGas.toString());
    row("valid existing authority gas", validExistingGas.toString());
    expect(validExistingGas).to.be.lessThan(invalidExistingGas);
  });

  it("rejects signature, integer, address, creation and non-canonical RLP boundaries atomically", async function () {
    header("signature and RLP boundary validation");
    const authority = newAuthority();
    const validAuth = await signedAuthorization(authority, probeAddress, 0n, chainId);
    for (const [name, mutate] of [
      ["r=0", (fields) => { fields[9][0][4] = "0x"; }],
      ["s=0", (fields) => { fields[9][0][5] = "0x"; }],
      ["high-s", (fields) => { fields[9][0][5] = ethers.toBeHex(SECP256K1_N - 1n); }],
    ]) {
      const nonce = await ethers.provider.getTransactionCount(payer.address, "latest");
      const baseRaw = await rawType4(payer, {
        nonce,
        to: payer.address,
        authorizationList: [validAuth],
      });
      const raw = mutateType4(payer, baseRaw, mutate);
      const hash = await ethers.provider.send("eth_sendRawTransaction", [raw]);
      const receipt = await waitReceipt(hash);
      expect(receipt.status, name).to.equal(1);
      expect(await ethers.provider.getTransactionCount(authority.address, "latest"), name).to.equal(0);
      expect(await ethers.provider.getCode(authority.address), name).to.equal("0x");
    }

    const maxUint64Auth = await signedAuthorization(
      authority,
      probeAddress,
      (1n << 64n) - 1n,
      chainId
    );
    const maxUint64Result = await sendType4(payer, {
      to: payer.address,
      authorizationList: [maxUint64Auth],
    });
    expect(maxUint64Result.receipt.status).to.equal(1);
    expect(await ethers.provider.getTransactionCount(authority.address, "latest")).to.equal(0);
    expect(await ethers.provider.getCode(authority.address)).to.equal("0x");

    const currentPayerNonce = await ethers.provider.getTransactionCount(payer.address, "latest");
    const freshRaw = await rawType4(payer, {
      nonce: currentPayerNonce,
      to: payer.address,
      authorizationList: [validAuth],
    });
    const malformedAddress = mutateType4(payer, freshRaw, (fields) => {
      fields[9][0][1] = ethers.dataSlice(fields[9][0][1], 1);
    });
    await expectValidationFailure(() => ethers.provider.send("eth_sendRawTransaction", [malformedAddress]));

    const creation = mutateType4(payer, freshRaw, (fields) => { fields[5] = "0x"; });
    await expectValidationFailure(() => ethers.provider.send("eth_sendRawTransaction", [creation]));

    const overflowingAuth = await signedAuthorization(authority, probeAddress, 1n << 64n, chainId);
    const overflowRaw = await rawType4(payer, {
      nonce: currentPayerNonce,
      to: payer.address,
      authorizationList: [overflowingAuth],
    });
    await expectValidationFailure(() => ethers.provider.send("eth_sendRawTransaction", [overflowRaw]));

    const nonCanonical = mutateType4(payer, freshRaw, (fields) => { fields[1] = "0x00"; });
    await expectValidationFailure(() => ethers.provider.send("eth_sendRawTransaction", [nonCanonical]));
    expect(await ethers.provider.getTransactionCount(payer.address, "latest")).to.equal(currentPayerNonce);
    expect(await ethers.provider.getTransactionCount(authority.address, "latest")).to.equal(0);
  });
});
