// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Minimal multicall: batches arbitrary self-calls via DELEGATECALL.
// All calls share storage with this contract; any failure is atomic.
contract MulticallProbe {
    uint256 public counter;
    string  public lastMessage;

    function increment() external {
        counter++;
    }

    function addN(uint256 n) external {
        counter += n;
    }

    function setMessage(string calldata msg_) external {
        lastMessage = msg_;
    }

    // Batch self-calls. All calls run in the same transaction; if any
    // inner call reverts the entire multicall reverts (atomic).
    function multicall(bytes[] calldata calls) external returns (bytes[] memory results) {
        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = address(this).delegatecall(calls[i]);
            require(ok, "MULTICALL_FAILED");
            results[i] = ret;
        }
    }

    // Sentinel used for atomic-failure tests.
    function alwaysRevert() external pure {
        revert("INTENTIONAL_REVERT");
    }
}
