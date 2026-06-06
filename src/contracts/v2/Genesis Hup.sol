// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/* 
 * Genesis Hup - NFT Collection
 * Brand: MCH01 Labs
 */

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract GenesisHup is ERC721Enumerable, Ownable {
    using Strings for uint256;

    string public baseURI;
    string public baseExtension = ".json";
    
    uint256 public constant MAX_SUPPLY = 1000;
    uint256 public constant PRICE = 0 ether; //0.05 ether;
    uint256 public constant MAX_MINT_AMOUNT = 10;
    
    bool public paused = true;

    constructor(
        string memory _initBaseURI
    ) ERC721("Genesis Hup", "GHUP") Ownable(msg.sender) {
        baseURI = _initBaseURI;
    }

    // internal
    function _baseURI() internal view virtual override returns (string memory) {
        return baseURI;
    }

    // public minting
    function mint(uint256 _mintAmount) public payable {
        uint256 supply = totalSupply();
        require(!paused, "The contract is paused");
        require(_mintAmount > 0, "Need to mint at least 1");
        require(_mintAmount <= MAX_MINT_AMOUNT, "Max mint amount per session exceeded");
        require(supply + _mintAmount <= MAX_SUPPLY, "Exceeds max supply");

        if (msg.sender != owner()) {
            require(msg.value >= PRICE * _mintAmount, "Insufficient funds");
        }

        for (uint256 i = 1; i <= _mintAmount; i++) {
            _safeMint(msg.sender, supply + i);
        }
    }

    function walletOfOwner(address _owner) public view returns (uint256[] memory) {
        uint256 ownerTokenCount = balanceOf(_owner);
        uint256[] memory tokenIds = new uint256[](ownerTokenCount);
        for (uint256 i = 0; i < ownerTokenCount; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(_owner, i);
        }
        return tokenIds;
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        _requireOwned(tokenId);

        string memory currentBaseURI = _baseURI();
        return bytes(currentBaseURI).length > 0
            ? string(abi.encodePacked(currentBaseURI, tokenId.toString(), baseExtension))
            : "";
    }

    // only owner
    function setBaseURI(string memory _newBaseURI) public onlyOwner {
        baseURI = _newBaseURI;
    }

    function setBaseExtension(string memory _newBaseExtension) public onlyOwner {
        baseExtension = _newBaseExtension;
    }

    function pause(bool _state) public onlyOwner {
        paused = _state;
    }

    function withdraw() public onlyOwner {
        // This will transfer the entire contract balance to the owner wallet
        (bool os, ) = payable(owner()).call{value: address(this).balance}("");
        require(os);
    }
}