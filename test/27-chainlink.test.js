const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

const TX_GAS = 300_000n;
const FEED_DECIMALS = 8n;

describe("Chainlink AggregatorV3 — price feed ABI and defensive consumer", function () {
  let feed, consumer, deployer;

  before(async () => {
    [deployer] = await ethers.getSigners();
    const Feed = await ethers.getContractFactory("MockV3Aggregator");
    feed = await deployWithRetry(Feed, [FEED_DECIMALS, 2_500_00000000n]);

    const Consumer = await ethers.getContractFactory("ChainlinkPriceConsumer");
    consumer = await deployWithRetry(Consumer, [await feed.getAddress()]);
    row("MockV3Aggregator deployed at", await feed.getAddress());
    row("ChainlinkPriceConsumer at", await consumer.getAddress());
  });

  it("latestRoundData() is normalized to a 1e18 WAD price through the consumer", async function () {
    header("8-decimal feed price 2500.00000000 → 2500e18 WAD");
    const rcpt = await writeCall(consumer, deployer, "readAndStore", [], TX_GAS);
    const [roundId, answer,, updatedAt, answeredInRound] = await feed.latestRoundData();
    const priceWad = await consumer.lastPriceWad();

    row("tx status", rcpt.status === 1 ? "OK" : "FAILED");
    row("roundId / answeredInRound", `${roundId} / ${answeredInRound}`);
    row("updatedAt", updatedAt.toString());
    row("raw answer (8 decimals)", answer.toString());
    row("stored price (WAD)", priceWad.toString());

    expect(rcpt.status).to.equal(1);
    expect(updatedAt).to.be.gt(0n);
    expect(answeredInRound).to.equal(roundId);
    expect(priceWad).to.equal(2_500n * 10n ** 18n);
  });

  it("a new Chainlink round updates the persisted price and round ID", async function () {
    header("updateAnswer(2525.50000000) → readAndStore()");
    const update = await writeCall(feed, deployer, "updateAnswer", [2_525_50000000n], TX_GAS);
    const read = await writeCall(consumer, deployer, "readAndStore", [], TX_GAS);
    const roundId = await consumer.lastRoundId();
    const priceWad = await consumer.lastPriceWad();

    row("feed update status", update.status === 1 ? "OK" : "FAILED");
    row("consumer read status", read.status === 1 ? "OK" : "FAILED");
    row("stored round", roundId.toString());
    row("stored price (WAD)", priceWad.toString());

    expect(update.status).to.equal(1);
    expect(read.status).to.equal(1);
    expect(roundId).to.equal(2n);
    expect(priceWad).to.equal(2_5255n * 10n ** 17n);
  });

  it("consumer rejects a non-positive answer and preserves the last good price", async function () {
    header("updateAnswer(-1) → consumer reverts");
    await writeCall(feed, deployer, "updateAnswer", [-1n], TX_GAS);
    const before = await consumer.lastPriceWad();
    const rcpt = await writeCall(consumer, deployer, "readAndStore", [], TX_GAS);
    const after = await consumer.lastPriceWad();

    row("consumer tx status", rcpt.status === 0 ? "REVERTED ✓" : "UNEXPECTED SUCCESS");
    row("last good price", after.toString());

    expect(rcpt.status).to.equal(0);
    expect(after).to.equal(before);
  });
});
