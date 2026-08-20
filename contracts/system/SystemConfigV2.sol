// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SystemConfig} from "./SystemConfig.sol";

/// @notice Compatibility implementation used only to verify UUPS upgrades.
contract SystemConfigV2 is SystemConfig {
    function version() external pure returns (uint256) {
        return 2;
    }
}
