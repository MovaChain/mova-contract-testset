// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Minimal single-shot timelock: execute() is gated by block.timestamp.
contract TimelockProbe {
    address public immutable owner;
    uint256 public immutable unlockTime;
    uint256 public value;
    bool    public executed;

    event Executed(address indexed by, uint256 val, uint256 at);

    constructor(uint256 delaySeconds) {
        owner      = msg.sender;
        unlockTime = block.timestamp + delaySeconds;
    }

    function execute(uint256 v) external {
        require(msg.sender == owner,           "NOT_OWNER");
        require(block.timestamp >= unlockTime, "LOCKED");
        require(!executed,                     "ALREADY_EXECUTED");
        value    = v;
        executed = true;
        emit Executed(msg.sender, v, block.timestamp);
    }

    function timeRemaining() external view returns (uint256) {
        if (block.timestamp >= unlockTime) return 0;
        return unlockTime - block.timestamp;
    }
}
