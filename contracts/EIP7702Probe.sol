// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

contract EIP7702Probe {
    uint256 public value;

    function answer() external pure returns (uint256) {
        return 42;
    }

    function contextAddress() external view returns (address) {
        return address(this);
    }

    function store(uint256 newValue) external {
        value = newValue;
    }

    function fail() external pure {
        revert("delegated call reverted");
    }
}

contract EIP7702ProbeV2 {
    function answer() external pure returns (uint256) {
        return 43;
    }
}
