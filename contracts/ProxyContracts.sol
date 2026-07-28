// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// ── Logic contracts ──────────────────────────────────────────────────────────

/// @notice V1 logic: stores value as-is.
contract LogicV1 {
    uint256 public value; // slot 0 — must match proxy layout

    function setValue(uint256 v) external { value = v; }
    function version()  external pure returns (string memory) { return "v1"; }
}

/// @notice V2 logic: setValue doubles the input (demonstrates upgrade effect).
contract LogicV2 {
    uint256 public value; // slot 0

    function setValue(uint256 v) external { value = v * 2; }
    function version()  external pure returns (string memory) { return "v2"; }
}

// ── Minimal EIP-1967 proxy ────────────────────────────────────────────────────
//
// Stores the implementation pointer in the EIP-1967 slot so it never collides
// with the business-logic storage that starts at slot 0.

contract SimpleProxy {
    // EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
    bytes32 private constant _IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address impl) {
        _setImpl(impl);
    }

    /// @notice Upgrade the implementation (no access control — demo only).
    function upgradeTo(address impl) external {
        _setImpl(impl);
    }

    function implementation() external view returns (address impl) {
        assembly { impl := sload(_IMPL_SLOT) }
    }

    fallback() external payable {
        assembly {
            let impl := sload(_IMPL_SLOT)
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}

    function _setImpl(address impl) private {
        assembly { sstore(_IMPL_SLOT, impl) }
    }
}
