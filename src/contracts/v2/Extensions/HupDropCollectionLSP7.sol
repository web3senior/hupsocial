// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { LSP7DigitalAsset } from "@lukso/lsp7-contracts/contracts/LSP7DigitalAsset.sol";
import { _LSP4_METADATA_KEY, _LSP4_TOKEN_TYPE_NFT } from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";

/**
 * @title Hup Drop Collection (LSP7)
 * @author Hup Labs
 * @notice An edition collection launched through Hup Drops on LUKSO: one artwork, minted as
 *         `maxSupply` non-divisible LSP7 units. A real, standalone, creator-owned contract —
 *         no proxy, no clone — whose only tie to the launchpad is that the HupDrops engine is
 *         its sole mint authority. Mints notify recipients via LSP1, so a fresh edition appears
 *         on the collector's Universal Profile without anyone indexing it.
 * @dev The LUKSO twin of HupDropCollection1155. Token type is NFT and the asset is
 *      non-divisible (`decimals() == 0`) — one unit is one edition, which is exactly what
 *      HupEditions requires to list it on the secondary market later. The artwork lives in the
 *      collection-level `LSP4Metadata` data key; the owner updates it through the standard
 *      ERC725Y `setData` (placeholder-then-reveal) until `freezeMetadata` locks it forever.
 *      Royalties are ERC2981 (`royaltyInfo`) implemented by hand rather than via OpenZeppelin,
 *      whose ERC165 base would collide with ERC725Y's `supportsInterface`; EVM marketplaces and
 *      indexers read it the same either way.
 * @custom:version 1.0.0
 * @custom:chain lukso
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupDropCollectionLSP7 is LSP7DigitalAsset {
  // --- STATE VARIABLES ---

  uint96 public constant MAX_ROYALTY_BPS = 1_000;

  /// @dev ERC2981 interface id, registered alongside the LSP7 ids.
  bytes4 private constant _INTERFACEID_ERC2981 = 0x2a55205a;

  /// @notice The HupDrops engine — the only address that can ever mint.
  address public immutable drops;

  /// @notice Total mintable editions, fixed forever. 0 = open edition.
  uint256 public immutable maxSupply;

  /// @notice Editions minted so far.
  uint256 public totalMinted;

  /// @notice Once true, the LSP4Metadata data key can never change again.
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
   * @param name_ Collection name, immutable.
   * @param symbol_ Collection symbol, immutable.
   * @param lsp4MetadataValue_ Pre-encoded VerifiableURI for the `LSP4Metadata` data key — the
   *        placeholder until reveal. Empty to set later via `setData`.
   * @param royaltyReceiver_ ERC2981 receiver (address(0) with 0 bps to skip).
   * @param royaltyBps_ ERC2981 royalty, capped at MAX_ROYALTY_BPS.
   */
  constructor(
    address drops_,
    address creator_,
    uint256 maxSupply_,
    string memory name_,
    string memory symbol_,
    bytes memory lsp4MetadataValue_,
    address royaltyReceiver_,
    uint96 royaltyBps_
  ) LSP7DigitalAsset(name_, symbol_, creator_, _LSP4_TOKEN_TYPE_NFT, true) {
    if (drops_ == address(0)) revert InvalidAddress();

    drops = drops_;
    maxSupply = maxSupply_;

    if (lsp4MetadataValue_.length > 0) {
      _setData(_LSP4_METADATA_KEY, lsp4MetadataValue_);
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
   * @notice Mints `_quantity` editions to `_to`. Engine only.
   * @dev Edition standard: the id range parameter is ignored, balances are what count. `force`
   *      is true so plain EOAs and Universal Profiles without an LSP1 delegate can receive —
   *      the same reasoning as HupTrade's payouts.
   */
  function engineMint(address _to, uint256, uint256 _quantity) external onlyDrops {
    if (maxSupply != 0 && totalMinted + _quantity > maxSupply) revert SupplyExceeded();

    totalMinted += _quantity;

    _mint(_to, _quantity, true, "");
  }

  // --- CREATOR CONFIGURATION ---

  /**
   * @notice Locks the `LSP4Metadata` data key forever. Irreversible. Reveal happens through the
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
    if (metadataFrozen && dataKey == _LSP4_METADATA_KEY) revert MetadataIsFrozen();

    super._setData(dataKey, dataValue);
  }
}
