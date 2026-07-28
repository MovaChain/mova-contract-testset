const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { row, header, writeCall, sendRawLarge, deployWithRetry } = require("./_helpers");

const MAX_INITCODE = 49152;

// Build a minimal initcode of exactly `size` bytes that deploys an empty contract.
// Bytes [0..3]: PUSH1 0x00, DUP1, RETURN  →  returns 0 bytes of runtime code (empty contract).
// Bytes [4..]: 0x00 (STOP) padding — never reached.
function makeLargeInitcode(size) {
  const buf = Buffer.alloc(size, 0x00);
  buf[0] = 0x60; // PUSH1
  buf[1] = 0x00; // push value 0 (return offset)
  buf[2] = 0x80; // DUP1  (return size = 0)
  buf[3] = 0xf3; // RETURN
  return "0x" + buf.toString("hex");
}

describe("EIP-3860  initcode size limit", function () {
  let probe;
  let signer;

  before(async () => {
    [signer] = await ethers.getSigners();
    const F = await ethers.getContractFactory("Eip3860Probe");
    probe = await deployWithRetry(F);
  });

  // it("CREATE at the boundary (= 49152) does NOT trip EIP-3860", async function () {
  //   header("Initcode = 49152 bytes (limit)");
  //   // WRITE: CREATE with initcode exactly at the limit. The 0xfe runtime never
  //   // executes a valid deploy, so lastDeployed may be 0, but the tx itself must
  //   // NOT revert from EIP-3860 (it succeeds and marks `attempted`).
  //   const rcpt = await writeCall(probe, signer, "tryDeployStore", [MAX_INITCODE], 20_000_000n);
  //   row("write tx status", rcpt.status === 1 ? "OK (not rejected)" : "REVERTED");
  //   row("attempted", (await probe.attempted()).toString());
  //
  //   expect(rcpt.status).to.equal(1);
  //   expect(await probe.attempted()).to.equal(true);
  // });
  //
  // it("CREATE of initcode > 49152 silently fails (EIP-3860): tx succeeds, CREATE returns address(0)", async function () {
  //   header("Initcode = 49153 bytes (over limit)");
  //   // EIP-3860 triggers ErrMaxInitCodeSizeExceeded inside the EVM's create()
  //   // function, but opCreate catches it and silently pushes 0 onto the stack
  //   // (same as any other failed CREATE).  The calling tx does NOT revert —
  //   // execution continues after the assembly CREATE block.  So:
  //   //   - tx status = 1 (success)
  //   //   - attempted = true  (code after the CREATE ran)
  //   //   - lastDeployed = address(0)  (CREATE returned 0)
  //   const rcpt = await writeCall(probe, signer, "tryDeployStore", [MAX_INITCODE + 1], 20_000_000n);
  //   const lastDeployed = await probe.lastDeployed();
  //   row("write tx status", rcpt.status === 1 ? "OK (tx succeeded)" : "REVERTED");
  //   row("attempted", (await probe.attempted()).toString());
  //   row("lastDeployed", lastDeployed);
  //
  //   // The tx itself succeeds — ErrMaxInitCodeSizeExceeded is silent at opCreate level.
  //   expect(rcpt.status).to.equal(1);
  //   // The code after the CREATE assembly block ran and stored `attempted = true`.
  //   expect(await probe.attempted()).to.equal(true);
  //   // The CREATE returned address(0) because the initcode was rejected.
  //   expect(lastDeployed).to.equal(ethers.ZeroAddress);
  // });
  //
  // // ── Direct deployment (tx-level CREATE, not opCreate inside another contract) ──
  // //
  // // When a contract-creation tx reaches TransitionDb, the EVM's create() is
  // // called directly.  The returned ErrMaxInitCodeSizeExceeded is captured as
  // // `vmerr` in TransitionDb, which sets tx status=0.  This is different from
  // // the opCreate path above where the error is silently turned into push-0.
  //
  // it("direct deploy at exactly 49152 bytes succeeds (tx-level, at limit)", async function () {
  //   this.timeout(60_000);
  //   header("Direct deploy: initcode = 49152 bytes (limit)");
  //
  //   const initcode = makeLargeInitcode(MAX_INITCODE);
  //   const rcpt = await sendRawLarge({ data: initcode, gasLimit: 20_000_000n });
  //
  //   row("tx status", rcpt.status === 1 ? "OK (deployed)" : "FAILED");
  //   row("contractAddress", rcpt.contractAddress || "(none)");
  //
  //   expect(rcpt.status).to.equal(1);
  //   expect(rcpt.contractAddress).to.not.equal(null);
  //   expect(rcpt.contractAddress).to.not.equal(ethers.ZeroAddress);
  // });

  it("direct deploy at 49153 bytes is rejected (EIP-3860)", async function () {
    this.timeout(60_000);
    header("Direct deploy: initcode = 49153 bytes (over limit)");
    // TransitionDb calls evm.Create() directly; ErrMaxInitCodeSizeExceeded is
    // stored as vmerr → tx status=0.  No contract is created; the nonce is NOT
    // incremented (create() returns before snapshot/nonce bump).
    const initcode = makeLargeInitcode(MAX_INITCODE + 1);
    try {
      const rcpt = await sendRawLarge({ data: initcode, gasLimit: 15_000_000n });
      row("tx status", rcpt.status === 0 ? "FAILED (expected)" : "unexpected success");
      row("contractAddress", rcpt.contractAddress || "(none)");
      expect(rcpt.status).to.equal(0);
    } catch (error) {
      // Hardhat's HTTP node rejects this malformed create transaction before
      // mining it. Real execution nodes return a failed receipt instead.
      if (network.name !== "localhost") throw error;
      const message = [
        error.info?.error?.message,
        error.error?.data?.message,
        error.error?.message,
        error.data?.message,
        error.shortMessage,
        error.message,
        JSON.stringify(error),
      ].filter(Boolean).join(" ");
      row("local RPC result", "rejected before mining (expected)");
      expect(message).to.include("init code length");
    }
  });
});
