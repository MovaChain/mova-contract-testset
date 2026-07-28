// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice On-chain ECDSA signature verifier.
///
/// Supports two verification modes:
///   1. Personal sign (EIP-191) — the standard eth_sign / personal_sign.
///   2. EIP-712 typed data — structured data with domain separator.
contract ECDSAProbe {
    using ECDSA for bytes32;

    // ── personal sign ────────────────────────────────────────────────────────
    address public lastPersonalSigner;
    bool    public lastPersonalOk;

    /// @notice Verify an EIP-191 personal_sign signature.
    /// @param messageHash  keccak256 of the raw message (no prefix).
    /// @param sig          65-byte compact signature (r||s||v).
    /// @param expected     Expected signer address.
    function verifyPersonalSign(
        bytes32 messageHash,
        bytes calldata sig,
        address expected
    ) external {
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethHash, sig);
        lastPersonalSigner = recovered;
        lastPersonalOk     = (recovered == expected);
    }

    // ── EIP-712 typed data ───────────────────────────────────────────────────
    address public lastTypedSigner;
    bool    public lastTypedOk;

    // Minimal EIP-712 domain (no version, no salt — keeps the test simple).
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 public constant ORDER_TYPEHASH =
        keccak256("Order(address from,uint256 amount,uint256 nonce)");

    struct Order { address from; uint256 amount; uint256 nonce; }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("ECDSAProbe"),
            block.chainid,
            address(this)
        ));
    }

    function hashOrder(Order calldata o) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator(),
            keccak256(abi.encode(ORDER_TYPEHASH, o.from, o.amount, o.nonce))
        ));
    }

    /// @notice Verify an EIP-712 Order signature.
    function verifyTypedOrder(
        Order calldata o,
        bytes calldata sig,
        address expected
    ) external {
        address recovered = ECDSA.recover(hashOrder(o), sig);
        lastTypedSigner = recovered;
        lastTypedOk     = (recovered == expected);
    }
}
