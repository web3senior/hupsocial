// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title Hup Drop Collection (ERC721)
 * @author Hup Labs
 * @notice A numbered NFT collection launched through Hup Drops. A real, standalone,
 *         creator-owned contract — no proxy, no clone — whose only tie to the launchpad is
 *         that the HupDrops engine is its sole mint authority. Token ids are sequential from 1;
 *         metadata is `baseURI + tokenId + suffix`, swappable by the creator for
 *         placeholder-then-reveal flows until they freeze it forever.
 * @dev Mints use the unsafe `_mint` on purpose: a paid public mint must not be blockable by a
 *      recipient contract without `onERC721Received`, mirroring HupTrade's `transferFrom`
 *      reasoning for payouts. Royalties are ERC2981 with the creator as default receiver.
 *      `maxSupply` is enforced here as well as in the engine — defense in depth, since the
 *      engine is the only minter either way. No burn path, so `totalSupply` equals
 *      `totalMinted` forever.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupDropCollection721 is ERC721, ERC2981, Ownable {
  using Strings for uint256;

  // --- STATE VARIABLES ---

  uint96 public constant MAX_ROYALTY_BPS = 1_000;

  /// @notice The HupDrops engine — the only address that can ever mint.
  address public immutable drops;

  /// @notice Total mintable tokens, fixed forever. 0 = open edition.
  uint256 public immutable maxSupply;

  /// @notice Tokens minted so far; ids are 1..totalMinted.
  uint256 public totalMinted;

  /// @notice Once true, base URI and suffix can never change again.
  bool public metadataFrozen;

  string private _baseTokenURI;
  string private _uriSuffix;
  string private _contractURI;

  // --- EVENTS ---

  event BaseURIUpdated(string baseURI, string uriSuffix);
  event ContractURIUpdated(string contractURI);
  event MetadataFrozen();
  event RoyaltyUpdated(address receiver, uint96 royaltyBps);

  // --- ERRORS ---

  error OnlyDrops();
  error SupplyExceeded();
  error MetadataIsFrozen();
  error InvalidRoyalty();
  error InvalidAddress();

  // --- MODIFIERS ---

  modifier onlyDrops() {
    if (msg.sender != drops) revert OnlyDrops();
    _;
  }

  // --- CONSTRUCTOR ---

  /**
   * @param drops_ The HupDrops engine (sole mint authority).
   * @param creator_ The collection owner from block one.
   * @param maxSupply_ Total mintable tokens (0 = open edition).
   * @param name_ Collection name, immutable.
   * @param symbol_ Collection symbol, immutable.
   * @param baseURI_ Metadata base — the placeholder URI until reveal.
   * @param uriSuffix_ Appended after the token id (e.g. ".json", or empty).
   * @param contractURI_ Collection-level metadata URI (OpenSea `contractURI` convention).
   * @param royaltyReceiver_ ERC2981 default receiver (address(0) with 0 bps to skip).
   * @param royaltyBps_ ERC2981 royalty, capped at MAX_ROYALTY_BPS.
   */
  constructor(
    address drops_,
    address creator_,
    uint256 maxSupply_,
    string memory name_,
    string memory symbol_,
    string memory baseURI_,
    string memory uriSuffix_,
    string memory contractURI_,
    address royaltyReceiver_,
    uint96 royaltyBps_
  ) ERC721(name_, symbol_) Ownable(creator_) {
    if (drops_ == address(0)) revert InvalidAddress();

    drops = drops_;
    maxSupply = maxSupply_;
    _baseTokenURI = baseURI_;
    _uriSuffix = uriSuffix_;
    _contractURI = contractURI_;

    if (royaltyBps_ > 0) {
      if (royaltyBps_ > MAX_ROYALTY_BPS) revert InvalidRoyalty();
      if (royaltyReceiver_ == address(0)) revert InvalidAddress();
      _setDefaultRoyalty(royaltyReceiver_, royaltyBps_);
    }
  }

  // --- MUTATIVE LOGIC ---

  /**
   * @notice Mints ids `_firstTokenId .. _firstTokenId + _quantity - 1` to `_to`. Engine only.
   * @dev The engine passes a contiguous, 1-based id range it derived from the drop's counter,
   *      so the two counters can never disagree.
   */
  function engineMint(address _to, uint256 _firstTokenId, uint256 _quantity) external onlyDrops {
    if (maxSupply != 0 && totalMinted + _quantity > maxSupply) revert SupplyExceeded();

    totalMinted += _quantity;

    for (uint256 i = 0; i < _quantity; i++) {
      _mint(_to, _firstTokenId + i);
    }
  }

  // --- CREATOR CONFIGURATION ---

  /**
   * @notice Points the collection at new metadata — the reveal, typically. Owner only, until
   *         frozen.
   */
  function setBaseURI(string calldata baseURI_, string calldata uriSuffix_) external onlyOwner {
    if (metadataFrozen) revert MetadataIsFrozen();

    _baseTokenURI = baseURI_;
    _uriSuffix = uriSuffix_;

    emit BaseURIUpdated(baseURI_, uriSuffix_);
  }

  /**
   * @notice Locks the base URI and suffix forever. Irreversible.
   */
  function freezeMetadata() external onlyOwner {
    metadataFrozen = true;

    emit MetadataFrozen();
  }

  /**
   * @notice Updates the collection-level metadata URI. Never frozen — descriptions and banners
   *         may evolve after the art is locked.
   */
  function setContractURI(string calldata contractURI_) external onlyOwner {
    _contractURI = contractURI_;

    emit ContractURIUpdated(contractURI_);
  }

  /**
   * @notice Updates the ERC2981 default royalty. 0 bps clears it.
   */
  function setRoyalty(address _receiver, uint96 _royaltyBps) external onlyOwner {
    if (_royaltyBps > MAX_ROYALTY_BPS) revert InvalidRoyalty();

    if (_royaltyBps == 0) {
      _deleteDefaultRoyalty();
    } else {
      if (_receiver == address(0)) revert InvalidAddress();
      _setDefaultRoyalty(_receiver, _royaltyBps);
    }

    emit RoyaltyUpdated(_receiver, _royaltyBps);
  }

  // --- VIEW FUNCTIONS ---

  function tokenURI(uint256 _tokenId) public view override returns (string memory) {
    _requireOwned(_tokenId);

    return string.concat(_baseTokenURI, _tokenId.toString(), _uriSuffix);
  }

  /// @notice Collection-level metadata (OpenSea `contractURI` convention).
  function contractURI() external view returns (string memory) {
    return _contractURI;
  }

  /// @notice Marketplace convenience; equals `totalMinted` since nothing burns.
  function totalSupply() external view returns (uint256) {
    return totalMinted;
  }

  function supportsInterface(bytes4 _interfaceId) public view override(ERC721, ERC2981) returns (bool) {
    return super.supportsInterface(_interfaceId);
  }
}
