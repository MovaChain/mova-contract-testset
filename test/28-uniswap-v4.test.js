const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");
const poolManagerArtifact = require("@uniswap/v4-core/out/PoolManager.sol/PoolManager.json");

const TX_GAS = 600_000n;
const SQRT_PRICE_1_1 = 2n ** 96n;

function withoutImmutableValues(runtimeBytecode) {
  const bytes = ethers.getBytes(runtimeBytecode);

  for (const references of Object.values(poolManagerArtifact.deployedBytecode.immutableReferences)) {
    for (const { start, length } of references) bytes.fill(0, start, start + length);
  }

  return ethers.hexlify(bytes);
}

describe("Uniswap v4 — official PoolManager deployment, initialize ABI, slot0 read", function () {
  let manager, probe, tokenA, tokenB, deployer;

  before(async () => {
    [deployer] = await ethers.getSigners();
    const Manager = new ethers.ContractFactory(
      poolManagerArtifact.abi,
      poolManagerArtifact.bytecode.object,
      deployer
    );
    manager = await deployWithRetry(Manager, [deployer.address]);
    const Probe = await ethers.getContractFactory("UniswapV4PoolProbe");
    probe = await deployWithRetry(Probe);
    const Token = await ethers.getContractFactory("TestToken");
    tokenA = await deployWithRetry(Token);
    tokenB = await deployWithRetry(Token);
    const managerCode = await ethers.provider.getCode(await manager.getAddress());
    row("official v4 PoolManager", await manager.getAddress());
    row("upstream compiler", poolManagerArtifact.metadata.compiler.version);
    row("runtime code hash", ethers.keccak256(managerCode));
    row("v4 Osaka probe", await probe.getAddress());

    // The artifact's immutable owner is a zeroed template. Verify all other
    // runtime bytes exactly, then verify the constructor-specific owner below.
    expect(ethers.keccak256(withoutImmutableValues(managerCode))).to.equal(
      ethers.keccak256(withoutImmutableValues(poolManagerArtifact.deployedBytecode.object))
    );
    expect(await manager.owner()).to.equal(deployer.address);
  });

  it("initializes a sorted PoolKey through the official v4 ABI and reads slot0", async function () {
    header("initialize PoolKey(fee=3000, tickSpacing=60, no hooks)");
    const rcpt = await writeCall(
      probe,
      deployer,
      "initializeAndRead",
      [await manager.getAddress(), await tokenA.getAddress(), await tokenB.getAddress(), SQRT_PRICE_1_1],
      TX_GAS
    );
    const poolId = await probe.lastPoolId();
    const managerAddress = (await manager.getAddress()).toLowerCase();
    const initializeLog = rcpt.logs
      .filter((log) => log.address.toLowerCase() === managerAddress)
      .map((log) => {
        try { return manager.interface.parseLog(log); } catch (_) { return null; }
      })
      .find((event) => event?.name === "Initialize");
    const sqrtPrice = await probe.lastSqrtPriceX96();
    const tick = await probe.lastTick();
    const protocolFee = await probe.lastProtocolFee();
    const lpFee = await probe.lastLpFee();

    row("tx status", rcpt.status === 1 ? "OK" : "FAILED");
    row("poolId", poolId);
    row("Initialize event", initializeLog ? "emitted" : "missing");
    row("sqrtPriceX96", sqrtPrice.toString());
    row("tick", tick.toString());
    row("protocol fee", protocolFee.toString());
    row("LP fee", lpFee.toString());

    expect(rcpt.status).to.equal(1);
    expect(poolId).to.not.equal(ethers.ZeroHash);
    expect(initializeLog).to.not.equal(undefined);
    expect(initializeLog.args.id).to.equal(poolId);
    expect(sqrtPrice).to.equal(SQRT_PRICE_1_1);
    expect(tick).to.equal(0n);
    expect(protocolFee).to.equal(0n);
    expect(lpFee).to.equal(3_000n);
  });

  it("rejects duplicate initialization for the same PoolKey", async function () {
    header("same PoolKey initialize again → revert");
    const rcpt = await writeCall(
      probe,
      deployer,
      "initializeAndRead",
      [await manager.getAddress(), await tokenA.getAddress(), await tokenB.getAddress(), SQRT_PRICE_1_1],
      TX_GAS
    );
    row("tx status", rcpt.status === 0 ? "REVERTED ✓" : "UNEXPECTED SUCCESS");
    expect(rcpt.status).to.equal(0);
  });
});
