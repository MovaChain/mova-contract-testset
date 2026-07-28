const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, sendRaw, deployWithRetry } = require("./_helpers");

// Reentrancy guard test
//
// Two target contracts implement the same ITTest interface:
//   VulnerableTarget  — no protection; re-entrant calls succeed.
//   ProtectedTarget   — OpenZeppelin ReentrancyGuard; re-entrant call reverts.
//
// The Attacker's fallback() immediately calls ttest.test() again whenever it
// receives ETH.  We fund each target with a small ETH amount, then call
// Attacker.attack() and inspect callCount on the target to determine whether
// reentrancy was allowed or blocked.
//
// Pattern: write tx (attack) → read callCount → assert.

const ATTACK_GAS  = 500_000n;
const FUND_GAS    = 60_000n;
const FUND_VALUE  = ethers.parseEther("0.001");   // enough for many re-entries

describe("Reentrancy — ReentrancyGuard blocks re-entrant calls", function () {
  let deployer;
  let vulnerable, protected_, attackerV, attackerP;

  before(async () => {
    [deployer] = await ethers.getSigners();

    // ── Deploy VulnerableTarget ──────────────────────────────────────────────
    const VF = await ethers.getContractFactory("VulnerableTarget");
    vulnerable = await deployWithRetry(VF);

    // ── Deploy ProtectedTarget ───────────────────────────────────────────────
    const PF = await ethers.getContractFactory("ProtectedTarget");
    protected_ = await deployWithRetry(PF);

    // ── Deploy two Attacker instances ────────────────────────────────────────
    const AF = await ethers.getContractFactory("Attacker");
    attackerV = await deployWithRetry(AF, [await vulnerable.getAddress()]);
    await attackerV.waitForDeployment();

    attackerP = await deployWithRetry(AF, [await protected_.getAddress()]);
    await attackerP.waitForDeployment();
  });

  // ── Vulnerable target ───────────────────────────────────────────────────────
  it("VulnerableTarget: reentrancy succeeds — callCount > 1 after attack", async function () {
    header("attack on VulnerableTarget (no guard)");

    const vAddr = await vulnerable.getAddress();
    const aAddr = await attackerV.getAddress();

    // Fund VulnerableTarget so it can send ETH back to the Attacker's fallback.
    const fundRcpt = await sendRaw(deployer, {
      to: vAddr,
      value: FUND_VALUE,
      gasLimit: FUND_GAS,
    });
    row("fund tx status",         fundRcpt.status === 1 ? "OK" : "FAILED");
    row("target ETH balance",     ethers.formatEther(await ethers.provider.getBalance(vAddr)));

    const callCountBefore = await vulnerable.callCount();
    row("callCount (before)",     callCountBefore.toString());

    // Write tx: launch the attack.
    const attackRcpt = await sendRaw(deployer, {
      to: aAddr,
      data: attackerV.interface.encodeFunctionData("attack"),
      gasLimit: ATTACK_GAS,
    });
    row("attack tx status",       attackRcpt.status === 1 ? "OK" : "REVERTED");
    row("attack tx gasUsed",      attackRcpt.gasUsed.toString());

    // Read: callCount should be > 1 because the fallback re-entered test().
    const callCountAfter = await vulnerable.callCount();
    const attackerCount  = await attackerV.count();
    row("callCount (after)",      callCountAfter.toString());
    row("attacker.count",         attackerCount.toString() + " re-entries from fallback");
    row("total test() calls",     callCountAfter.toString() + " (1 direct + " + attackerCount.toString() + " re-entrant)");

    expect(attackRcpt.status).to.equal(1);
    expect(callCountAfter).to.be.greaterThan(callCountBefore + 1n,
      "reentrancy should have called test() more than once");
  });

  // ── Protected target ────────────────────────────────────────────────────────
  it("ProtectedTarget: reentrancy reverts — attack tx fails, callCount stays 0", async function () {
    header("attack on ProtectedTarget (ReentrancyGuard)");

    const pAddr = await protected_.getAddress();
    const aAddr = await attackerP.getAddress();

    // Fund ProtectedTarget.
    const fundRcpt = await sendRaw(deployer, {
      to: pAddr,
      value: FUND_VALUE,
      gasLimit: FUND_GAS,
    });
    row("fund tx status",         fundRcpt.status === 1 ? "OK" : "FAILED");
    row("target ETH balance",     ethers.formatEther(await ethers.provider.getBalance(pAddr)));

    const callCountBefore = await protected_.callCount();
    row("callCount (before)",     callCountBefore.toString());

    // Write tx: launch the attack (expected to revert because the re-entrant
    // call inside the fallback hits the ReentrancyGuard and reverts, which
    // propagates back through the call chain).
    const attackRcpt = await sendRaw(deployer, {
      to: aAddr,
      data: attackerP.interface.encodeFunctionData("attack"),
      gasLimit: ATTACK_GAS,
    });
    row("attack tx status",       attackRcpt.status === 0 ? "REVERTED ✓ (guard blocked)" : "succeeded (unexpected)");
    row("attack tx gasUsed",      attackRcpt.gasUsed.toString());

    // Read: callCount should remain 0 because the whole tx was rolled back.
    const callCountAfter = await protected_.callCount();
    row("callCount (after)",      callCountAfter.toString());

    expect(attackRcpt.status).to.equal(0,
      "attack on protected target must revert");
    expect(callCountAfter).to.equal(callCountBefore,
      "callCount must not change when attack is blocked");
  });
});
