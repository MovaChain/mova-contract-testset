// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// ── Custom error definitions (module-level) ──────────────────────────────────

/// @notice Thrown when a withdrawal exceeds the caller's balance.
error InsufficientBalance(uint256 available, uint256 required);

/// @notice Thrown when the caller is not the owner.
error Unauthorized(address caller, address owner);

// ── Probe contract ───────────────────────────────────────────────────────────

contract CustomErrorProbe {
    address public owner;
    mapping(address => uint256) public balances;

    // Last observed gas costs (set by benchmarkGas).
    uint256 public gasCustomError;
    uint256 public gasRequireString;

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // ── custom error path ────────────────────────────────────────────────────

    /// @notice Reverts with InsufficientBalance (custom error).
    function withdrawCustom(uint256 amount) external {
        uint256 available = balances[msg.sender]; // single SLOAD
        if (available < amount) {
            revert InsufficientBalance(available, amount);
        }
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    /// @notice Only owner — reverts with Unauthorized (custom error).
    function adminActionCustom() external {
        if (msg.sender != owner) {
            revert Unauthorized(msg.sender, owner);
        }
        // (no-op action — just to test the access guard)
    }

    // ── require-string path (for gas comparison) ─────────────────────────────

    /// @notice Identical logic but uses require + string.
    function withdrawRequire(uint256 amount) external {
        uint256 available = balances[msg.sender]; // single SLOAD
        require(available >= amount, "InsufficientBalance: amount exceeds balance");
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    function adminActionRequire() external {
        require(msg.sender == owner, "Unauthorized: caller is not the owner");
    }

    // ── gas benchmark ────────────────────────────────────────────────────────

    /// @notice Measure and store gas used by each revert path.
    ///         Both calls are expected to revert internally; gas is measured
    ///         via gasleft() around a low-level call so the benchmark itself
    ///         never reverts.
    function benchmarkGas(uint256 overdrawAmount) external {
        // custom error path
        uint256 g1 = gasleft();
        (bool ok1,) = address(this).call(
            abi.encodeWithSignature("withdrawCustom(uint256)", overdrawAmount)
        );
        gasCustomError = g1 - gasleft();
        require(!ok1, "expected revert");

        // require-string path
        uint256 g2 = gasleft();
        (bool ok2,) = address(this).call(
            abi.encodeWithSignature("withdrawRequire(uint256)", overdrawAmount)
        );
        gasRequireString = g2 - gasleft();
        require(!ok2, "expected revert");
    }
}
