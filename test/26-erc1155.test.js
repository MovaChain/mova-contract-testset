const { expect } = require("chai");
const { ethers } = require("hardhat");
const { row, header, writeCall, deployWithRetry } = require("./_helpers");

const TX_GAS = 500_000n;

describe("OZ 5.6 ERC-1155 TestMultiToken — mint, batch, operator transfer", function () {
  let token, deployer, holder, recipient, operator;

  before(async () => {
    const signers = await ethers.getSigners();
    [deployer, holder, recipient, operator] = signers;

    // A remote Hardhat network is normally configured with just the deployer
    // key. Reuse it as holder and fund one ephemeral operator so the same
    // approval/third-party transfer path remains executable outside localhost.
    if (!operator) {
      holder = deployer;
      recipient = ethers.Wallet.createRandom();
      operator = ethers.Wallet.createRandom().connect(ethers.provider);
      await (await deployer.sendTransaction({
        to: operator.address,
        value: ethers.parseEther("0.01"),
      })).wait();
      row("single-key network", "funded ephemeral operator");
    }

    const F = await ethers.getContractFactory("TestMultiToken");
    token = await deployWithRetry(F);
    row("TestMultiToken deployed at", await token.getAddress());
  });

  it("owner mint() creates a fungible token ID and exposes the OZ URI template", async function () {
    header("mint(holder, id=1, amount=100)");
    const rcpt = await writeCall(token, deployer, "mint", [holder.address, 1n, 100n, "0x"], TX_GAS);

    const balance = await token.balanceOf(holder.address, 1n);
    const uri = await token.uri(1n);
    row("tx status", rcpt.status === 1 ? "OK" : "FAILED");
    row("holder balance (id=1)", balance.toString());
    row("uri(1)", uri);

    expect(rcpt.status).to.equal(1);
    expect(balance).to.equal(100n);
    expect(uri).to.equal("ipfs://mova-test/{id}.json");
  });

  it("owner mintBatch() creates two IDs; balanceOfBatch returns their balances", async function () {
    header("mintBatch(holder, ids=[2,3], amounts=[20,30])");
    const rcpt = await writeCall(
      token,
      deployer,
      "mintBatch",
      [holder.address, [2n, 3n], [20n, 30n], "0x"],
      TX_GAS
    );
    const balances = await token.balanceOfBatch([holder.address, holder.address], [2n, 3n]);

    row("tx status", rcpt.status === 1 ? "OK" : "FAILED");
    row("balances (id=2,id=3)", balances.map(String).join(", "));

    expect(rcpt.status).to.equal(1);
    expect(balances).to.deep.equal([20n, 30n]);
  });

  it("approved operator safeBatchTransferFrom() moves both IDs", async function () {
    header("setApprovalForAll → operator safeBatchTransferFrom");
    const approval = await writeCall(
      token,
      holder,
      "setApprovalForAll",
      [operator.address, true],
      TX_GAS
    );
    const transfer = await writeCall(
      token,
      operator,
      "safeBatchTransferFrom",
      [holder.address, recipient.address, [2n, 3n], [5n, 7n], "0x"],
      TX_GAS
    );
    const holderBalances = await token.balanceOfBatch([holder.address, holder.address], [2n, 3n]);
    const recipientBalances = await token.balanceOfBatch([recipient.address, recipient.address], [2n, 3n]);

    row("approval status", approval.status === 1 ? "OK" : "FAILED");
    row("transfer status", transfer.status === 1 ? "OK" : "FAILED");
    row("holder balances", holderBalances.map(String).join(", "));
    row("recipient balances", recipientBalances.map(String).join(", "));

    expect(approval.status).to.equal(1);
    expect(transfer.status).to.equal(1);
    expect(holderBalances).to.deep.equal([15n, 23n]);
    expect(recipientBalances).to.deep.equal([5n, 7n]);
  });
});
