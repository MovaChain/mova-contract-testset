// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.24;

/// @notice Minimal wrapper around the EIP-8051 ML-DSA precompiles.
contract EIP8051VerifierDemo {
    address public constant VERIFY_MLDSA = address(0x12);
    address public constant VERIFY_MLDSA_ETH = address(0x13);

    uint256 public constant SIGNATURE_SIZE = 2420;
    uint256 public constant EXPANDED_PUBLIC_KEY_SIZE = 20512;

    function verifyMldsa(bytes32 message, bytes calldata signature, bytes calldata expandedPublicKey)
        external
        view
        returns (bool)
    {
        return _verify(VERIFY_MLDSA, message, signature, expandedPublicKey);
    }

    function verifyMldsaEth(bytes32 message, bytes calldata signature, bytes calldata expandedPublicKey)
        external
        view
        returns (bool)
    {
        return _verify(VERIFY_MLDSA_ETH, message, signature, expandedPublicKey);
    }

    function _verify(
        address precompile,
        bytes32 message,
        bytes calldata signature,
        bytes calldata expandedPublicKey
    ) private view returns (bool) {
        if (signature.length != SIGNATURE_SIZE || expandedPublicKey.length != EXPANDED_PUBLIC_KEY_SIZE) {
            return false;
        }
        (bool success, bytes memory output) =
            precompile.staticcall(abi.encodePacked(message, signature, expandedPublicKey));
        if (!success || output.length != 32) {
            return false;
        }
        uint256 result;
        assembly {
            result := mload(add(output, 0x20))
        }
        return result == 1;
    }
}
