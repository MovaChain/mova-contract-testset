// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-7939 — CLZ (count leading zeros, opcode 0x1e) — Osaka.
/// The suite compiles with `evmVersion: osaka`, which exposes the `clz` Yul
/// builtin. `compute(x)` persists the result so the test covers a real write
/// transaction rather than only an `eth_call`.
contract ClzProbe {
    uint256 public lastInput;
    uint256 public lastResult;
    bool public computed;

    /// State-changing: runs CLZ(x) through the deployed runtime and persists
    /// the result so the test can read it back via `lastResult`.
    function compute(uint256 x) external {
        lastInput = x;
        lastResult = _clz(x);
        computed = true;
    }

    /// Read-only mirror.
    function clz(uint256 x) external pure returns (uint256) {
        return _clz(x);
    }

    function _clz(uint256 x) internal pure returns (uint256 result) {
        assembly ("memory-safe") {
            result := clz(x)
        }
    }
}
