// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Fixture for the EIP-7907 contract-code-size compatibility test.
/// @dev The paired test verifies that a target network accepts runtime code
/// above EIP-170's 24 KB limit.
contract LargeCodeFactory {
    address public lastDeployed;
    uint256 public lastSize;
    bool public attempted;

    function deployRuntimeStore(uint256 size) external {
        lastDeployed = _deploy(size);
        lastSize = size;
        attempted = true;
    }

    function codeSizeOf(address account) external view returns (uint256 size) {
        assembly {
            size := extcodesize(account)
        }
    }

    function _deploy(uint256 size) internal returns (address out) {
        // The 16-byte constructor returns `size` bytes of 0xfe as runtime.
        require(size <= 0xFFFFFF, "size too big for prelude");
        bytes memory init = new bytes(16 + size);
        init[0] = 0x62;
        init[1] = bytes1(uint8(size >> 16));
        init[2] = bytes1(uint8(size >> 8));
        init[3] = bytes1(uint8(size));
        init[4] = 0x60;
        init[5] = 0x10;
        init[6] = 0x60;
        init[7] = 0x00;
        init[8] = 0x39;
        init[9] = 0x62;
        init[10] = bytes1(uint8(size >> 16));
        init[11] = bytes1(uint8(size >> 8));
        init[12] = bytes1(uint8(size));
        init[13] = 0x60;
        init[14] = 0x00;
        init[15] = 0xf3;
        for (uint256 i = 0; i < size; i++) {
            init[16 + i] = 0xfe;
        }
        assembly {
            out := create(0, add(init, 32), mload(init))
        }
    }
}
