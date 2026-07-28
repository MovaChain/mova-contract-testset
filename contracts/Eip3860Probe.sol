// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-3860 — limit & meter initcode size.
/// MaxInitCodeSize = 49152 (= 2 * MaxCodeSize). Anything larger must revert
/// at deploy time with "max initcode size exceeded".
contract Eip3860Probe {
    address public lastDeployed; // result of the last in-limit CREATE attempt
    bool public attempted;

    /// State-changing: CREATEs a contract whose init code is `len` bytes long
    /// (filled with INVALID 0xfe) and persists the resulting address.
    /// For over-limit `len` the EVM raises ErrMaxInitCodeSizeExceeded inside
    /// create(), but opCreate catches it and silently pushes address(0) onto
    /// the stack — the calling tx does NOT revert. `attempted` is always set
    /// to true; `lastDeployed` is address(0) when the CREATE failed.
    function tryDeployStore(uint256 len) external {
        bytes memory init = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            init[i] = 0xfe;
        }
        address out;
        assembly {
            out := create(0, add(init, 32), len)
        }
        lastDeployed = out;
        attempted = true;
    }

    /// Tries to CREATE a contract whose init code is `len` bytes long
    /// (filled with INVALID 0xfe so it never actually runs). Returns the
    /// resulting address (zero on failure).
    function tryDeploy(uint256 len) external returns (address out) {
        bytes memory init = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            init[i] = 0xfe;
        }
        assembly {
            out := create(0, add(init, 32), len)
        }
    }
}
