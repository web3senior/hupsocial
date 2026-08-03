// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupMiner
 * @author Hup Labs
 * @notice Shared interface for Hup Miner — a free-to-play daily mining mini game whose runs are
 *         rolled and scored entirely onchain.
 * @dev Defines the protocol's public events, custom errors, and public interface used by
 *      HupMiner-compatible contracts, clients, and offchain indexers. A run is a sequence of up
 *      to MAX_DIGS dig outcomes derived from a single seed fixed at play time; clients replay the
 *      packed outcome bytes as reveal animations, they never influence them.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji ⛏️
 */
interface IHupMiner {
    // --- SHARED EVENTS ---

    /// @notice Emitted once per daily run. The single source of truth for offchain indexers —
    ///         daily and weekly leaderboards, streak displays, and play history are all derivable
    ///         from this event alone.
    /// @dev `packedOutcomes` holds one outcome code per dig, one byte each, dig 0 in the least
    ///      significant byte (see the OUTCOME_* constants). Only the first `digs` bytes are
    ///      meaningful — a bomb ends the run early, so later bytes are zero and must be ignored.
    /// @param player The resolved primary wallet the run is credited to (never the session key).
    /// @param day The UTC day number of the run (block.timestamp / 1 days).
    /// @param score Final score after multipliers.
    /// @param digs Digs actually executed (1..MAX_DIGS; short runs ended on a bomb).
    /// @param packedOutcomes Byte-packed outcome codes for each executed dig.
    /// @param streak Consecutive-day play streak including this run.
    event RunPlayed(address indexed player, uint256 indexed day, uint256 score, uint256 digs, uint256 packedOutcomes, uint256 streak);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error Unauthorized();
    error SessionExpired();
    /// @notice One ranked run per player per UTC day — the daily cadence is the game.
    error AlreadyPlayedToday();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function hupContract() external view returns (IHup);
    function ADMIN_ROLE() external view returns (bytes32);
    function MAX_DIGS() external view returns (uint256);
    /// @notice A player's highest single-run score ever.
    function bestScore(address player) external view returns (uint256);
    /// @notice The last UTC day number a player ran (0 = never played).
    function lastPlayedDay(address player) external view returns (uint256);
    /// @notice A player's current consecutive-day streak.
    function currentStreak(address player) external view returns (uint256);
    /// @notice Total runs ever played across all players.
    function totalRuns() external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Plays the caller's (or session owner's) single daily run. The entire run — every
     *         dig outcome, multiplier window, and the final score — is derived onchain from a
     *         seed fixed in this transaction; nothing the client sends can influence it.
     * @dev Callable directly by the player, or by their authorized burner session key registered
     *      in Hup Core (resolved exactly like Hup Core's own session actions). The seed mixes
     *      block.prevrandao so a run cannot be simulated before it is played. Free to play by
     *      design: no msg.value, no prize custody — see the project docs on why prizes stay out
     *      of this contract until mainnet.
     * @param _owner The primary wallet to credit, or address(0) when the caller plays as itself.
     * @return score The final score of the run.
     */
    function play(address _owner) external returns (uint256 score);

    // --- VIEW FUNCTIONS ---

    /// @notice The current UTC day number (block.timestamp / 1 days).
    function currentDay() external view returns (uint256);

    /// @notice True if the player has already used today's run.
    function hasPlayedToday(address _player) external view returns (bool);

    /**
     * @notice Unpacks a RunPlayed `packedOutcomes` value into per-dig outcome codes.
     * @dev Convenience for clients and indexers; pure mirror of the packing in `play`.
     * @param _packedOutcomes The packed byte sequence from a RunPlayed event.
     * @param _digs The dig count from the same event.
     * @return outcomes One OUTCOME_* code per executed dig, in dig order.
     */
    function decodeOutcomes(uint256 _packedOutcomes, uint256 _digs) external pure returns (uint8[] memory outcomes);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
}
