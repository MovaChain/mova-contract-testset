/**
 * Global test setup — loaded first (alphabetically before all 01-xx files).
 *
 * 1. Warms up the undici HTTP connection to the RPC node so that no individual
 *    test file suffers a SocketError on a cold connection.
 *
 * 2. Starts a background heartbeat (getBlockNumber every 8 s) that keeps the
 *    HTTP keep-alive connection alive for the full ~25-minute test run.
 *    Without this, the server-side idle timeout can silently close the TCP
 *    socket between test files, causing random SocketErrors on the next call.
 */
const { ethers } = require("hardhat");

before(async function () {
  this.timeout(30_000);
  await ethers.provider.getBlockNumber();

  // Keep-alive heartbeat — fires every 8 s for the duration of the suite.
  const timer = setInterval(async () => {
    try { await ethers.provider.getBlockNumber(); } catch (_) { /* ignore */ }
  }, 8_000);

  // Tear down when the entire suite finishes.
  after(() => clearInterval(timer));
});
