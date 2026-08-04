// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./IHupMiner.sol";

/**
 * @title Hup Miner
 * @author Hup Labs
 * @notice Extension contract for the Hup Miner daily mining game. Each player gets one ranked run
 *         per UTC day: up to 20 digs rolled from a seed fixed at play time, with gold, gems, ×2
 *         multiplier windows, and run-ending bombs. Every run emits a RunPlayed event so offchain
 *         indexers can build daily and weekly leaderboards.
 * @dev Uses IHupMiner for shared events, errors, and view signatures. Integrates with Hup Core
 *      via IHup — a player's burner session key (Settings → In App Wallet) may submit the run on
 *      their behalf, resolved exactly like Hup Core's own session actions, which is what makes
 *      zero-popup embedded play possible. Free to play: no fees, no prize custody, no payable
 *      paths. Randomness mixes block.prevrandao, which is fine for bragging rights and would NOT
 *      be fine for money — do not attach prizes to this contract without upgrading the
 *      randomness to commit-reveal or VRF.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji ⛏️
 */
contract HupMiner is IHupMiner, Pausable, AccessControl {
    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Maximum digs (energy) per run.
    uint256 public constant MAX_DIGS = 20;

    /// @notice Digs a ×2 multiplier stays active for after being dug up.
    uint256 public constant MULTIPLIER_WINDOW = 5;

    // Outcome codes, one byte each in RunPlayed.packedOutcomes. Public so clients and indexers
    // can bind to them instead of hardcoding magic numbers.
    uint8 public constant OUTCOME_EMPTY = 0;
    uint8 public constant OUTCOME_GOLD10 = 1;
    uint8 public constant OUTCOME_GOLD25 = 2;
    uint8 public constant OUTCOME_GOLD50 = 3;
    uint8 public constant OUTCOME_GEM = 4;
    uint8 public constant OUTCOME_MULTIPLIER = 5;
    uint8 public constant OUTCOME_BOMB = 6;

    /// @notice The Hup Core contract instance — the authority on burner sessions.
    IHup public immutable hupContract;

    /// @notice A player's highest single-run score ever.
    mapping(address => uint256) public bestScore;

    /// @notice The last UTC day number a player ran (0 = never played).
    mapping(address => uint256) public lastPlayedDay;

    /// @notice A player's current consecutive-day streak.
    mapping(address => uint256) public currentStreak;

    /// @notice Total runs ever played across all players.
    uint256 public totalRuns;

    // --- MODIFIERS ---

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the miner contract.
     * @param _hupAddress Address of the deployed core Hup contract on this chain.
     * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     */
    constructor(address _hupAddress, address _admin) {
        if (_hupAddress == address(0) || _admin == address(0)) revert InvalidAddress();

        hupContract = IHup(_hupAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    // --- MUTATIVE LOGIC ---

    /**
     * @inheritdoc IHupMiner
     */
    function play(address _owner) external whenNotPaused returns (uint256 score) {
        address player = _resolveActor(_owner);

        uint256 day = block.timestamp / 1 days;
        if (lastPlayedDay[player] == day) revert AlreadyPlayedToday();

        // Playing yesterday extends the streak; any gap resets it. Day 0 can never occur on a
        // live chain, so lastPlayedDay == 0 (never played) always lands in the reset branch.
        uint256 streak = lastPlayedDay[player] + 1 == day ? currentStreak[player] + 1 : 1;
        currentStreak[player] = streak;
        lastPlayedDay[player] = day;
        totalRuns++;

        // prevrandao keeps the run unknowable before this transaction lands (no pre-simulating a
        // good day); player and day keep concurrent runs in one block distinct.
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, player, day, address(this))));

        (uint256 runScore, uint256 digs, uint256 packedOutcomes) = _rollRun(seed);
        score = runScore;

        if (score > bestScore[player]) {
            bestScore[player] = score;
        }

        emit RunPlayed(player, day, score, digs, packedOutcomes, streak);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    /**
     * @inheritdoc IHupMiner
     */
    function currentDay() external view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /**
     * @inheritdoc IHupMiner
     */
    function hasPlayedToday(address _player) external view returns (bool) {
        return lastPlayedDay[_player] == block.timestamp / 1 days;
    }

    /**
     * @inheritdoc IHupMiner
     */
    function decodeOutcomes(uint256 _packedOutcomes, uint256 _digs) external pure returns (uint8[] memory outcomes) {
        uint256 digs = _digs > MAX_DIGS ? MAX_DIGS : _digs;
        outcomes = new uint8[](digs);

        for (uint256 i = 0; i < digs; i++) {
            outcomes[i] = uint8(_packedOutcomes >> (8 * i));
        }
    }

    // --- INTERNAL LOGIC ---

    /**
     * @dev Rolls a full run from one seed. Loot table per dig, in per-mille:
     *
     *      bomb        7.0%  ends the run
     *      gem         6.0%  +100
     *      ×2 pickup  10.0%  doubles point tiles for the next MULTIPLIER_WINDOW digs
     *      gold 50    12.0%  +50
     *      gold 25    20.0%  +25
     *      gold 10    30.0%  +10
     *      empty      15.0%  +0
     *
     *      A fresh ×2 pickup refreshes the window rather than stacking. The window ticks down on
     *      every subsequent dig, scoring or not.
     */
    function _rollRun(uint256 _seed) internal pure returns (uint256 score, uint256 digs, uint256 packedOutcomes) {
        uint256 multiplierRemaining;

        for (uint256 i = 0; i < MAX_DIGS; i++) {
            uint256 roll = uint256(keccak256(abi.encodePacked(_seed, i))) % 1000;

            uint8 outcome;
            uint256 points;

            if (roll < 70) {
                outcome = OUTCOME_BOMB;
            } else if (roll < 130) {
                outcome = OUTCOME_GEM;
                points = 100;
            } else if (roll < 230) {
                outcome = OUTCOME_MULTIPLIER;
            } else if (roll < 350) {
                outcome = OUTCOME_GOLD50;
                points = 50;
            } else if (roll < 550) {
                outcome = OUTCOME_GOLD25;
                points = 25;
            } else if (roll < 850) {
                outcome = OUTCOME_GOLD10;
                points = 10;
            }
            // else OUTCOME_EMPTY with zero points

            packedOutcomes |= uint256(outcome) << (8 * i);
            digs = i + 1;

            if (outcome == OUTCOME_BOMB) break;

            if (points > 0 && multiplierRemaining > 0) {
                points *= 2;
            }
            score += points;

            if (outcome == OUTCOME_MULTIPLIER) {
                multiplierRemaining = MULTIPLIER_WINDOW;
            } else if (multiplierRemaining > 0) {
                multiplierRemaining--;
            }
        }
    }

    /**
     * @dev Resolves the acting player, honoring Hup Core burner sessions: the session key may act
     *      as the owner it is registered to, and no one else. Mirrors Hup Core's own resolution.
     */
    function _resolveActor(address _owner) internal view returns (address) {
        address sender = msg.sender;

        if (_owner == address(0) || _owner == sender) {
            return sender;
        }

        (address burnerKey, uint256 expiresAt) = hupContract.userSessions(_owner);
        if (burnerKey != sender) revert Unauthorized();
        if (block.timestamp >= expiresAt) revert SessionExpired();

        return _owner;
    }

    // --- ADMIN CONFIGURATION ---

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }
}
