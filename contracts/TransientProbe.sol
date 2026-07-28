// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-1153 — Transient storage (TLOAD / TSTORE)
/// Values written with TSTORE persist only within the transaction and revert
/// across reverts; they are wiped at tx end.
contract TransientProbe {
    /// Persisted mirrors of what TLOAD observed, so a follow-up read tx can
    /// verify the result without relying on staticCall.
    uint256 public storedRoundTrip; // value TLOAD returned inside roundTrip
    uint256 public storedSlot1;     // value TLOAD(1) returned in a fresh tx
    uint256 public storedSlot2;     // value TLOAD(2) returned in a fresh tx

    /// Stores `v` in transient slot 1, loads it back, and persists the loaded
    /// value into normal storage so the test can read it back in a later call.
    function roundTrip(uint256 v) external returns (uint256 out) {
        assembly {
            tstore(1, v)
            out := tload(1)
        }
        storedRoundTrip = out;
    }

    /// Captures transient slot 1 into persistent storage in a *separate*
    /// transaction. Must persist 0 because transient storage is wiped at tx end.
    function captureSlot1() external {
        uint256 out;
        assembly {
            out := tload(1)
        }
        storedSlot1 = out;
    }

    /// Reads transient slot 1 in a *separate* transaction. Always returns 0
    /// because transient storage is wiped at tx end.
    function readSlot1() external view returns (uint256 out) {
        assembly {
            out := tload(1)
        }
    }

    /// Writes transient slot 2 then reverts: the rollback must also undo
    /// the transient write. A follow-up capture of slot 2 must persist 0.
    function writeAndRevert(uint256 v) external {
        assembly {
            tstore(2, v)
        }
        revert("intentional");
    }

    /// Captures transient slot 2 into persistent storage in a fresh tx.
    function captureSlot2() external {
        uint256 out;
        assembly {
            out := tload(2)
        }
        storedSlot2 = out;
    }

    function readSlot2() external view returns (uint256 out) {
        assembly {
            out := tload(2)
        }
    }
}
