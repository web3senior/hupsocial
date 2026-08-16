// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Hup Drop Collection (ERC1155)
 * @author Hup Labs
 * @notice An edition collection launched through Hup Drops: one artwork, id 0, minted
 *         `maxSupply` times. A real, standalone, creator-owned contract — no proxy, no clone —
 *         whose only tie to the launchpad is that the HupDrops engine is its sole mint
 *         authority. The single token URI is swappable by the creator for
 *         placeholder-then-reveal flows until they freeze it forever.
 * @dev The balance-based sibling of HupDropCollection721, and the EVM twin of
 *      HupDropCollectionLSP7 — every token is the same edition, which is what makes it
 *      listable on HupEditions afterwards. `name` and `symbol` are stored explicitly because
 *      ERC1155 does not define them but every marketplace reads them. ERC1155's `_mint` always
 *      calls `onERC1155Received` on contract recipients — the standard has no unforced variant,
 *      so a contract minter must implement it; that is the standard's own constraint.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupDropCollection1155 is ERC1155, ERC2981, Ownable {
  // --- STATE VARIABLES ---

  uint96 public constant MAX_ROYALTY_BPS = 1_000;

  /// @notice The one token id this collection ever mints.
  uint256 public constant TOKEN_ID = 0;

  /// @notice The HupDrops engine — the only address that can ever mint.
  address public immutable drops;

  /// @notice Total mintable editions, fixed forever. 0 = open edition.
  uint256 public immutable maxSupply;

  /// @notice Editions minted so far.
  uint256 public totalMinted;

  /// @notice Once true, the token URI can never change again.
  bool public metadataFrozen;

  /// @notice Collection name (ERC1155 has none natively; marketplaces read this).
  string public name;

  /// @notice Collection symbol.
  string public symbol;

  string private _tokenURI;
  string private _contractURI;

  // --- EVENTS ---

  event TokenURIUpdated(string tokenURI);
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
   * @param maxSupply_ Total mintable editions (0 = open edition).
   * @param name_ Collection name.
   * @param symbol_ Collection symbol.
   * @param tokenURI_ Metadata URI of the edition — the placeholder until reveal.
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
    string memory tokenURI_,
    string memory contractURI_,
    address royaltyReceiver_,
    uint96 royaltyBps_
  ) ERC1155("") Ownable(creator_) {
    if (drops_ == address(0)) revert InvalidAddress();

    drops = drops_;
    maxSupply = maxSupply_;
    name = name_;
    symbol = symbol_;
    _tokenURI = tokenURI_;
    _contractURI = contractURI_;

    if (royaltyBps_ > 0) {
      if (royaltyBps_ > MAX_ROYALTY_BPS) revert InvalidRoyalty();
      if (royaltyReceiver_ == address(0)) revert InvalidAddress();
      _setDefaultRoyalty(royaltyReceiver_, royaltyBps_);
    }
  }

  // --- MUTATIVE LOGIC ---

  /**
   * @notice Mints `_quantity` editions of TOKEN_ID to `_to`. Engine only.
   * @dev Edition standard: the id range parameter is ignored, balances are what count.
   */
  function engineMint(address _to, uint256, uint256 _quantity) external onlyDrops {
    if (maxSupply != 0 && totalMinted + _quantity > maxSupply) revert SupplyExceeded();

    totalMinted += _quantity;

    _mint(_to, TOKEN_ID, _quantity, "");
  }

  // --- CREATOR CONFIGURATION ---

  /**
   * @notice Points the edition at new metadata — the reveal, typically. Owner only, until
   *         frozen.
   */
  function setTokenURI(string calldata tokenURI_) external onlyOwner {
    if (metadataFrozen) revert MetadataIsFrozen();

    _tokenURI = tokenURI_;

    emit TokenURIUpdated(tokenURI_);
  }

  /**
   * @notice Locks the token URI forever. Irreversible.
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

  /// @dev One edition, one URI — every id resolves to the same metadata.
  function uri(uint256) public view override returns (string memory) {
    return _tokenURI;
  }

  /// @notice Collection-level metadata (OpenSea `contractURI` convention).
  function contractURI() external view returns (string memory) {
    return _contractURI;
  }

  /// @notice Marketplace convenience; equals `totalMinted` since nothing burns.
  function totalSupply() external view returns (uint256) {
    return totalMinted;
  }

  function supportsInterface(bytes4 _interfaceId) public view override(ERC1155, ERC2981) returns (bool) {
    return super.supportsInterface(_interfaceId);
  }
}
