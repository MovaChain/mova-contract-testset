// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title DeepRevertProbe
/// @notice Tests revert propagation through 0 … N call layers.
///
/// execute(maxDepth, revertAtDepth):
///   - Runs an internal call chain of `maxDepth` levels (0 = single call).
///   - At depth `revertAtDepth`, triggers a revert("chain: revert triggered").
///   - If revertAtDepth > maxDepth, the chain completes successfully.
///   - Uses try/catch at the outermost boundary so the probe's own state
///     fields are always written even when the chain reverts.
///
/// After the tx is mined, read:
///   lastSuccess      — whether the chain completed without revert
///   lastMaxDepth     — maxDepth argument used
///   lastRevertDepth  — revertAtDepth argument used
///   lastGasUsed      — gas consumed inside execute() (excluding intrinsic)
contract DeepRevertProbe {
    bool    public lastSuccess;
    uint256 public lastMaxDepth;
    uint256 public lastRevertDepth;
    uint256 public lastGasUsed;

    /// @notice Entry point. Writes result fields then delegates to the chain.
    /// @param maxDepth     Maximum recursion depth (0 = single-level call).
    /// @param revertAtDepth Depth at which to trigger revert; > maxDepth = no revert.
    function execute(uint256 maxDepth, uint256 revertAtDepth) external {
        lastMaxDepth    = maxDepth;
        lastRevertDepth = revertAtDepth;
        lastSuccess     = false;

        uint256 gasBefore = gasleft();

        // One external call so the sub-frame's revert is caught here, and
        // the state writes above are preserved regardless of the outcome.
        try this._entryChain(maxDepth, revertAtDepth) {
            lastSuccess = true;
        } catch {
            lastSuccess = false;
        }

        lastGasUsed = gasBefore - gasleft();
    }

    /// @dev External wrapper required for try/catch; delegates to internal chain.
    function _entryChain(uint256 maxDepth, uint256 revertAtDepth) external {
        require(msg.sender == address(this), "only self");
        _chain(0, maxDepth, revertAtDepth);
    }

    /// @dev Recursive internal chain.  No external-call overhead per level.
    function _chain(uint256 depth, uint256 maxDepth, uint256 revertAtDepth) internal {
        if (depth == revertAtDepth) {
            revert("chain: revert triggered");
        }
        if (depth < maxDepth) {
            _chain(depth + 1, maxDepth, revertAtDepth);
        }
    }
}
