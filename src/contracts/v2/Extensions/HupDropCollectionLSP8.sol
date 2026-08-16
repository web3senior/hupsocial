// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { LSP8IdentifiableDigitalAsset } from "@lukso/lsp8-contracts/contracts/LSP8IdentifiableDigitalAsset.sol";
import { _LSP8_TOKENID_FORMAT_NUMBER, _LSP8_TOKEN_METADATA_BASE_URI } from "@lukso/lsp8-contracts/contracts/LSP8Constants.sol";
import { _LSP4_METADATA_KEY, _LSP4_TOKEN_TYPE_NFT, _LSP4_TOKEN_TYPE_COLLECTION } from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";

/**
 * @title Hup Drop Collection (LSP8)
 * @author Hup Labs
 * @notice A numbered NFT collection launched through Hup Drops on LUKSO. A real, standalone,
 *         creator-owned contract — no proxy, no clone — whose only tie to the launchpad is
 *         that the HupDrops engine is its sole mint authority. Token ids are sequential numbers
 *         from 1 cast to bytes32 (`_LSP8_TOKENID_FORMAT_NUMBER`, the same convention HupTrade
 *         uses, so an ERC721 view of the id casts losslessly in both directions). Mints notify
 *         recipients via LSP1, so a fresh token appears on the collector's Universal Profile
 *         without anyone indexing it.
 * @dev The LUKSO twin of HupDropCollection721. Token type is the creator's choice: COLLECTION
 *      for unique-art drops, where each id resolves its metadata from the
 *      `LSP8TokenMetadataBaseURI` data key plus its decimal number; NFT for numbered editions
 *      of a single artwork, where every id shares the collection-level `LSP4Metadata`. The
 *      owner updates both keys through the standard ERC725Y `setData`
 *      (placeholder-then-reveal) until `freezeMetadata` locks them forever. Royalties are
 *      ERC2981 (`royaltyInfo`) implemented by hand rather than via OpenZeppelin, whose ERC165
 *      base would collide with ERC725Y's `supportsInterface`.
 * @custom:version 1.0.0
 * @custom:chain lukso
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupDropCollectionLSP8 is LSP8IdentifiableDigitalAsset {
  // --- STATE VARIABLES ---

  uint96 public constant MAX_ROYALTY_BPS = 1_000;

  /// @dev ERC2981 interface id, registered alongside the LSP8 ids.
  bytes4 private constant _INTERFACEID_ERC2981 = 0x2a55205a;

  /// @notice The HupDrops engine — the only address that can ever mint.
  address public immutable drops;

  /// @notice Total mintable tokens, fixed forever. 0 = open edition.
  uint256 public immutable maxSupply;

  /// @notice Tokens minted so far; ids are 1..totalMinted.
  uint256 public totalMinted;

  /// @notice Once true, the metadata data keys can never change again.
  bool public metadataFrozen;

  /// @notice ERC2981 royalty receiver (address(0) = no royalty).
  address public royaltyReceiver;

  /// @notice ERC2981 royalty share in basis points.
  uint96 public royaltyBps;

  // --- EVENTS ---

  event MetadataFrozen();
  event RoyaltyUpdated(address receiver, uint96 royaltyBps);

  // --- ERRORS ---

  error OnlyDrops();
  error SupplyExceeded();
  error MetadataIsFrozen();
  error InvalidTokenType();
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
   * @param tokenType_ `_LSP4_TOKEN_TYPE_COLLECTION` (2) for unique art per id,
   *        `_LSP4_TOKEN_TYPE_NFT` (1) for numbered editions of one artwork.
   * @param lsp4MetadataValue_ Pre-encoded VerifiableURI for the `LSP4Metadata` data key.
   *        Empty to set later via `setData`.
   * @param baseURIValue_ Pre-encoded VerifiableURI for the `LSP8TokenMetadataBaseURI` data key
   *        — the placeholder until reveal. Empty for NFT-type drops that share the
   *        collection-level metadata.
   * @param royaltyReceiver_ ERC2981 receiver (address(0) with 0 bps to skip).
   * @param royaltyBps_ ERC2981 royalty, capped at MAX_ROYALTY_BPS.
   */
  constructor(
    address drops_,
    address creator_,
    uint256 maxSupply_,
    string memory name_,
    string memory symbol_,
    uint256 tokenType_,
    bytes memory lsp4MetadataValue_,
    bytes memory baseURIValue_,
    address royaltyReceiver_,
    uint96 royaltyBps_
  ) LSP8IdentifiableDigitalAsset(name_, symbol_, creator_, tokenType_, _LSP8_TOKENID_FORMAT_NUMBER) {
    if (drops_ == address(0)) revert InvalidAddress();
    if (tokenType_ != _LSP4_TOKEN_TYPE_NFT && tokenType_ != _LSP4_TOKEN_TYPE_COLLECTION) revert InvalidTokenType();

    drops = drops_;
    maxSupply = maxSupply_;

    if (lsp4MetadataValue_.length > 0) {
      _setData(_LSP4_METADATA_KEY, lsp4MetadataValue_);
    }
    if (baseURIValue_.length > 0) {
      _setData(_LSP8_TOKEN_METADATA_BASE_URI, baseURIValue_);
    }

    if (royaltyBps_ > 0) {
      if (royaltyBps_ > MAX_ROYALTY_BPS) revert InvalidRoyalty();
      if (royaltyReceiver_ == address(0)) revert InvalidAddress();
      royaltyReceiver = royaltyReceiver_;
      royaltyBps = royaltyBps_;
    }
  }

  // --- MUTATIVE LOGIC ---

  /**
   * @notice Mints ids `_firstTokenId .. _firstTokenId + _quantity - 1` to `_to`. Engine only.
   * @dev The engine passes a contiguous, 1-based id range it derived from the drop's counter,
   *      so the two counters can never disagree. `force` is true so plain EOAs and Universal
   *      Profiles without an LSP1 delegate can receive — the same reasoning as HupTrade's
   *      payouts.
   */
  function engineMint(address _to, uint256 _firstTokenId, uint256 _quantity) external onlyDrops {
    if (maxSupply != 0 && totalMinted + _quantity > maxSupply) revert SupplyExceeded();

    totalMinted += _quantity;

    for (uint256 i = 0; i < _quantity; i++) {
      _mint(_to, bytes32(_firstTokenId + i), true, "");
    }
  }

  // --- CREATOR CONFIGURATION ---

  /**
   * @notice Locks the metadata data keys forever. Irreversible. Reveal happens through the
   *         standard ERC725Y `setData` before this is called.
   */
  function freezeMetadata() external onlyOwner {
    metadataFrozen = true;

    emit MetadataFrozen();
  }

  /**
   * @notice Updates the ERC2981 royalty. 0 bps clears it.
   */
  function setRoyalty(address _receiver, uint96 _royaltyBps) external onlyOwner {
    if (_royaltyBps > MAX_ROYALTY_BPS) revert InvalidRoyalty();
    if (_royaltyBps > 0 && _receiver == address(0)) revert InvalidAddress();

    royaltyReceiver = _royaltyBps == 0 ? address(0) : _receiver;
    royaltyBps = _royaltyBps;

    emit RoyaltyUpdated(royaltyReceiver, _royaltyBps);
  }

  // --- VIEW FUNCTIONS ---

  /**
   * @notice ERC2981 royalty info, uniform across every Hup Drop collection on every chain.
   */
  function royaltyInfo(uint256, uint256 _salePrice) external view returns (address receiver, uint256 royaltyAmount) {
    receiver = royaltyReceiver;
    royaltyAmount = receiver == address(0) ? 0 : (_salePrice * royaltyBps) / 10_000;
  }

  function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
    return _interfaceId == _INTERFACEID_ERC2981 || super.supportsInterface(_interfaceId);
  }

  // --- INTERNAL & OVERRIDE HELPERS ---

  /**
   * @dev Enforces the metadata freeze at the storage layer, so no code path — not even a future
   *      owner contract — can swap the art after the creator locked it.
   */
  function _setData(bytes32 dataKey, bytes memory dataValue) internal virtual override {
    if (metadataFrozen && (dataKey == _LSP4_METADATA_KEY || dataKey == _LSP8_TOKEN_METADATA_BASE_URI)) revert MetadataIsFrozen();

    super._setData(dataKey, dataValue);
  }
}
