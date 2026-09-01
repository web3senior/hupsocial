// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { LSP8IdentifiableDigitalAsset } from "@lukso/lsp8-contracts/contracts/LSP8IdentifiableDigitalAsset.sol";
import { LSP8Burnable } from "@lukso/lsp8-contracts/contracts/extensions/LSP8Burnable/LSP8Burnable.sol";
import { LSP8Enumerable } from "@lukso/lsp8-contracts/contracts/extensions/LSP8Enumerable/LSP8Enumerable.sol";
import { _LSP8_TOKENID_FORMAT_NUMBER, _LSP8_TOKEN_METADATA_BASE_URI } from "@lukso/lsp8-contracts/contracts/LSP8Constants.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { _LSP4_CREATORS_ARRAY_KEY, _LSP4_CREATORS_MAP_KEY_PREFIX } from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";
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
contract HupDropCollectionLSP8 is LSP8Burnable, LSP8Enumerable {
  // --- STATE VARIABLES ---

  uint96 public constant MAX_ROYALTY_BPS = 1_000;

  /// @dev ERC2981 interface id, registered alongside the LSP8 ids.
  bytes4 private constant _INTERFACEID_ERC2981 = 0x2a55205a;

  /// @notice The HupDrops engine — the only address that can ever mint.
  address public immutable drops;

  /// @notice Total mintable tokens, fixed forever. 0 = open edition.
  uint256 public immutable maxSupply;

  /// @notice Whether holders can destroy their own tokens. Chosen by the creator at launch and
  ///         immutable after, because it is a term of the sale: a collector deciding whether to
  ///         mint is entitled to know, up front and permanently, whether these tokens can be
  ///         destroyed. A creator who could flip it later would be changing the asset after
  ///         selling it.
  /// @dev When false, `burn` reverts for everyone — the LSP8Burnable entry point is inherited
  ///      but closed. Note the extension's own guard is `_isOperatorOrOwner`, so on a burnable
  ///      collection an authorised operator can burn on the holder's behalf: that is what makes
  ///      burn-to-claim work, and it is also why this is opt-in rather than the default.
  bool public immutable burnable;

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
  /// @notice The requested LSP8TokenIdFormat is not one this collection can honestly declare.
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
   * @param burnable_ Whether holders may burn their tokens. Fixed forever at this value.
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
    uint96 royaltyBps_,
    bool burnable_
  ) LSP8IdentifiableDigitalAsset(name_, symbol_, creator_, tokenType_, _LSP8_TOKENID_FORMAT_NUMBER) {
    if (drops_ == address(0)) revert InvalidAddress();
    if (tokenType_ != _LSP4_TOKEN_TYPE_NFT && tokenType_ != _LSP4_TOKEN_TYPE_COLLECTION) revert InvalidTokenType();

    drops = drops_;
    maxSupply = maxSupply_;
    burnable = burnable_;

    if (lsp4MetadataValue_.length > 0) {
      _setData(_LSP4_METADATA_KEY, lsp4MetadataValue_);
    }
    if (baseURIValue_.length > 0) {
      _setData(_LSP8_TOKEN_METADATA_BASE_URI, baseURIValue_);
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

  /**
   * @notice The ILSP8CappedSupply getter marketplaces and explorers read. 0 = open edition.
   * @dev Implemented as a plain view rather than by inheriting LSP8CappedSupply, deliberately.
   *      That extension caps against `totalSupply()`, which DECREASES when a token is burned —
   *      so on a burnable collection every burn would free a slot and let the drop mint past its
   *      advertised cap. The real ceiling here is enforced twice against monotonic counters that
   *      never move on a burn: `totalMinted` in `engineMint` below, and `drop.minted` in the
   *      engine. Same guarantee the extension advertises, minus the hole.
   */
  function tokenSupplyCap() public view returns (uint256) {
    return maxSupply;
  }

  /**
   * @notice Destroys `tokenId`, if this collection was launched burnable.
   * @dev Overrides LSP8Burnable purely to add that check — authorisation stays the extension's
   *      (`_isOperatorOrOwner`), and so does the LSP1 notification the base `_burn` sends.
   *      `totalMinted` deliberately does not decrease: it is the id high-water mark the engine
   *      derives new ids from, so decrementing it would re-issue a destroyed token's number.
   *      That makes it diverge from the live supply once anything burns — `totalSupply` is the
   *      number in circulation, `totalMinted` the number ever created.
   */
  function burn(bytes32 tokenId, bytes memory data) public virtual override {
    if (!burnable) revert BurningDisabled();

    super.burn(tokenId, data);
  }

  /**
   * @dev LSP8Enumerable and the base both define this hook, so C3 linearisation needs it named
   *      here. `super` walks the chain right-to-left — LSP8Enumerable first, keeping its index
   *      bookkeeping correct — so the global token list stays accurate across mints and burns.
   */
  function _beforeTokenTransfer(
    address from,
    address to,
    bytes32 tokenId,
    bool force,
    bytes memory data
  ) internal virtual override(LSP8IdentifiableDigitalAsset, LSP8Enumerable) {
    super._beforeTokenTransfer(from, to, tokenId, force, data);
  }

  /**
   * @dev Publishes the creator into `LSP4Creators[]` — the key explorers and marketplaces read
   *      to answer "who made this". Written at construction because a drop's creator is fixed
   *      from the first block; there is never a second entry to append.
   *
   *      Three writes, per LSP2/LSP4:
   *        - the array key holds the element count as a uint128 (16 bytes)
   *        - element 0's key is bytes16(arrayKey) + bytes16(index), value the raw address
   *        - LSP4CreatorsMap:<creator> maps back, as bytes4(interfaceId) + bytes16(index)
   *
   *      The encoding was checked against live LUKSO mainnet assets rather than read off the
   *      spec alone: each writes a 16-byte length, a raw 20-byte address at element 0, and a
   *      map value of the creator's interface id followed by its 16-byte index.
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
    // The code check must come FIRST and cannot be replaced by the catch below. For an external
    // call that returns data, the compiler emits an extcodesize check ahead of the call, and
    // that check reverts in this frame — outside the try — so try/catch never sees it. Probing
    // an EOA creator this way reverted the whole drop with empty revert data.
    if (creator_.code.length == 0) return bytes4(0);

    try IERC165(creator_).supportsInterface(_INTERFACEID_LSP0) returns (bool supported) {
      return supported ? _INTERFACEID_LSP0 : bytes4(0);
    } catch {
      // Has code but is not ERC165 — still not a Universal Profile
      return bytes4(0);
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
