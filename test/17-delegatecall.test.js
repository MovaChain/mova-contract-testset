const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

// DELEGATECALL / Proxy upgrade test
//
// Pattern:
//   1. Deploy LogicV1 and LogicV2.
//   2. Deploy SimpleProxy pointing to LogicV1.
//   3. Call setValue(42) through the proxy → proxy's slot 0 stores 42.
//   4. Read value through the proxy → 42 (V1 behaviour: stores as-is).
//   5. Upgrade proxy to LogicV2.
//   6. Call setValue(10) through the proxy → slot 0 stores 20 (V2 doubles).
//   7. Read value → 20.  Storage slot 0 is the same; logic changed.
//
// Key assertions:
//   - After each setValue the value read back matches the expected result.
//   - implementation() returns the correct address after each upgrade.
//   - Storage layout is preserved across upgrades.

const CALL_GAS = 200_000n;

describe("DELEGATECALL / Proxy upgrade pattern", function () {
  let v1, v2, proxy, proxyAsV1, proxyAsV2;
  let deployer;

  before(async () => {
    [deployer] = await ethers.getSigners();

    const V1 = await ethers.getContractFactory("LogicV1");
    const V2 = await ethers.getContractFactory("LogicV2");
    const PF = await ethers.getContractFactory("SimpleProxy");

    v1 = await deployWithRetry(V1);
    v2 = await deployWithRetry(V2);

    proxy = await deployWithRetry(PF, [await v1.getAddress()]);
    await proxy.waitForDeployment();

    // Attach logic ABI to the proxy address so we can call business functions.
    proxyAsV1 = V1.attach(await proxy.getAddress());
    proxyAsV2 = V2.attach(await proxy.getAddress());
  });

  // ── initial implementation ───────────────────────────────────────────────
  it("proxy starts pointing at LogicV1 and version() returns 'v1'", async function () {
    header("proxy initial state");

    const impl    = await proxy.implementation();
    const v1Addr  = await v1.getAddress();
    const version = await proxyAsV1.version();

    row("implementation()", impl);
    row("LogicV1 address",  v1Addr);
    row("version()",        version);

    expect(impl.toLowerCase()).to.equal(v1Addr.toLowerCase());
    expect(version).to.equal("v1");
  });

  // ── setValue via V1 ──────────────────────────────────────────────────────
  it("setValue(42) through proxy (V1) stores 42 in proxy's slot 0", async function () {
    header("DELEGATECALL: setValue via LogicV1");

    const rcpt = await writeCall(proxyAsV1, deployer, "setValue", [42n], CALL_GAS);
    const val  = await proxyAsV1.value();

    row("setValue(42) tx status", rcpt.status === 1 ? "OK" : "FAILED");
    row("proxy value (slot 0)",   val.toString());

    expect(rcpt.status).to.equal(1);
    expect(val).to.equal(42n);
  });

  // ── upgrade to V2 ────────────────────────────────────────────────────────
  it("upgradeTo(V2) changes the implementation; storage is preserved", async function () {
    header("upgrade proxy to LogicV2");

    const v2Addr = await v2.getAddress();
    const rcpt   = await writeCall(proxy, deployer, "upgradeTo", [v2Addr], CALL_GAS);

    const impl   = await proxy.implementation();
    const val    = await proxyAsV2.value(); // still reads slot 0 of proxy

    row("upgradeTo tx status",   rcpt.status === 1 ? "OK" : "FAILED");
    row("new implementation()",  impl);
    row("value after upgrade",   val.toString());   // must still be 42

    expect(rcpt.status).to.equal(1);
    expect(impl.toLowerCase()).to.equal(v2Addr.toLowerCase());
    expect(val).to.equal(42n);   // storage preserved through upgrade
  });

  // ── setValue via V2 ──────────────────────────────────────────────────────
  it("setValue(10) through proxy (V2) stores 20 — V2 doubles the input", async function () {
    header("DELEGATECALL: setValue via LogicV2");

    const version = await proxyAsV2.version();
    row("version()", version);
    expect(version).to.equal("v2");

    const rcpt = await writeCall(proxyAsV2, deployer, "setValue", [10n], CALL_GAS);
    const val  = await proxyAsV2.value();

    row("setValue(10) tx status",  rcpt.status === 1 ? "OK" : "FAILED");
    row("proxy value (slot 0)",    val.toString());
    row("expected (10 × 2)",       "20");

    expect(rcpt.status).to.equal(1);
    expect(val).to.equal(20n);   // V2 doubles: 10 * 2 = 20
  });

  // ── logic contracts unaffected ───────────────────────────────────────────
  it("logic contracts' own storage is untouched by proxy calls", async function () {
    header("logic contracts' storage isolation");

    const v1val = await v1.value();
    const v2val = await v2.value();

    row("LogicV1.value (own storage)", v1val.toString());
    row("LogicV2.value (own storage)", v2val.toString());

    // All writes went to the proxy's storage via DELEGATECALL.
    expect(v1val).to.equal(0n);
    expect(v2val).to.equal(0n);
  });
});
