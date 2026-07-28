const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

const AMM_GAS = 200_000n;

describe("Simple AMM — x*y=k constant product", function () {
  let amm, deployer;

  before(async () => {
    await ethers.provider.getBlockNumber();
    [deployer] = await ethers.getSigners();

    const F = await ethers.getContractFactory("SimpleAMM");
    amm = await deployWithRetry(F);
    row("SimpleAMM deployed at", await amm.getAddress());
  });

  // ── add liquidity ────────────────────────────────────────────────────────────
  it("addLiquidity sets initial reserves and K = rA * rB", async function () {
    header("addLiquidity(1000, 2000)");
    const rcpt = await writeCall(amm, deployer, "addLiquidity", [1000n, 2000n], AMM_GAS);

    const rA = await amm.reserveA();
    const rB = await amm.reserveB();
    const K  = await amm.getK();

    row("tx status", rcpt.status === 1 ? "OK" : "FAILED");
    row("reserveA",  rA.toString());
    row("reserveB",  rB.toString());
    row("K = rA*rB", K.toString());

    expect(rcpt.status).to.equal(1);
    expect(rA).to.equal(1000n);
    expect(rB).to.equal(2000n);
    expect(K).to.equal(2_000_000n);
  });

  // ── swapAForB ────────────────────────────────────────────────────────────────
  it("swapAForB(100): correct output, reserves update, K does not decrease", async function () {
    header("swapAForB(100)  [rA=1000, rB=2000]");

    const rA0    = await amm.reserveA();
    const rB0    = await amm.reserveB();
    const K0     = await amm.getK();
    const amtIn  = 100n;
    // expected: floor(2000*100 / 1100) = 181
    const expOut = (rB0 * amtIn) / (rA0 + amtIn);

    const rcpt  = await writeCall(amm, deployer, "swapAForB", [amtIn], AMM_GAS);
    const rA1   = await amm.reserveA();
    const rB1   = await amm.reserveB();
    const K1    = await amm.getK();
    const gotOut = await amm.lastAmountOut();

    row("tx status",  rcpt.status === 1 ? "OK" : "FAILED");
    row("amtIn  (A)", amtIn.toString());
    row("amtOut (B)", gotOut.toString() + "  (expected " + expOut.toString() + ")");
    row("reserveA",   rA0.toString() + " → " + rA1.toString());
    row("reserveB",   rB0.toString() + " → " + rB1.toString());
    row("K before",   K0.toString());
    row("K after",    K1.toString() + (K1 >= K0 ? "  ≥ K0 ✓" : "  < K0 ✗"));

    expect(rcpt.status).to.equal(1);
    expect(gotOut).to.equal(expOut);
    expect(rA1).to.equal(rA0 + amtIn);
    expect(rB1).to.equal(rB0 - expOut);
    // Floor division means trader gets slightly less than exact → pool keeps the remainder → K ≥ K0
    expect(K1).to.be.gte(K0);
  });

  // ── swapBForA ────────────────────────────────────────────────────────────────
  it("swapBForA(200): correct output, reserves update symmetrically", async function () {
    header("swapBForA(200)");

    const rA0   = await amm.reserveA();
    const rB0   = await amm.reserveB();
    const amtIn = 200n;
    const expOut = (rA0 * amtIn) / (rB0 + amtIn);

    const rcpt  = await writeCall(amm, deployer, "swapBForA", [amtIn], AMM_GAS);
    const rA1   = await amm.reserveA();
    const rB1   = await amm.reserveB();
    const gotOut = await amm.lastAmountOut();

    row("tx status",  rcpt.status === 1 ? "OK" : "FAILED");
    row("amtIn  (B)", amtIn.toString());
    row("amtOut (A)", gotOut.toString() + "  (expected " + expOut.toString() + ")");
    row("reserveA",   rA0.toString() + " → " + rA1.toString());
    row("reserveB",   rB0.toString() + " → " + rB1.toString());

    expect(rcpt.status).to.equal(1);
    expect(gotOut).to.equal(expOut);
    expect(rB1).to.equal(rB0 + amtIn);
    expect(rA1).to.equal(rA0 - expOut);
  });

  // ── price impact ─────────────────────────────────────────────────────────────
  it("price impact: large trade gets worse per-unit rate than small trade", async function () {
    header("price impact check (read-only)");

    const rA = await amm.reserveA();
    const rB = await amm.reserveB();

    const smallIn  = 10n;
    const smallOut = (rB * smallIn) / (rA + smallIn);
    // per-unit rate scaled by 1000 to preserve precision
    const smallRate = (smallOut * 1_000n) / smallIn;

    const largeIn  = 500n;
    const largeOut = (rB * largeIn) / (rA + largeIn);
    const largeRate = (largeOut * 1_000n) / largeIn;

    row("current rA",    rA.toString());
    row("current rB",    rB.toString());
    row("small 10→A B",  smallIn + "→" + smallOut + "  rate×1k=" + smallRate);
    row("large 500→A B", largeIn + "→" + largeOut + "  rate×1k=" + largeRate);
    row("large < small", (largeRate < smallRate).toString() + " ✓");

    expect(largeRate).to.be.lt(smallRate,
      "large trade should get worse per-unit rate (price impact)");
  });

  // ── add more liquidity + multi-swap invariant ────────────────────────────────
  it("K never decreases across multiple swaps", async function () {
    header("multi-swap K monotonicity check");

    // Add fresh liquidity so we have room to swap
    await writeCall(amm, deployer, "addLiquidity", [10000n, 20000n], AMM_GAS);
    const K0 = await amm.getK();

    // 5 alternating swaps
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 0) {
        await writeCall(amm, deployer, "swapAForB", [50n], AMM_GAS);
      } else {
        await writeCall(amm, deployer, "swapBForA", [80n], AMM_GAS);
      }
    }

    const K1 = await amm.getK();
    const rA = await amm.reserveA();
    const rB = await amm.reserveB();

    row("K initial",    K0.toString());
    row("K after 5 swaps", K1.toString());
    row("delta K",      (K1 - K0).toString());
    row("reserveA",     rA.toString());
    row("reserveB",     rB.toString());

    expect(K1).to.be.gte(K0, "K must never decrease (floor division is pool-favourable)");
  });
});
