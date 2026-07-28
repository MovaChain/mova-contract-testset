// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor() ERC20("Test", "TTT") {
        _mint(msg.sender, 1e8 ether);
    }

    /// @notice Anyone can mint additional tokens for testing purposes.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
