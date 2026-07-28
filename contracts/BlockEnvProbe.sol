// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-3198 BASEFEE + EIP-4399 PREVRANDAO (DIFFICULTY repurposed)
/// Pre-upgrade EVMs leave BASEFEE as zero on Cosmos chains and DIFFICULTY at
/// whatever the consensus layer set (typically 0). Post-upgrade BASEFEE
/// reflects the protocol fee and PREVRANDAO is fed from Tendermint
/// `LastCommitHash`, so it must be non-zero and change every block.
///
/// IMPORTANT: these values must be captured during *real block execution*.
/// A read-only `eth_call` can surface different (often zero) values than an
/// actually-mined transaction, because the consensus/sync nodes only inject
/// the block context on the execution path. We therefore CAPTURE the values
/// inside a state-changing tx (`capture`) and READ them back from storage.
contract BlockEnvProbe {
    // ── captured block fields ─────────────────────────────────────────────
    uint256 public lastNumber;      // block.number
    uint256 public lastTimestamp;   // block.timestamp
    uint256 public lastBaseFee;     // block.basefee     (EIP-3198)
    uint256 public lastPrevrandao;  // block.prevrandao  (EIP-4399)
    uint256 public lastGasLimit;    // block.gaslimit
    uint256 public lastChainId;     // block.chainid
    address public lastCoinbase;    // block.coinbase (Tendermint proposer)
    bytes32 public lastBlockHash;   // blockhash(block.number - 1)

    /// @dev kept for backward-compat with existing tests
    uint256 public lastBlock;       // alias → same as lastNumber
    bool    public captured;

    event Captured(
        uint256 number,
        uint256 timestamp,
        uint256 baseFee,
        uint256 prevrandao,
        uint256 gasLimit,
        uint256 chainId,
        address coinbase,
        bytes32 prevHash
    );

    /// State-changing: records all live block-context fields of the block
    /// this tx is mined in. Read them back with the public getters below.
    function capture() external {
        uint256 r;
        assembly { r := prevrandao() }

        lastNumber      = block.number;
        lastTimestamp   = block.timestamp;
        lastBaseFee     = block.basefee;
        lastPrevrandao  = r;
        lastGasLimit    = block.gaslimit;
        lastChainId     = block.chainid;
        lastCoinbase    = block.coinbase;
        // blockhash is only available for the 256 most recent blocks;
        // block.number - 1 is always in range (except at block 0).
        lastBlockHash   = block.number > 0 ? blockhash(block.number - 1) : bytes32(0);

        lastBlock  = block.number; // backward-compat alias
        captured   = true;

        emit Captured(
            block.number, block.timestamp, block.basefee, r,
            block.gaslimit, block.chainid, block.coinbase,
            lastBlockHash
        );
    }

    // ── read-only mirrors kept for parity / ad-hoc inspection ────────────

    function baseFee() external view returns (uint256) {
        return block.basefee;
    }

    function prevrandao() external view returns (uint256 v) {
        assembly { v := prevrandao() }
    }

    function chainId() external view returns (uint256) {
        return block.chainid;
    }
}
