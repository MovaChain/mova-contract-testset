const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

// Deep-revert propagation test
//
// execute(maxDepth, revertAtDepth) runs an internal call chain of maxDepth
// levels (depth 0 … maxDepth).  At depth == revertAtDepth the chain triggers
// revert("chain: revert triggered").  If revertAtDepth > maxDepth the chain
// completes without reverting.
//
// The contract captures the outcome in storage via try/catch, so after the
// write tx we can read:
//   lastSuccess      — true if no revert
//   lastMaxDepth     — echoes the maxDepth argument
//   lastRevertDepth  — echoes the revertAtDepth argument
//   lastGasUsed      — gas consumed inside execute()
//
// For each case we assert:
//   1. The tx itself always succeeds (status=1) — execute() catches the chain.
//   2. lastSuccess matches the expectation.
//   3. Gas increases as the revert goes deeper (more code executed before bail).

const EXEC_GAS = 500_000n;

// Test matrix: { maxDepth, revertAtDepth, expectSuccess, label }
const CASES = [
  // ── 0-layer chain (single call, depth 0 only) ──────────────────────────
  { maxDepth: 0, revertAtDepth: 1, expectSuccess: true,  label: "depth=0  no revert"          },
  { maxDepth: 0, revertAtDepth: 0, expectSuccess: false, label: "depth=0  revert at depth 0"  },

  // ── 1-layer chain ────────────────────────────────────────────────────────
  { maxDepth: 1, revertAtDepth: 2, expectSuccess: true,  label: "depth=1  no revert"          },
  { maxDepth: 1, revertAtDepth: 0, expectSuccess: false, label: "depth=1  revert at depth 0"  },
  { maxDepth: 1, revertAtDepth: 1, expectSuccess: false, label: "depth=1  revert at depth 1"  },

  // ── 3-layer chain ────────────────────────────────────────────────────────
  { maxDepth: 3, revertAtDepth: 4, expectSuccess: true,  label: "depth=3  no revert"          },
  { maxDepth: 3, revertAtDepth: 0, expectSuccess: false, label: "depth=3  revert at depth 0"  },
  { maxDepth: 3, revertAtDepth: 2, expectSuccess: false, label: "depth=3  revert at depth 2"  },
  { maxDepth: 3, revertAtDepth: 3, expectSuccess: false, label: "depth=3  revert at depth 3"  },

  // ── 5-layer chain ────────────────────────────────────────────────────────
  { maxDepth: 5, revertAtDepth: 6, expectSuccess: true,  label: "depth=5  no revert"          },
  { maxDepth: 5, revertAtDepth: 0, expectSuccess: false, label: "depth=5  revert at depth 0"  },
  { maxDepth: 5, revertAtDepth: 5, expectSuccess: false, label: "depth=5  revert at depth 5"  },
];

describe("Deep revert — 0 to N call layers", function () {
  let probe;

  before(async () => {
    const F = await ethers.getContractFactory("DeepRevertProbe");
    probe = await deployWithRetry(F);
  });

  for (const c of CASES) {
    it(c.label, async function () {
      header(c.label);

      const [signer] = await ethers.getSigners();

      // Write tx
      const rcpt = await writeCall(probe, signer, "execute",
        [c.maxDepth, c.revertAtDepth], EXEC_GAS);

      // Read state
      const success     = await probe.lastSuccess();
      const maxDepth    = await probe.lastMaxDepth();
      const revertDepth = await probe.lastRevertDepth();
      const gasUsed     = await probe.lastGasUsed();

      row("tx status",       rcpt.status === 1 ? "OK" : "FAILED");
      row("tx gasUsed",      rcpt.gasUsed.toString());
      row("lastSuccess",     success.toString());
      row("lastMaxDepth",    maxDepth.toString());
      row("lastRevertDepth", revertDepth.toString());
      row("lastGasUsed",     gasUsed.toString());

      // The outer tx always succeeds — execute() traps the inner revert.
      expect(rcpt.status, "execute() tx must always succeed").to.equal(1);

      // The stored result matches the expectation.
      expect(success, `lastSuccess should be ${c.expectSuccess}`).to.equal(c.expectSuccess);

      // Echo fields must match arguments.
      expect(maxDepth).to.equal(BigInt(c.maxDepth));
      expect(revertDepth).to.equal(BigInt(c.revertAtDepth));
    });
  }

  // ── Gas-vs-depth: deeper revert = more gas consumed ─────────────────────
  it("gas increases as revert depth grows (depth=5 chain)", async function () {
    header("gas vs revert depth (maxDepth=5)");

    const [signer] = await ethers.getSigners();
    const depths = [0, 1, 2, 3, 4, 5];
    const gasReadings = [];

    for (const d of depths) {
      await writeCall(probe, signer, "execute", [5, d], EXEC_GAS);
      const g = await probe.lastGasUsed();
      gasReadings.push(g);
      row(`  revert at depth ${d}  gasUsed`, g.toString());
    }

    // Each deeper revert should consume at least as much gas as the shallower one.
    for (let i = 1; i < gasReadings.length; i++) {
      expect(gasReadings[i], `depth ${i} gas >= depth ${i - 1} gas`)
        .to.be.gte(gasReadings[i - 1]);
    }
  });
});
