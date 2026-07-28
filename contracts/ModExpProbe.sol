// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-7883 — ModExp re-pricing (Osaka)
/// We can't probe gas pricing perfectly from inside the EVM, but we can
/// invoke the precompile and assert the *result* still matches plus measure
/// the gas burnt by the staticcall — pre-Osaka and post-Osaka should differ
/// for "large" inputs (modulus > 32 bytes).
contract ModExpProbe {
    address constant MOD_EXP = address(uint160(0x05));

    bytes public lastResult; // persisted result of the last write-path call
    uint256 public lastGas;  // gas the staticcall consumed on the last write
    bool public computed;

    /// State-changing: runs the ModExp precompile and persists both the result
    /// and the gas the staticcall consumed, so the test reads them back from
    /// storage instead of via a view call.
    function compute(
        bytes calldata b,
        bytes calldata e,
        bytes calldata m
    ) external {
        bytes memory input = abi.encodePacked(
            uint256(b.length),
            uint256(e.length),
            uint256(m.length),
            b,
            e,
            m
        );
        uint256 g0 = gasleft();
        (bool ok, bytes memory out) = MOD_EXP.staticcall(input);
        uint256 g1 = gasleft();
        require(ok, "modexp failed");
        lastResult = out;
        lastGas = g0 - g1;
        computed = true;
    }

    /// Computes b^e mod m using the precompile and also reports the gas
    /// consumed by the staticcall, so the test can compare new vs old pricing.
    function pow(
        bytes calldata b,
        bytes calldata e,
        bytes calldata m
    ) external view returns (bytes memory result, uint256 gasUsed) {
        bytes memory input = abi.encodePacked(
            uint256(b.length),
            uint256(e.length),
            uint256(m.length),
            b,
            e,
            m
        );
        uint256 g0 = gasleft();
        (bool ok, bytes memory out) = MOD_EXP.staticcall(input);
        uint256 g1 = gasleft();
        require(ok, "modexp failed");
        result = out;
        gasUsed = g0 - g1;
    }
}
