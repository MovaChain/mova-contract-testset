// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice AccessControl ABI exposed by the SystemConfig UUPS implementation.
interface ISystemConfigAccessControl {
    function hasRole(bytes32 role, address account) external view returns (bool);
}
