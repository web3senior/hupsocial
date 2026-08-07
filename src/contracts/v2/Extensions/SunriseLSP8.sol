// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { LSP8IdentifiableDigitalAsset } from "@lukso/lsp8-contracts/contracts/LSP8IdentifiableDigitalAsset.sol";
import { _LSP8_TOKENID_FORMAT_NUMBER } from "@lukso/lsp8-contracts/contracts/LSP8Constants.sol";
import { _LSP4_METADATA_KEY, _LSP4_TOKEN_TYPE_COLLECTION } from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./SunriseGM.sol";
import { ISunriseRenderer } from "./SunriseRenderer.sol";

/**
 * @title Sunrise
 * @author Hup Labs
 * @notice A free daily "GM" collectible for LUKSO. One mint per wallet per UTC day; the art and
 *         every trait are generated onchain at read time, so a Sunrise needs no server, no IPFS
 *         pin, and no indexer to keep displaying.
 * @dev LSP8 shell over `SunriseGM`, which holds all the game rules. LSP8 rather than ERC721 on
 *      purpose: the LSP1 notification on mint is what makes the token appear on the recipient's
 *      Universal Profile without anyone indexing it, which is the entire reason this collection
 *      lives on LUKSO.
 *
 *      Token type is COLLECTION, not NFT — every token id carries its own metadata. Token ids are
 *      sequential numbers cast to bytes32 (`_LSP8_TOKENID_FORMAT_NUMBER`), the same convention
 *      HupTrade uses so a future ERC721 shell casts losslessly in both directions.
 *
 *      No fee, no payable path, no session-key path. Minting is a normal user-confirmed
 *      transaction so the token lands on the viewer's real profile rather than a burner.
 * @custom:version 1.0.0
 * @custom:chain lukso
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🌅
 */
contract SunriseLSP8 is SunriseGM, LSP8IdentifiableDigitalAsset {
  using Strings for uint256;

  // --- STATE VARIABLES ---

  /// @notice The art renderer this collection reads from.
  address public renderer;

  /// @notice Once true the renderer can never be replaced and the art is permanent.
  bool public rendererLocked;

  /// @dev VerifiableURI header: 0x0000 marker + 0x6f357c6a keccak256(utf8) + 0x0020 digest length.
  bytes8 private constant _VERIFIABLE_URI_HEADER = 0x00006f357c6a0020;

  /// @dev Rendered at 1000x1000; the renderer's viewBox is fixed to match.
  uint256 private constant _CANVAS = 1000;

  // --- CONSTRUCTOR ---

  /// @param renderer_ Deployed `SunriseRendererV1`.
  /// @param owner_ Collection owner — may swap the renderer until `lockRenderer` is called, and
  ///        sets the collection-level LSP4Metadata after deployment.
  constructor(
    address renderer_,
    address owner_
  )
    LSP8IdentifiableDigitalAsset("Sunrise", "SUNRISE", owner_, _LSP4_TOKEN_TYPE_COLLECTION, _LSP8_TOKENID_FORMAT_NUMBER)
  {
    if (owner_ == address(0) || renderer_.code.length == 0) revert InvalidAddress();
    renderer = renderer_;
    emit RendererSet(renderer_);
  }

  // --- MUTATIVE LOGIC ---

  /// @notice Mint today's Sunrise to the caller. Reverts if the caller already minted today.
  /// @dev All rule state is written by `_recordGm` before `_mint` fires the recipient's LSP1
  ///      hook, so a recipient that re-enters this function hits AlreadyMintedToday.
  ///
  ///      `force` is true because most recipients are exactly the addresses a false would block:
  ///      plain EOAs, and Universal Profiles whose LSP1 delegate is not set up. Same reasoning as
  ///      HupTrade preferring `transferFrom` over `safeTransferFrom` for ERC721 payouts.
  /// @return tokenId The newly minted token id.
  function mint() external returns (uint256 tokenId) {
    Sun memory sun;
    (tokenId, sun) = _recordGm(msg.sender);

    _mint(msg.sender, bytes32(tokenId), true, "");

    emit SunriseMinted(msg.sender, tokenId, sun.dayNumber, sun.streak, sun.positionOfDay, sun.hourUTC);
  }

  // --- VIEW FUNCTIONS ---

  /// @notice The raw SVG for a minted token.
  function renderOf(uint256 tokenId) external view returns (string memory) {
    Sun memory sun = traitsOf(tokenId);
    return ISunriseRenderer(renderer).render(sun.dayNumber, sun.streak, sun.positionOfDay, sun.hourUTC);
  }

  /// @notice Render arbitrary traits without minting — lets the mini app show the viewer exactly
  ///         what today's Sunrise would look like before they confirm.
  function preview(
    uint256 dayNumber,
    uint256 streak,
    uint256 positionOfDay,
    uint256 hourUTC
  ) external view returns (string memory) {
    return ISunriseRenderer(renderer).render(dayNumber, streak, positionOfDay, hourUTC);
  }

  // --- INTERNAL LOGIC ---

  /// @dev Serves LSP4Metadata for minted tokens from onchain state instead of storage. Any value
  ///      the owner writes under `_LSP4_METADATA_KEY` via `setDataForTokenId` is shadowed for
  ///      minted ids — per-token metadata is derived, by design, and cannot be edited after the
  ///      fact. All other data keys fall through to the base implementation untouched.
  function _getDataForTokenId(
    bytes32 tokenId,
    bytes32 dataKey
  ) internal view virtual override returns (bytes memory) {
    if (dataKey == _LSP4_METADATA_KEY && _exists(tokenId)) {
      return _verifiableMetadata(uint256(tokenId));
    }
    return super._getDataForTokenId(tokenId, dataKey);
  }

  /// @dev Wraps the JSON as an LSP2 VerifiableURI. The digest is taken over the same bytes the
  ///      data URI decodes to, so the value verifies against itself with no offchain fetch.
  function _verifiableMetadata(uint256 tokenId) private view returns (bytes memory) {
    bytes memory json = _metadataJson(tokenId);
    return
      abi.encodePacked(
        _VERIFIABLE_URI_HEADER,
        keccak256(json),
        "data:application/json;base64,",
        Base64.encode(json)
      );
  }

  function _metadataJson(uint256 tokenId) private view returns (bytes memory) {
    Sun memory sun = _suns[tokenId];
    uint32 dayIndex = sun.dayNumber - launchDay + 1;
    bytes memory svg = bytes(
      ISunriseRenderer(renderer).render(sun.dayNumber, sun.streak, sun.positionOfDay, sun.hourUTC)
    );

    return
      abi.encodePacked(
        '{"LSP4Metadata":{"name":"Sunrise #',
        tokenId.toString(),
        '","description":"',
        _description(tokenId, dayIndex, sun),
        '","links":[{"title":"Hup","url":"https://hup.social"}],"attributes":',
        _attributes(dayIndex, sun),
        ',"icon":[],"assets":[],"images":[[',
        _image(svg),
        "]]}}"
      );
  }

  function _description(uint256 tokenId, uint32 dayIndex, Sun memory sun) private pure returns (bytes memory) {
    return
      abi.encodePacked(
        "GM. Sunrise #",
        tokenId.toString(),
        " minted on day ",
        uint256(dayIndex).toString(),
        " with a streak of ",
        uint256(sun.streak).toString(),
        sun.positionOfDay == 1 ? bytes(", first of the day") : bytes(""),
        ". One per wallet per UTC day: the supply is unlimited, the streak is not."
      );
  }

  function _attributes(uint32 dayIndex, Sun memory sun) private pure returns (bytes memory) {
    return
      abi.encodePacked(
        "[",
        _attrNumber("Day", dayIndex),
        ",",
        _attrNumber("Streak", sun.streak),
        ",",
        _attrNumber("Position", sun.positionOfDay),
        ",",
        _attrNumber("Hour UTC", sun.hourUTC),
        ",",
        _attrString("First of Day", sun.positionOfDay == 1 ? string("Yes") : string("No")),
        ",",
        _attrString("Milestone", _milestone(tierOf(sun.streak))),
        "]"
      );
  }

  function _image(bytes memory svg) private pure returns (bytes memory) {
    return
      abi.encodePacked(
        '{"width":',
        _CANVAS.toString(),
        ',"height":',
        _CANVAS.toString(),
        ',"url":"data:image/svg+xml;base64,',
        Base64.encode(svg),
        '","verification":{"method":"keccak256(bytes)","data":"',
        uint256(keccak256(svg)).toHexString(32),
        '"}}'
      );
  }

  function _attrNumber(string memory key, uint256 value) private pure returns (bytes memory) {
    return abi.encodePacked('{"key":"', key, '","value":', value.toString(), ',"type":"number"}');
  }

  function _attrString(string memory key, string memory value) private pure returns (bytes memory) {
    return abi.encodePacked('{"key":"', key, '","value":"', value, '","type":"string"}');
  }

  /// @dev Human label for a milestone tier. Mirrors `SunriseGM.tierOf`'s thresholds.
  function _milestone(uint8 tier) private pure returns (string memory) {
    if (tier == 4) return "Year";
    if (tier == 3) return "Century";
    if (tier == 2) return "Month";
    if (tier == 1) return "Week";
    return "None";
  }

  // --- ADMIN CONFIGURATION ---

  /// @notice Point the collection at a different renderer. Intended for pre-launch art fixes.
  /// @dev This is a live trust surface: until `lockRenderer` is called the owner can change every
  ///      token's picture. Lock it before the collection is listed anywhere.
  function setRenderer(address renderer_) external onlyOwner {
    if (rendererLocked) revert RendererIsLocked();
    if (renderer_.code.length == 0) revert InvalidAddress();
    renderer = renderer_;
    emit RendererSet(renderer_);
  }

  /// @notice Permanently give up the ability to change the art. One way, no timelock, no undo.
  function lockRenderer() external onlyOwner {
    rendererLocked = true;
    emit RendererLocked(renderer);
  }
}
