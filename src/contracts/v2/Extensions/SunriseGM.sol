// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./ISunriseGM.sol";

/**
 * @title SunriseGM
 * @author Hup Labs
 * @notice The Sunrise game rules, with no token standard attached: UTC day boundaries, the
 *         one-mint-per-wallet-per-day limit, streak accounting, and the per-day mint counter.
 * @dev Deliberately standard-agnostic. LUKSO ships an LSP8 shell on top of this
 *      (`SunriseLSP8`); an ERC721 shell for other chains can reuse the identical rules by
 *      inheriting the same base, so the two can never drift apart. This contract stores no
 *      ownership and mints nothing — the shell owns both.
 *
 *      Day boundaries are UTC midnight (`block.timestamp / 1 days`), matching HupMiner's daily
 *      cadence so every Hup daily mechanic explains the same way. Miners' clocks can nudge
 *      `block.timestamp` by seconds, which is irrelevant at day granularity.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🌅
 */
abstract contract SunriseGM is ISunriseGM {
  // --- STATE VARIABLES ---

  /// @inheritdoc ISunriseGM
  uint32 public immutable override launchDay;

  /// @inheritdoc ISunriseGM
  mapping(address => uint32) public override lastDayOf;

  /// @inheritdoc ISunriseGM
  mapping(address => uint32) public override streakOf;

  /// @inheritdoc ISunriseGM
  mapping(uint32 => uint32) public override mintsOnDay;

  /// @inheritdoc ISunriseGM
  uint256 public override minted;

  /// @dev Frozen traits per token id. Written once at mint and never touched again.
  mapping(uint256 => Sun) internal _suns;

  // --- CONSTRUCTOR ---

  constructor() {
    launchDay = uint32(block.timestamp / 1 days);
  }

  // --- VIEW FUNCTIONS ---

  /// @inheritdoc ISunriseGM
  function currentDay() public view override returns (uint32) {
    return uint32(block.timestamp / 1 days);
  }

  /// @inheritdoc ISunriseGM
  function currentHourUTC() public view override returns (uint8) {
    return uint8((block.timestamp % 1 days) / 1 hours);
  }

  /// @inheritdoc ISunriseGM
  function hasMintedToday(address account) public view override returns (bool) {
    return lastDayOf[account] == currentDay();
  }

  /// @inheritdoc ISunriseGM
  function todayCount() external view override returns (uint32) {
    return mintsOnDay[currentDay()];
  }

  /// @inheritdoc ISunriseGM
  function streakIfMintedNow(address account) external view override returns (uint32) {
    uint32 today = currentDay();
    uint32 last = lastDayOf[account];
    if (last == today) return streakOf[account];
    return _nextStreak(account, last, today);
  }

  /// @inheritdoc ISunriseGM
  function traitsOf(uint256 tokenId) public view override returns (Sun memory sun) {
    sun = _suns[tokenId];
    // dayNumber is never 0 for a real mint (day 0 was 1 Jan 1970), so it doubles as an
    // existence flag without a second mapping.
    if (sun.dayNumber == 0) revert UnknownTokenId(tokenId);
  }

  /// @notice The human-facing day index of a mint — 1 on launch day, counting up from there.
  /// @dev Derived rather than stored: the absolute day is what the renderer needs, and a second
  ///      stored field would be redundant state that could disagree with it.
  function dayIndexOf(uint256 tokenId) public view returns (uint32) {
    return traitsOf(tokenId).dayNumber - launchDay + 1;
  }

  /// @notice Milestone tier for a streak: 0 none, 1 week, 2 month, 3 century, 4 year.
  /// @dev MUST stay identical to `SunriseRenderer.tierOf` — the art and the metadata trait are
  ///      two readings of the same number, and a mismatch would show a token whose picture
  ///      disagrees with its attributes. Change both or neither.
  function tierOf(uint32 streak) public pure returns (uint8) {
    if (streak >= 365) return 4;
    if (streak >= 100) return 3;
    if (streak >= 30) return 2;
    if (streak >= 7) return 1;
    return 0;
  }

  // --- INTERNAL LOGIC ---

  /// @dev Applies one day's GM for `account`: enforces the daily limit, rolls the streak forward
  ///      or resets it, takes the next position of the day, and freezes the traits.
  ///
  ///      Every state write happens here, before the caller mints — so an LSP1 recipient hook
  ///      that re-enters `mint()` finds `lastDayOf` already stamped and reverts with
  ///      AlreadyMintedToday rather than minting twice.
  /// @param account The wallet the GM is credited to.
  /// @return tokenId The freshly issued sequential token id.
  /// @return sun The traits frozen for that token id.
  function _recordGm(address account) internal returns (uint256 tokenId, Sun memory sun) {
    uint32 today = currentDay();
    uint32 last = lastDayOf[account];
    if (last == today) revert AlreadyMintedToday(today);

    uint32 streak = _nextStreak(account, last, today);

    lastDayOf[account] = today;
    streakOf[account] = streak;
    uint32 position = ++mintsOnDay[today];

    unchecked {
      tokenId = ++minted;
    }

    sun = Sun({ dayNumber: today, streak: streak, positionOfDay: position, hourUTC: currentHourUTC() });
    _suns[tokenId] = sun;
  }

  /// @dev The streak `account` earns by minting on `today`. Continues only from the immediately
  ///      preceding day; any gap resets to 1. No freezes, no grace period — the reset is what
  ///      makes a long streak worth anything.
  function _nextStreak(address account, uint32 last, uint32 today) private view returns (uint32) {
    // `last == 0` means never minted; the `last + 1` test would otherwise misread it as a
    // continuation on day 1 of the epoch.
    if (last != 0 && last + 1 == today) return streakOf[account] + 1;
    return 1;
  }
}
