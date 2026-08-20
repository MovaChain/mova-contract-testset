const { expect } = require("chai");
const { ethers } = require("hardhat");
const { header, row, writeCall } = require("./_helpers");
const { attachSystemContract } = require("./_system-helpers");

const SYSTEM_CONFIG_ADDRESS = ethers.getAddress(
  "0x000000000000000000000000000000000000c0f1"
);
const CONFIG_KEYS = [
  "MOVA_CHAIN_CONFIG_HARD_FORK_EVM_OSAKA",
  "MOVA_CHAIN_CONFIG_HARD_FORK_FIX_RETURN_GAS",
  "MOVA_CHAIN_CONFIG_HARD_FORK_OPT_SETLOG",
];
const PROBE_KEY = "MOVA_CONTRACT_TESTSET_SYSTEM_CONFIG_PROBE";
const CONFIG_TYPE_NONE = 0n;
const CONFIG_TYPE_UINT = 2n;
const TX_GAS = 500_000n;
const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");

function decodeUint(item) {
  expect(item.valueType).to.equal(CONFIG_TYPE_UINT);
  expect(ethers.dataLength(item.value)).to.equal(32);
  return ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], item.value)[0];
}

describe("System contract — SysConfig", function () {
  let systemConfig, accessControl, currentUser, currentUserAddress, adminAddress, isAdmin;

  before(async function () {
    ({
      contract: systemConfig,
      currentUser,
      currentUserAddress,
      adminAddress,
    } =
      await attachSystemContract(this, "ISystemConfig", SYSTEM_CONFIG_ADDRESS));
    accessControl = await ethers.getContractAt(
      "ISystemConfigAccessControl",
      SYSTEM_CONFIG_ADDRESS,
      currentUser
    );
    isAdmin = await accessControl.hasRole(ADMIN_ROLE, currentUserAddress);
  });

  it("reports the configured AccessControl administrator roles", async function () {
    header("hasRole(DEFAULT_ADMIN_ROLE / ADMIN_ROLE)");
    const configuredHasDefaultAdmin = await accessControl.hasRole(
      DEFAULT_ADMIN_ROLE,
      adminAddress
    );
    const configuredHasAdmin = await accessControl.hasRole(ADMIN_ROLE, adminAddress);
    const currentUserHasAdmin = await accessControl.hasRole(
      ADMIN_ROLE,
      currentUserAddress
    );

    row("configured admin", adminAddress);
    row("configured DEFAULT_ADMIN_ROLE", configuredHasDefaultAdmin);
    row("configured ADMIN_ROLE", configuredHasAdmin);
    row("current user ADMIN_ROLE", currentUserHasAdmin);

    expect(configuredHasDefaultAdmin).to.equal(true);
    expect(configuredHasAdmin).to.equal(true);
    expect(currentUserHasAdmin).to.equal(isAdmin);
  });

  it("reads all node fork configuration keys", async function () {
    header("getConfigs(fork keys)");
    const items = await systemConfig.getConfigs(CONFIG_KEYS);

    expect(items).to.have.length(CONFIG_KEYS.length);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      expect([CONFIG_TYPE_NONE, CONFIG_TYPE_UINT]).to.include(item.valueType);

      if (item.valueType === CONFIG_TYPE_UINT) {
        row(CONFIG_KEYS[i], `UINT ${decodeUint(item)}`);
      } else {
        row(CONFIG_KEYS[i], "NONE (uses node default)");
        expect(item.value).to.equal("0x");
      }
    }
  });

  it("administrator can write single and batch UINT values", async function () {
    if (!isAdmin) this.skip();

    header("administrator setUint + setUintBatch → restore");
    const original = (await systemConfig.getConfigs([PROBE_KEY]))[0];
    const originalValue =
      original.valueType === CONFIG_TYPE_UINT ? decodeUint(original) : 0n;
    let firstValue = BigInt(await ethers.provider.getBlockNumber()) + 1n;
    if (firstValue === originalValue) firstValue += 1n;
    const secondValue = firstValue + 1n;
    let setReceipt;
    let batchReceipt;
    let afterSet;
    let afterBatch;
    let restoreReceipt;

    try {
      setReceipt = await writeCall(
        systemConfig,
        currentUser,
        "setUint",
        [PROBE_KEY, firstValue],
        TX_GAS
      );
      afterSet = (await systemConfig.getConfigs([PROBE_KEY]))[0];

      batchReceipt = await writeCall(
        systemConfig,
        currentUser,
        "setUintBatch",
        [[PROBE_KEY], [secondValue]],
        TX_GAS
      );
      afterBatch = (await systemConfig.getConfigs([PROBE_KEY]))[0];
    } finally {
      if (setReceipt?.status === 1 || batchReceipt?.status === 1) {
        // The interface has no delete operation. For a previously unset probe
        // key, UINT(0) is the least intrusive cleanup value.
        restoreReceipt = await writeCall(
          systemConfig,
          currentUser,
          "setUint",
          [PROBE_KEY, originalValue],
          TX_GAS
        );
      }
    }

    const restored = (await systemConfig.getConfigs([PROBE_KEY]))[0];
    row("setUint tx status", setReceipt?.status === 1 ? "OK" : "FAILED");
    row("setUint value", afterSet ? decodeUint(afterSet).toString() : "unavailable");
    row("setUintBatch tx status", batchReceipt?.status === 1 ? "OK" : "FAILED");
    row("batch value", afterBatch ? decodeUint(afterBatch).toString() : "unavailable");
    row("restore tx status", restoreReceipt?.status === 1 ? "OK" : "FAILED");
    row("restored value", decodeUint(restored).toString());

    expect(setReceipt?.status).to.equal(1);
    expect(decodeUint(afterSet)).to.equal(firstValue);
    expect(batchReceipt?.status).to.equal(1);
    expect(decodeUint(afterBatch)).to.equal(secondValue);
    expect(restoreReceipt?.status).to.equal(1);
    expect(decodeUint(restored)).to.equal(originalValue);
  });

  it("non-administrator cannot call protected writes", async function () {
    if (isAdmin) this.skip();

    header("non-administrator protected writes → revert");
    const before = (await systemConfig.getConfigs([PROBE_KEY]))[0];
    const probeValue = BigInt(await ethers.provider.getBlockNumber()) + 1n;
    const setReceipt = await writeCall(
      systemConfig,
      currentUser,
      "setUint",
      [PROBE_KEY, probeValue],
      TX_GAS
    );
    const batchReceipt = await writeCall(
      systemConfig,
      currentUser,
      "setUintBatch",
      [[PROBE_KEY], [probeValue + 1n]],
      TX_GAS
    );
    const after = (await systemConfig.getConfigs([PROBE_KEY]))[0];

    // Preserve chain state even when SYSTEM_ADMIN_ADDRESS was configured
    // incorrectly and a supposedly unauthorized write actually succeeded.
    if (setReceipt.status === 1 || batchReceipt.status === 1) {
      const cleanupValue =
        before.valueType === CONFIG_TYPE_UINT ? decodeUint(before) : 0n;
      await writeCall(
        systemConfig,
        currentUser,
        "setUint",
        [PROBE_KEY, cleanupValue],
        TX_GAS
      );
    }

    row("setUint status", setReceipt.status === 0 ? "REVERTED ✓" : "UNEXPECTED SUCCESS");
    row("setUintBatch status", batchReceipt.status === 0 ? "REVERTED ✓" : "UNEXPECTED SUCCESS");

    expect(setReceipt.status).to.equal(0);
    expect(batchReceipt.status).to.equal(0);
    expect(after.valueType).to.equal(before.valueType);
    expect(after.value).to.equal(before.value);
  });
});
