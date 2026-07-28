// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-5656 — MCOPY opcode (memory copy).
/// solc emits MCOPY when evmVersion >= cancun. We expose a tight assembly
/// version too so the test cannot accidentally fall through to a Yul library.
contract McopyProbe {
    bytes public stored;       // last MCOPY output, persisted
    bytes32 public storedHash; // keccak of last output, for cheap comparison

    function copy(bytes calldata src) external pure returns (bytes memory out) {
        // Bring src into memory first so MCOPY operates memory→memory (calldata
        // pointers are NOT valid sources for MCOPY).
        bytes memory mem = src;
        out = new bytes(mem.length);
        assembly {
            mcopy(add(out, 32), add(mem, 32), mload(mem))
        }
    }

    /// State-changing: MCOPYs `src` and persists the copied bytes so the test
    /// can read them back and confirm the copy was byte-exact.
    function copyAndStore(bytes calldata src) external {
        bytes memory mem = src;
        bytes memory out = new bytes(mem.length);
        assembly {
            mcopy(add(out, 32), add(mem, 32), mload(mem))
        }
        stored = out;
        storedHash = keccak256(out);
    }
}
