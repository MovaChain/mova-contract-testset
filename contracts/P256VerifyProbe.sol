// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-7951 — P256VERIFY precompile at 0x0000…0100 (Osaka).
/// Calls the precompile with the 160-byte input
///   msgHash(32) || r(32) || s(32) || qX(32) || qY(32)
/// and returns the precompile output (32-byte 1 on valid sig, empty on fail).
contract P256VerifyProbe {
    address constant P256_VERIFY = address(uint160(0x100));

    bool public lastOk;       // result of the last write-path verification
    bytes public lastRaw;     // raw precompile output of the last write
    bool public verified;

    /// State-changing: runs P256VERIFY and persists the boolean result so the
    /// test can read it back via `lastOk` instead of relying on staticCall.
    function writeVerify(
        bytes32 msgHash,
        bytes32 r,
        bytes32 s,
        bytes32 qx,
        bytes32 qy
    ) external {
        bytes memory input = abi.encodePacked(msgHash, r, s, qx, qy);
        (bool callOk, bytes memory out) = P256_VERIFY.staticcall(input);
        lastOk = callOk && out.length == 32 && uint256(bytes32(out)) == 1;
        lastRaw = out;
        verified = true;
    }

    function verify(
        bytes32 msgHash,
        bytes32 r,
        bytes32 s,
        bytes32 qx,
        bytes32 qy
    ) external view returns (bool ok, bytes memory raw) {
        bytes memory input = abi.encodePacked(msgHash, r, s, qx, qy);
        (bool callOk, bytes memory out) = P256_VERIFY.staticcall(input);
        // The precompile itself never reverts; "failure" is signalled by
        // returning empty data.
        ok = callOk && out.length == 32 && uint256(bytes32(out)) == 1;
        raw = out;
    }
}
