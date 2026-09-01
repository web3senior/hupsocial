// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { LSP7DigitalAsset } from "@lukso/lsp7-contracts/contracts/LSP7DigitalAsset.sol";
import { LSP7Burnable } from "@lukso/lsp7-contracts/contracts/extensions/LSP7Burnable/LSP7Burnable.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {
  _LSP4_METADATA_KEY,
  _LSP4_TOKEN_TYPE_NFT,
  _LSP4_CREATORS_ARRAY_KEY,
  _LSP4_CREATORS_MAP_KEY_PREFIX
} from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";

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
contract HupDropCollectionLSP7 is LSP7Burnable {
  // --- STATE VARIABLES ---

  uint96 public constant MAX_ROYALTY_BPS = 1_000;

  /// @dev ERC2981 interface id, registered alongside the LSP7 ids.
  bytes4 private constant _INTERFACEID_ERC2981 = 0x2a55205a;

  /// @notice The HupDrops engine — the only address that can ever mint.
  address public immutable drops;

  /// @notice Total mintable editions, fixed forever. 0 = open edition.
  uint256 public immutable maxSupply;

  /// @notice Whether holders can destroy their own tokens. Chosen by the creator at launch and
  ///         immutable after, because it is a term of the sale: a collector deciding whether to
  ///         mint is entitled to know, up front and permanently, whether these tokens can be
  ///         destroyed.
  bool public immutable burnable;

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
  error BurningDisabled();

  /// @dev LSP0ERC725Account's ERC165 id — what a Universal Profile answers true for, and what
  ///      live LUKSO assets carry in their LSP4CreatorsMap entries.
  bytes4 private constant _INTERFACEID_LSP0 = 0x24871b3d;

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
   * @param burnable_ Whether holders may burn their editions. Fixed forever at this value.
   */
  constructor(
    address drops_,
    address creator_,
    uint256 maxSupply_,
    string memory name_,
    string memory symbol_,
    bytes memory lsp4MetadataValue_,
    address royaltyReceiver_,
    uint96 royaltyBps_,
    bool burnable_
  ) LSP7DigitalAsset(name_, symbol_, creator_, _LSP4_TOKEN_TYPE_NFT, true) {
    if (drops_ == address(0)) revert InvalidAddress();

    drops = drops_;
    maxSupply = maxSupply_;
    burnable = burnable_;

    if (lsp4MetadataValue_.length > 0) {
      _setData(_LSP4_METADATA_KEY, lsp4MetadataValue_);
    }

    _recordCreator(creator_);

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
  /**
   * @notice The supply ceiling explorers read. 0 = open edition.
   * @dev A plain view rather than LSP7CappedSupply, for the same reason its LSP8 twin gives:
   *      that extension caps against `totalSupply()`, which drops when editions burn, so it
   *      would let a burnable drop re-mint past its cap. `totalMinted` never moves on a burn.
   */
  function tokenSupplyCap() public view returns (uint256) {
    return maxSupply;
  }

  /**
   * @notice Destroys `amount` of `from`'s editions, if this collection was launched burnable.
   * @dev Overrides LSP7Burnable purely to add that check — authorisation stays the extension's,
   *      and the base decrements `totalSupply` for us. `totalMinted` deliberately does not
   *      move: it is the drop's high-water mark, so it diverges from circulating supply once
   *      anything burns.
   */
  function burn(address from, uint256 amount, bytes memory data) public virtual override {
    if (!burnable) revert BurningDisabled();

    super.burn(from, amount, data);
  }

  function engineMint(address _to, uint256, uint256 _quantity) external onlyDrops {
    if (maxSupply != 0 && totalMinted + _quantity > maxSupply) revert SupplyExceeded();

    totalMinted += _quantity;

    _mint(_to, _quantity, true, "");
  }

  /**
   * @dev Publishes the creator into `LSP4Creators[]` — see the LSP8 twin for the encoding and
   *      why the interface id is probed rather than assumed.
   */
  function _recordCreator(address creator_) private {
    _setData(_LSP4_CREATORS_ARRAY_KEY, abi.encodePacked(bytes16(uint128(1))));

    _setData(
      bytes32(bytes.concat(bytes16(_LSP4_CREATORS_ARRAY_KEY), bytes16(uint128(0)))),
      abi.encodePacked(creator_)
    );

    _setData(
      bytes32(bytes.concat(_LSP4_CREATORS_MAP_KEY_PREFIX, bytes2(0), bytes20(creator_))),
      abi.encodePacked(_creatorInterfaceId(creator_), bytes16(uint128(0)))
    );
  }

  /**
   * @dev `LSP0ERC725Account` when the creator is a Universal Profile, zero when it is a plain
   *      EOA. Probed, never assumed: a Hup drop can be created from either, and stamping the
   *      UP id on an EOA would be a false claim about what the creator is. The call reverts on
   *      an address with no code, which the catch turns into the EOA answer.
   */
  function _creatorInterfaceId(address creator_) private view returns (bytes4) {
    // Code check first — see the LSP8 twin: the compiler's extcodesize check on a
    // data-returning external call reverts outside the try, so an EOA creator would take the
    // whole drop down with it.
    if (creator_.code.length == 0) return bytes4(0);

    try IERC165(creator_).supportsInterface(_INTERFACEID_LSP0) returns (bool supported) {
      return supported ? _INTERFACEID_LSP0 : bytes4(0);
    } catch {
      return bytes4(0);
    }
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
