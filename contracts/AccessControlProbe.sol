// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/access/Ownable.sol";

// Two-tier access control: owner + explicit operator whitelist.
contract AccessControlProbe is Ownable {
    uint256 public adminValue;
    mapping(address => bool) public operators;

    event OperatorAdded(address indexed op);
    event OperatorRemoved(address indexed op);
    event ValueSet(address indexed by, uint256 value);

    constructor() Ownable(msg.sender) {}

    function addOperator(address op) external onlyOwner {
        operators[op] = true;
        emit OperatorAdded(op);
    }

    function removeOperator(address op) external onlyOwner {
        operators[op] = false;
        emit OperatorRemoved(op);
    }

    modifier onlyOperator() {
        require(operators[msg.sender] || msg.sender == owner(), "NOT_OPERATOR");
        _;
    }

    function setValue(uint256 v) external onlyOperator {
        adminValue = v;
        emit ValueSet(msg.sender, v);
    }
}
