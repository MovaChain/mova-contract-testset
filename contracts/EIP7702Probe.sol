// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

contract EIP7702Probe {
    uint256 public value;

    event Observed(
        address indexed executionAddress,
        address indexed sender,
        address indexed origin,
        uint256 msgValue,
        uint256 storedValue
    );

    function answer() external pure returns (uint256) {
        return 42;
    }

    function contextAddress() external view returns (address) {
        return address(this);
    }

    function store(uint256 newValue) external {
        value = newValue;
    }

    function observe(uint256 newValue)
        external
        payable
        returns (address executionAddress, address sender, address origin, uint256 msgValue, uint256 balance)
    {
        value = newValue;
        emit Observed(address(this), msg.sender, tx.origin, msg.value, newValue);
        return (address(this), msg.sender, tx.origin, msg.value, address(this).balance);
    }

    function storeThenRevert(uint256 newValue) external payable {
        value = newValue;
        emit Observed(address(this), msg.sender, tx.origin, msg.value, newValue);
        revert("write rolled back");
    }

    function fail() external pure {
        revert("delegated call reverted");
    }

    function failInvalid() external pure {
        assembly {
            invalid()
        }
    }

    function burnGas() external pure {
        for (;;) {}
    }

    function externalCodeInfo(address account) external view returns (uint256 size, bytes32 hash, bytes32 firstWord) {
        assembly {
            size := extcodesize(account)
            hash := extcodehash(account)
            let ptr := mload(0x40)
            extcodecopy(account, ptr, 0, 32)
            firstWord := mload(ptr)
        }
    }

    function executingCodeInfo() external view returns (uint256 size, bytes32 firstWord) {
        assembly {
            size := codesize()
            let ptr := mload(0x40)
            codecopy(ptr, 0, 32)
            firstWord := mload(ptr)
        }
    }
}

contract EIP7702ProbeV2 {
    function answer() external pure returns (uint256) {
        return 43;
    }
}

contract EIP7702CallHarness {
    uint256 public value;

    function setValue(uint256 newValue) external {
        value = newValue;
    }

    function callStore(address target, uint256 newValue) external returns (bool ok, bytes memory result) {
        return target.call(abi.encodeCall(EIP7702Probe.store, (newValue)));
    }

    function staticAnswer(address target) external view returns (bool ok, bytes memory result) {
        return target.staticcall(abi.encodeCall(EIP7702Probe.answer, ()));
    }

    function staticStore(address target, uint256 newValue) external view returns (bool ok, bytes memory result) {
        return target.staticcall(abi.encodeCall(EIP7702Probe.store, (newValue)));
    }

    function delegateStore(address target, uint256 newValue) external returns (bool ok, bytes memory result) {
        return target.delegatecall(abi.encodeCall(EIP7702Probe.store, (newValue)));
    }

    function callcodeStore(address target, uint256 newValue) external returns (bool ok, bytes memory result) {
        bytes memory input = abi.encodeCall(EIP7702Probe.store, (newValue));
        assembly {
            ok := callcode(gas(), target, 0, add(input, 0x20), mload(input), 0, 0)
        }
        return (ok, "");
    }

    function codeInfo(address account) external view returns (uint256 size, bytes32 hash, bytes32 firstWord) {
        assembly {
            size := extcodesize(account)
            hash := extcodehash(account)
            let ptr := mload(0x40)
            extcodecopy(account, ptr, 0, 32)
            firstWord := mload(ptr)
        }
    }
}
