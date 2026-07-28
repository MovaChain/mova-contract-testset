// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ITTest {
    function test() external;
}

/// @dev VULNERABLE target — state is updated BEFORE the external call but the
/// call still fires before any further state is committed, so a re-entrant
/// caller can call test() again while the first invocation is still running.
contract VulnerableTarget is ITTest {
    uint public callCount;

    receive() external payable {}

    /// Increments counter then sends 1 wei back to caller.
    /// Because the send happens before the function returns, the caller's
    /// fallback() can call test() again → callCount keeps incrementing.
    function test() external override {
        callCount++;
        if (address(this).balance > 0) {
            // Deliberately uses call (not transfer) so the callee gets gas to re-enter.
            (bool ok,) = msg.sender.call{value: 1}("");
            require(ok, "send failed");
        }
    }
}

/// @dev PROTECTED target — identical logic but wrapped in nonReentrant.
/// A re-entrant call from inside the fallback() will revert.
contract ProtectedTarget is ITTest, ReentrancyGuard {
    uint public callCount;

    receive() external payable {}

    function test() external override nonReentrant {
        callCount++;
        if (address(this).balance > 0) {
            (bool ok,) = msg.sender.call{value: 1}("");
            require(ok, "send failed");
        }
    }
}

// ── Attacker (provided by user, count used as depth limiter + call counter) ──
contract Attacker {
    ITTest ttest;
    uint public count;          // incremented each re-entry; also limits depth

    constructor(address _ttest) {
        ttest = ITTest(_ttest);
    }

    function attack() public {
        count = 0;              // reset before each attack
        ttest.test();
    }

    fallback() external payable {
        // This is the re-entrant call.
        // Limit depth to 3 so we don't OOG the whole tx.
        if (address(ttest) != address(0) && count < 3) {
            count++;
            ttest.test();
        }
    }
}
