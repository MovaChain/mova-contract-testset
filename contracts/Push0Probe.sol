// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-3855 — PUSH0 opcode
/// Solidity >=0.8.20 with evmVersion=shanghai/cancun emits PUSH0 for the
/// constant zero. Pre-Prague nodes reject the bytecode at deploy time;
/// post-upgrade nodes accept it and the read returns 0.
contract Push0Probe {
    uint256 public zero;
    uint256 public stored = 0xdead; // non-zero sentinel until writeZero() runs

    constructor() {
        zero = 0; // compiles down to PUSH0 SSTORE
    }

    /// State-changing: stores a PUSH0-produced zero into `stored`, overwriting
    /// the sentinel. The test sends this as a tx and then reads `stored`.
    function writeZero() external {
        uint256 z;
        assembly {
            z := 0 // PUSH0
        }
        stored = z;
    }

    function readZero() external view returns (uint256) {
        return zero;
    }
}
