// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-6780 — SELFDESTRUCT semantics change.
/// Pre-Prague:  SELFDESTRUCT always deletes the contract account.
/// Post-Prague: SELFDESTRUCT only deletes when the contract was *created in
///              the same transaction*; otherwise it just transfers the
///              balance to the recipient and the account is preserved.
contract SelfDestructProbe {
    function kill(address payable to) external {
        selfdestruct(to);
    }

    /// Anchor that only exists for the test to query code size.
    function ping() external pure returns (uint256) {
        return 42;
    }

    /// Read-only helper so the test can query code size *through a contract*
    /// rather than relying solely on eth_getCode.
    function codeSizeOf(address a) external view returns (uint256 size) {
        assembly {
            size := extcodesize(a)
        }
    }

    receive() external payable {}
}

/// Helper so we can deploy + selfdestruct in the *same* tx, which is the
/// only path that still fully deletes the account under EIP-6780.
contract SameTxKiller {
    address public lastVictim; // persisted address of the same-tx victim

    /// State-changing: deploys a probe and selfdestructs it in the same tx,
    /// persisting the victim address so the test can read it back and then
    /// confirm the code was deleted.
    function deployAndKillStore(address payable to) external {
        SelfDestructProbe v = new SelfDestructProbe();
        lastVictim = address(v);
        v.kill(to);
    }

    function deployAndKill(address payable to) external returns (address victim) {
        SelfDestructProbe v = new SelfDestructProbe();
        victim = address(v);
        v.kill(to);
    }

    /// Read code size through the contract for verification.
    function codeSizeOf(address a) external view returns (uint256 size) {
        assembly {
            size := extcodesize(a)
        }
    }
}
