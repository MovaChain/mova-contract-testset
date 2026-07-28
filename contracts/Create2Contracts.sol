// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal counter used as a CREATE2 deployment target.
contract Counter {
    uint256 public count;
    function increment() external { count++; }
}

/// @notice Factory that deploys contracts via CREATE2 and records results.
contract Create2Factory {
    address public lastDeployed;
    bool    public lastSuccess;

    /// @notice Deploy `bytecode` with `salt`; stores the resulting address.
    function deploy(bytes32 salt, bytes memory bytecode) external returns (address addr) {
        assembly {
            addr := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
        lastSuccess  = (addr != address(0));
        lastDeployed = addr;
    }

    /// @notice Predict the CREATE2 address without deploying.
    function computeAddress(bytes32 salt, bytes32 bytecodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            salt,
            bytecodeHash
        )))));
    }
}
