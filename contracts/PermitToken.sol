// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

// ERC-20 with EIP-2612 permit() — gasless off-chain approvals.
contract PermitToken is ERC20Permit {
    constructor() ERC20("PermitToken", "PMT") ERC20Permit("PermitToken") {
        _mint(msg.sender, 1_000_000 ether);
    }
}
