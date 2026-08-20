// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title ISystemConfig
/// @notice Minimal interface for the on-chain fork-height registry.
/// The node reads UINT values via getConfigs; all other types are unused.
/// Keys in use:
///   MOVA_CHAIN_CONFIG_HARD_FORK_EVM_OSAKA       UINT
///   MOVA_CHAIN_CONFIG_HARD_FORK_FIX_RETURN_GAS  UINT
///   MOVA_CHAIN_CONFIG_HARD_FORK_OPT_SETLOG       UINT
///
/// Access is governed by OpenZeppelin AccessControl roles on the implementation:
///   ADMIN_ROLE          may create/update values (setUint/setUintBatch)
///   UPGRADE_ROLE        may upgrade the UUPS implementation
///   DEFAULT_ADMIN_ROLE  may grant/revoke the above roles
interface ISystemConfig {
    // ConfigType ordinal MUST NOT change; the node hard-codes UINT == 2.
    enum ConfigType { NONE, STRING, UINT }

    struct ConfigItem {
        bytes value;
        ConfigType valueType;
    }

    error ArrayLengthMismatch();

    event UintConfigUpdated(bytes32 indexed key, uint256 value);

    function setUint(string calldata key, uint256 value) external;
    function setUintBatch(string[] calldata keys, uint256[] calldata values) external;

    /// @notice Returns raw typed items for the given keys.
    /// Unset keys return valueType=NONE; set keys return valueType=UINT
    /// with a 32-byte ABI-encoded big-endian value.
    function getConfigs(string[] calldata keys) external view returns (ConfigItem[] memory);
}
