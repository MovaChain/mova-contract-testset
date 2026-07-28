// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Minimal x*y=k constant-product AMM (no fee, no LP tokens).
// Demonstrates price discovery, reserve accounting and K invariant.
contract SimpleAMM {
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public lastAmountOut; // written by each swap, read by tests

    event Liquidity(uint256 rA, uint256 rB);
    event Swap(bool aToB, uint256 amtIn, uint256 amtOut, uint256 rA, uint256 rB);

    function addLiquidity(uint256 amtA, uint256 amtB) external {
        reserveA += amtA;
        reserveB += amtB;
        emit Liquidity(reserveA, reserveB);
    }

    // amtOut = rOut * amtIn / (rIn + amtIn)  (floor division — no fee)
    function getAmountOut(uint256 amtIn, uint256 rIn, uint256 rOut)
        public pure returns (uint256)
    {
        require(amtIn > 0 && rIn > 0 && rOut > 0, "INVALID_INPUT");
        return (rOut * amtIn) / (rIn + amtIn);
    }

    function swapAForB(uint256 amtA) external {
        uint256 amtB = getAmountOut(amtA, reserveA, reserveB);
        require(amtB > 0, "INSUFFICIENT_OUTPUT");
        reserveA += amtA;
        reserveB -= amtB;
        lastAmountOut = amtB;
        emit Swap(true, amtA, amtB, reserveA, reserveB);
    }

    function swapBForA(uint256 amtB) external {
        uint256 amtA = getAmountOut(amtB, reserveB, reserveA);
        require(amtA > 0, "INSUFFICIENT_OUTPUT");
        reserveB += amtB;
        reserveA -= amtA;
        lastAmountOut = amtA;
        emit Swap(false, amtB, amtA, reserveA, reserveB);
    }

    function getK() external view returns (uint256) {
        return reserveA * reserveB;
    }
}
