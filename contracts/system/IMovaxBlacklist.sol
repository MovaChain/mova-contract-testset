// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IMovaxBlacklist is IERC165 {
    function inBlackList(address[] memory addrList) external view returns(bool[] memory isBlack);
    function getBlackList(uint256 offset, uint256 len) external view returns(uint256 lenBlack, address[] memory Blacklist);
    function setBlackList(address[] memory addrList, bool isBlack) external returns(bool);
}
