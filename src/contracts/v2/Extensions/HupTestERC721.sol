// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// HupTestERC721: <address> : <chain>

/**
 * @title Hup Test ERC721
 * @author Hup Labs
 * @notice Throwaway ERC721 collection used to exercise every NFT-holding gate and surface —
 *         poll and community `NftBalance` requirements, Trade listings, Offers, the Assets tab —
 *         on any testnet, without waiting for a real collection to exist there.
 * @dev The ERC721 twin of `HupTestLSP8`, and the collection-shaped sibling of `HupTestToken`.
 *      Token ids are sequential from 1, so they match what the LSP8 twin mints and what
 *      HupDropCollection721 produces. `tokenURI` is the constructor base URI plus the decimal id,
 *      which a test deploy can leave blank — every app path that matters reads `balanceOf` and
 *      `ownerOf`, never metadata.
 *
 *      Anyone can pull one token per call from the open faucet; the owner can mint to any
 *      address. The owner is an explicit argument rather than `msg.sender`, so a deploy through
 *      the CREATE2 factory (tests/deploy.html) does not hand the collection to the factory.
 *      Not for production use — no supply cap, no cooldown, no access control on faucet.
 * @custom:version 1.0.0
 * @custom:chain testnet-only
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🧪
 */
contract HupTestERC721 is ERC721, Ownable {
  // --- STATE VARIABLES ---

  /// @notice Tokens dispensed per faucet call
  uint256 public constant FAUCET_DRIP = 1;

  /// @notice Number of tokens minted so far; the next id is `totalMinted + 1`
  uint256 public totalMinted;

  string private _baseTokenURI;

  // --- EVENTS ---

  /// @notice Emitted when the faucet dispenses a token
  event FaucetDripped(address indexed to, uint256 indexed tokenId);

  // --- CONSTRUCTOR ---

  /// @param name_ Collection name (e.g. "Hup Test ERC721")
  /// @param symbol_ Collection symbol (e.g. "tNFT")
  /// @param baseURI_ Prefix for `tokenURI`, may be empty — ids are appended in decimal
  /// @param owner_ Owner and sole `mint` caller — never a factory address
  constructor(
    string memory name_,
    string memory symbol_,
    string memory baseURI_,
    address owner_
  ) ERC721(name_, symbol_) Ownable(owner_) {
    _baseTokenURI = baseURI_;
  }

  // --- MUTATIVE LOGIC ---

  /// @notice Mints the next sequential token to the caller — open to anyone, unlimited, for testing
  /// @return tokenId The id that was minted
  function faucet() external returns (uint256 tokenId) {
    tokenId = _nextTokenId();
    _mint(msg.sender, tokenId);
    emit FaucetDripped(msg.sender, tokenId);
  }

  /// @notice Mints the next sequential token to any address — owner only
  /// @param to Recipient of the minted token
  /// @return tokenId The id that was minted
  function mint(address to) external onlyOwner returns (uint256 tokenId) {
    tokenId = _nextTokenId();
    _mint(to, tokenId);
  }

  /// @notice Replaces the `tokenURI` prefix — owner only
  function setBaseURI(string calldata baseURI_) external onlyOwner {
    _baseTokenURI = baseURI_;
  }

  // --- VIEW FUNCTIONS ---

  /// @notice Sequential ids are never burned here, so supply equals the mint count
  function totalSupply() external view returns (uint256) {
    return totalMinted;
  }

  // --- INTERNAL LOGIC ---

  /// @inheritdoc ERC721
  function _baseURI() internal view override returns (string memory) {
    return _baseTokenURI;
  }

  /// @dev Reserves and returns the next sequential id. Ids advance by one per mint regardless of
  ///      who minted, so the faucet and `mint` share one counter.
  function _nextTokenId() private returns (uint256) {
    unchecked {
      totalMinted += 1;
    }
    return totalMinted;
  }
}
