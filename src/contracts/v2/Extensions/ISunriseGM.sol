// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title ISunriseGM
 * @author Hup Labs
 * @notice Shared interface for Sunrise — a free daily "GM" collectible whose art and traits are
 *         generated entirely onchain. One mint per wallet per UTC day.
 * @dev Defines the shared struct, events, custom errors, and view surface used by Sunrise token
 *      contracts, mini app clients, and offchain indexers. Supply is deliberately uncapped: the
 *      scarce traits are behavioural (streak length, first-of-day position), not minted limits,
 *      so nothing here exposes a max supply or an allowlist.
 * @custom:version 1.0.0
 * @custom:chain lukso
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🌅
 */
interface ISunriseGM {
  // --- SHARED TYPES ---

  /// @notice The frozen trait set of a single Sunrise, captured at mint time and never updated.
  /// @dev Packs into one storage slot (32 + 32 + 32 + 8 = 104 bits). `dayNumber` is the absolute
  ///      UTC day (block.timestamp / 1 days), not the day since launch — it seeds the renderer's
  ///      palette, so a relative index would make early palettes guessable before launch.
  /// @param dayNumber Absolute UTC day the mint happened on.
  /// @param streak Consecutive-day mint streak including this mint (always >= 1).
  /// @param positionOfDay 1-based order within that UTC day; 1 is the first GM of the day.
  /// @param hourUTC UTC hour of the mint (0..23), drives the sun's height in the art.
  struct Sun {
    uint32 dayNumber;
    uint32 streak;
    uint32 positionOfDay;
    uint8 hourUTC;
  }

  // --- SHARED EVENTS ---

  /// @notice Emitted once per mint. The single source of truth for offchain readers — streak
  ///         history, daily counts, and mint feeds are all derivable from this event alone.
  /// @param minter The wallet that minted and received the token.
  /// @param tokenId The minted token id (sequential from 1).
  /// @param dayNumber Absolute UTC day of the mint.
  /// @param streak Consecutive-day streak including this mint.
  /// @param positionOfDay 1-based order within the day.
  /// @param hourUTC UTC hour of the mint.
  event SunriseMinted(
    address indexed minter,
    uint256 indexed tokenId,
    uint256 indexed dayNumber,
    uint256 streak,
    uint256 positionOfDay,
    uint256 hourUTC
  );

  /// @notice Emitted when the art renderer address is set or replaced.
  event RendererSet(address indexed renderer);

  /// @notice Emitted when the renderer is locked permanently. After this the art is immutable.
  event RendererLocked(address indexed renderer);

  // --- SHARED ERRORS ---

  /// @notice One Sunrise per wallet per UTC day — the daily cadence is the whole point.
  error AlreadyMintedToday(uint256 dayNumber);

  /// @notice Zero address, or a renderer address with no contract code behind it.
  error InvalidAddress();

  /// @notice The renderer has been locked and can no longer be replaced.
  error RendererIsLocked();

  /// @notice Queried traits for a token id that was never minted.
  error UnknownTokenId(uint256 tokenId);

  // --- SHARED VIEWS ---

  /// @notice Absolute UTC day number right now (block.timestamp / 1 days).
  function currentDay() external view returns (uint32);

  /// @notice UTC hour right now (0..23).
  function currentHourUTC() external view returns (uint8);

  /// @notice The UTC day this collection launched on, used to derive the human "Day N" trait.
  function launchDay() external view returns (uint32);

  /// @notice Whether `account` has already minted during the current UTC day.
  function hasMintedToday(address account) external view returns (bool);

  /// @notice How many Sunrises have been minted during the current UTC day.
  function todayCount() external view returns (uint32);

  /// @notice The streak `account` would hold if it minted right now — 1 after a missed day.
  /// @dev Lets a client show the stake of today's mint without simulating the transaction.
  function streakIfMintedNow(address account) external view returns (uint32);

  /// @notice Current consecutive-day streak of `account` as of its last mint.
  function streakOf(address account) external view returns (uint32);

  /// @notice Absolute UTC day `account` last minted on; 0 if it never has.
  function lastDayOf(address account) external view returns (uint32);

  /// @notice Total mints recorded for absolute UTC day `dayNumber`.
  function mintsOnDay(uint32 dayNumber) external view returns (uint32);

  /// @notice Running count of Sunrises ever minted; also the highest issued token id.
  function minted() external view returns (uint256);

  /// @notice The frozen traits of `tokenId`.
  function traitsOf(uint256 tokenId) external view returns (Sun memory);
}
