// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {ISystemConfig} from "./ISystemConfig.sol";

/// @title SystemConfig
/// @notice Upgradeable (UUPS) on-chain registry of fork activation heights
/// (UINT only). Stores each value as a raw uint256; getConfigs ABI-encodes on
/// read so the output matches what the MovaChain node expects.
///
/// Access control mirrors MovaxBlacklist:
///   ADMIN_ROLE    -> setUint / setUintBatch
///   UPGRADE_ROLE  -> _authorizeUpgrade (UUPS upgrades)
///   DEFAULT_ADMIN_ROLE granted to the initializer for role administration.
contract SystemConfig is Initializable, AccessControlUpgradeable, UUPSUpgradeable, ISystemConfig {
    /// @notice Role permitted to create, update, and remove configuration values.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    /// @notice Role permitted to authorize UUPS implementation upgrades.
    bytes32 public constant UPGRADE_ROLE = keccak256("UPGRADE_ROLE");

    /// @custom:storage-location erc7201:systemconfig.movax.storage
    struct SystemConfigStorage {
        // raw uint256 per keccak key; 0 is valid (means "disabled")
        mapping(bytes32 => uint256) heights;
        // true iff the key has been explicitly set
        mapping(bytes32 => bool) configured;
    }

    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the proxy and grants its initial administration roles.
    function initialize() external initializer {
        address admin = msg.sender;
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(UPGRADE_ROLE, admin);
    }

    /// @dev Restricts implementation upgrades to holders of UPGRADE_ROLE.
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADE_ROLE) {}

    function setUint(string calldata key, uint256 value) public onlyRole(ADMIN_ROLE) {
        bytes32 k = keccak256(bytes(key));
        SystemConfigStorage storage $ = _getStorage();
        $.heights[k] = value;
        $.configured[k] = true;
        emit UintConfigUpdated(k, value);
    }

    function setUintBatch(string[] calldata keys, uint256[] calldata values) external onlyRole(ADMIN_ROLE) {
        if (keys.length != values.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < keys.length; i++) {
            setUint(keys[i], values[i]);
        }
    }

    function getConfigs(string[] calldata keys) external view returns (ConfigItem[] memory items) {
        items = new ConfigItem[](keys.length);
        SystemConfigStorage storage $ = _getStorage();
        for (uint256 i = 0; i < keys.length; i++) {
            bytes32 k = keccak256(bytes(keys[i]));
            if ($.configured[k]) {
                items[i] = ConfigItem({
                    value: abi.encode($.heights[k]),
                    valueType: ConfigType.UINT
                });
            }
            // else: zero-value ConfigItem has valueType=NONE, value="", which
            // the node treats as "use environment default".
        }
    }

    /// @dev Returns the ERC-7201 namespaced storage struct for this contract.
    function _getStorage() private pure returns (SystemConfigStorage storage $) {
        bytes32 storageLocation =
            keccak256(abi.encode(uint256(keccak256("systemconfig.movax.storage")) - 1)) & ~bytes32(uint256(0xff));
        assembly {
            $.slot := storageLocation
        }
    }
}
