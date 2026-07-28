// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Helpers for the "failed-tx gas refund" test.
/// Pre-upgrade behaviour: a reverting tx burned the full gasLimit.
/// Post-upgrade behaviour: only the gas actually consumed is charged; the
/// remaining gas is refunded to the sender.
contract RevertProbe {
    uint256 public lastStored;

    /// Always reverts; consumes only a few thousand gas before the revert.
    function alwaysRevert() external pure {
        revert("nope");
    }

    /// Burns gas in a tight loop until it OOGs. Used to exercise the
    /// out-of-gas branch (which is *not* refunded — all gas is consumed).
    function burnAllGas() external pure {
        uint256 i;
        while (true) {
            unchecked { i++; }
        }
    }

    /// Normal successful write — stores n in state and returns n+1.
    /// Used by the "success-tx gas accounting" test: verifies that even on
    /// success, only gasUsed (not gasLimit) is debited.
    function storeValue(uint256 n) external returns (uint256) {
        lastStored = n;
        return n + 1;
    }
}
