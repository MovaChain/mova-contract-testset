// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TestNFT is ERC721URIStorage, Ownable {
    uint256 private _nextId;

    constructor() ERC721("TestNFT", "TNFT") Ownable(msg.sender) {}

    function mint(address to, string memory uri) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextId++;
        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    function nextId() external view returns (uint256) {
        return _nextId;
    }
}
