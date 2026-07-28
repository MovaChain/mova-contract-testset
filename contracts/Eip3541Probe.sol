// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-3541 — reject deploying contracts whose runtime starts with
/// 0xEF. We deploy a minimal initcode that returns runtime [0xEF].
/// Pre-Prague: deployment succeeds. Post-Prague: deployment must revert.
contract Eip3541Probe {
    bytes public constant RUNTIME = hex"ef";

    address public lastDeployed;       // result of the last CREATE attempt
    bool public attempted;

    /// State-changing: tries to CREATE a contract with runtime [0xEF] and
    /// persists the resulting address. Post-Prague EIP-3541 forces address(0).
    function tryDeployEfStore() external {
        bytes memory init = hex"60ef60005360016000f3"; // PUSH1 0xef; PUSH1 0; MSTORE8; PUSH1 1; PUSH1 0; RETURN
        address out;
        assembly {
            out := create(0, add(init, 32), mload(init))
        }
        lastDeployed = out;
        attempted = true;
    }

    /// Tries to deploy [0xEF] runtime via CREATE; returns address(0) on EIP-3541
    /// rejection without bubbling the failure (gas is paid for the consumed work).
    function tryDeployEf() external returns (address out) {
        bytes memory init = hex"60ef60005360016000f3";
        assembly {
            out := create(0, add(init, 32), mload(init))
        }
    }
}
