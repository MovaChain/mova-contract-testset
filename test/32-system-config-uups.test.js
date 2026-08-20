const { expect } = require("chai");
const { ethers } = require("hardhat");
const { header, row, writeCall, deployWithRetry } = require("./_helpers");

const UPGRADE_ROLE = ethers.id("UPGRADE_ROLE");
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const PROBE_KEY = "MOVA_CONTRACT_TESTSET_UUPS_UPGRADE_PROBE";
const PROBE_VALUE = 424242n;
const TX_GAS = 500_000n;

function decodeUint(item) {
  expect(item.valueType).to.equal(2n);
  expect(ethers.dataLength(item.value)).to.equal(32);
  return ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], item.value)[0];
}

async function implementationAt(proxyAddress) {
  const slotValue = await ethers.provider.getStorage(
    proxyAddress,
    EIP1967_IMPLEMENTATION_SLOT
  );
  return ethers.getAddress(ethers.dataSlice(slotValue, 12));
}

describe("SystemConfig — UUPS implementation upgrade", function () {
  let deployer, implementationV1, implementationV2, proxy, configV1;

  before(async function () {
    [deployer] = await ethers.getSigners();

    const V1 = await ethers.getContractFactory("SystemConfig");
    const V2 = await ethers.getContractFactory("SystemConfigV2");
    const Proxy = await ethers.getContractFactory("SystemConfigProxy");

    implementationV1 = await deployWithRetry(V1);
    implementationV2 = await deployWithRetry(V2);
    proxy = await deployWithRetry(Proxy, [
      await implementationV1.getAddress(),
      V1.interface.encodeFunctionData("initialize"),
    ]);
    configV1 = V1.attach(await proxy.getAddress());
  });

  it("UPGRADE_ROLE upgrades to V2 and preserves namespaced UINT storage", async function () {
    header("UUPS upgrade SystemConfig V1 → V2");

    const proxyAddress = await proxy.getAddress();
    const implementationV1Address = await implementationV1.getAddress();
    const implementationV2Address = await implementationV2.getAddress();
    const deployerAddress = await deployer.getAddress();

    expect(await configV1.hasRole(UPGRADE_ROLE, deployerAddress)).to.equal(true);
    expect(await implementationAt(proxyAddress)).to.equal(implementationV1Address);

    const setReceipt = await writeCall(
      configV1,
      deployer,
      "setUint",
      [PROBE_KEY, PROBE_VALUE],
      TX_GAS
    );
    expect(setReceipt.status).to.equal(1);
    expect(decodeUint((await configV1.getConfigs([PROBE_KEY]))[0])).to.equal(PROBE_VALUE);

    const outsider = ethers.Wallet.createRandom().address;
    let outsiderRejected = false;
    try {
      await ethers.provider.call({
        from: outsider,
        to: proxyAddress,
        data: configV1.interface.encodeFunctionData("upgradeToAndCall", [
          implementationV2Address,
          "0x",
        ]),
      });
    } catch (_) {
      outsiderRejected = true;
    }

    const upgradeReceipt = await writeCall(
      configV1,
      deployer,
      "upgradeToAndCall",
      [implementationV2Address, "0x"],
      TX_GAS
    );
    const configV2 = await ethers.getContractAt("SystemConfigV2", proxyAddress, deployer);
    const storedValue = decodeUint((await configV2.getConfigs([PROBE_KEY]))[0]);

    row("V1 implementation", implementationV1Address);
    row("V2 implementation", implementationV2Address);
    row("unauthorized upgrade", outsiderRejected ? "REVERTED ✓" : "UNEXPECTED SUCCESS");
    row("upgrade tx status", upgradeReceipt.status === 1 ? "OK" : "FAILED");
    row("V2 version", (await configV2.version()).toString());
    row("preserved probe value", storedValue.toString());

    expect(outsiderRejected).to.equal(true);
    expect(upgradeReceipt.status).to.equal(1);
    expect(await implementationAt(proxyAddress)).to.equal(implementationV2Address);
    expect(await configV2.version()).to.equal(2n);
    expect(storedValue).to.equal(PROBE_VALUE);
  });
});
