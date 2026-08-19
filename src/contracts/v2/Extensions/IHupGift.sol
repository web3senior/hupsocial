// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IHupGift
 * @author Hup Labs
 * @notice Shared interface for Hup Gift — a generic native-coin gift pool where an admin funds a
 *         round, snapshots a list of eligible accounts offchain, and each of those accounts pulls
 *         its share with a single claim.
 * @dev Defines the protocol's public structs, events, custom errors, and view signatures used by
 *      HupGift-compatible contracts, clients, and offchain indexers. Nothing about a round is
 *      fixed by the contract: the payout size, the claim window, the eligible list, and the copy
 *      shown to claimants are all per-round parameters, so the same deployment serves a 20-winner
 *      leaderboard reward on one chain and a completely different giveaway on the next.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🎁
 */
interface IHupGift {
    // --- SHARED STRUCTS ---

    /**
     * @notice One gift round: a funded pool paid out in equal shares to a fixed list of accounts.
     * @dev Value accounting is strictly per round — `funded - disbursed - withdrawn` is the only
     *      balance a round may pay from, so one round can never spend another's money even though
     *      they share a single contract balance.
     * @param amountPerClaim Native coin paid per successful claim, in wei of the chain's own coin.
     * @param funded Total native coin ever deposited into this round.
     * @param disbursed Total native coin ever paid out of this round to claimants.
     * @param withdrawn Total native coin the admin reclaimed after the round closed.
     * @param startAt Unix time claims open at; 0 means open from creation.
     * @param endAt Unix time claims close at; 0 means the round never expires.
     * @param claimCount Number of accounts that have been paid.
     * @param cancelled True once the admin has stopped the round.
     * @param label Short human title for the round, e.g. "Top 20 — August".
     * @param message Thank-you copy the client shows alongside the claim button.
     */
    struct Round {
        uint256 amountPerClaim;
        uint256 funded;
        uint256 disbursed;
        uint256 withdrawn;
        uint64 startAt;
        uint64 endAt;
        uint64 claimCount;
        bool cancelled;
        string label;
        string message;
    }

    /**
     * @notice Everything a client needs to render the claim button for one account, in one call.
     * @dev `open` folds together every reason a claim could be refused that is not specific to the
     *      account (cancelled, not started, expired, underfunded), so a client can drive its
     *      button from `open`, `eligible`, and `claimed` alone.
     * @param roundId The round this state describes; 0 when no round matched.
     * @param amountPerClaim Native coin this account would receive.
     * @param eligibleCount Accounts currently on the round's eligible list.
     * @param claimCount Accounts already paid.
     * @param balance Native coin the round still holds.
     * @param startAt Unix time claims open at; 0 when unbounded.
     * @param endAt Unix time claims close at; 0 when unbounded.
     * @param eligible True when this account is on the round's list.
     * @param claimed True when this account already took its share.
     * @param open True when the round is live and still funded for at least one more claim.
     * @param cancelled True when the admin stopped the round.
     * @param label The round's short title.
     * @param message The round's thank-you copy.
     */
    struct ClaimState {
        uint256 roundId;
        uint256 amountPerClaim;
        uint256 eligibleCount;
        uint256 claimCount;
        uint256 balance;
        uint64 startAt;
        uint64 endAt;
        bool eligible;
        bool claimed;
        bool open;
        bool cancelled;
        string label;
        string message;
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when a new round is opened. Funding it is a separate RoundFunded event,
    ///         even when the creating transaction carried the value.
    event RoundCreated(uint256 indexed roundId, uint256 amountPerClaim, uint64 startAt, uint64 endAt, string label);

    /// @notice Emitted on every deposit into a round, whoever paid it.
    event RoundFunded(uint256 indexed roundId, address indexed from, uint256 amount, uint256 totalFunded);

    /// @notice Emitted when the per-claim payout changes. Only possible before the first claim.
    event RoundAmountUpdated(uint256 indexed roundId, uint256 previousAmount, uint256 newAmount);

    /// @notice Emitted when the claim window moves.
    event RoundWindowUpdated(uint256 indexed roundId, uint64 startAt, uint64 endAt);

    /// @notice Emitted when the round's title or thank-you copy is edited.
    event RoundTextUpdated(uint256 indexed roundId, string label, string message);

    /// @notice Emitted when the admin stops a round. Cancellation is permanent.
    event RoundCancelled(uint256 indexed roundId);

    /// @notice Emitted once per account added to a round's eligible list. Re-adding an account
    ///         that is already eligible emits nothing, so indexers can treat this as a set union.
    event EligibilityGranted(uint256 indexed roundId, address indexed account);

    /// @notice Emitted once per account taken off a round's eligible list.
    event EligibilityRevoked(uint256 indexed roundId, address indexed account);

    /// @notice Emitted on every payout. `pushed` is false for a self-service claim and true when
    ///         the admin sent the gift on the recipient's behalf via distribute.
    event GiftClaimed(uint256 indexed roundId, address indexed recipient, uint256 amount, bool pushed);

    /// @notice Emitted when the admin reclaims a closed round's unclaimed remainder.
    event UnclaimedWithdrawn(uint256 indexed roundId, address indexed to, uint256 amount);

    /// @notice Emitted when native coin that belongs to no round is swept out.
    event StraySwept(address indexed to, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidAmount();
    error InvalidWindow();
    error EmptyList();
    error BatchTooLarge();
    error Unauthorized();
    error RoundNotFound();
    /// @notice The round was stopped by the admin and can never pay again.
    error RoundIsCancelled();
    error RoundNotStarted();
    error RoundEnded();
    /// @notice Unclaimed funds stay locked until the round is cancelled or its deadline passes.
    error RoundStillOpen();
    /// @notice The payout size is frozen once the first account has claimed.
    error RoundAlreadyStarted();
    error NotEligible();
    error AlreadyClaimed();
    /// @notice The round's own balance cannot cover one more claim; fund it first.
    error InsufficientRoundBalance();
    error NothingToSweep();
    error TransferFailed();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function ADMIN_ROLE() external view returns (bytes32);
    /// @notice Maximum addresses accepted per eligibility or distribution batch.
    function MAX_BATCH() external view returns (uint256);
    /// @notice Total rounds ever created; ids are 1..roundCount.
    function roundCount() external view returns (uint256);
    /// @notice Native coin held on behalf of rounds. Anything above this is stray, not gift money.
    function escrowed() external view returns (uint256);
    /// @notice True once an account has been paid for a round.
    function hasClaimed(uint256 roundId, address account) external view returns (bool);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Claims the caller's share of a round.
     * @dev Attributed to `msg.sender` and paid to `msg.sender` — there is no meta-transaction path
     *      and no session-key resolution, so no third party can ever redirect a gift (see the
     *      contract's @dev notes). Pays with a bare `call`, which is what keeps Universal Profiles
     *      and other smart contract accounts claimable.
     * @param _roundId The round to claim from.
     */
    function claim(uint256 _roundId) external;

    /**
     * @notice Adds native coin to a round's pool. Open to anyone — a round can be topped up by
     *         the treasury, a sponsor, or the community alike.
     * @param _roundId The round to fund.
     */
    function fundRound(uint256 _roundId) external payable;

    // --- VIEW FUNCTIONS ---

    /// @notice Returns a round in full.
    function getRound(uint256 _roundId) external view returns (Round memory);

    /**
     * @notice Returns everything needed to render the claim button for one account.
     * @param _roundId The round to inspect, or 0 to resolve the newest open round automatically.
     * @param _account The viewer's address; may be the zero address before a wallet connects.
     */
    function getClaimState(uint256 _roundId, address _account) external view returns (ClaimState memory);

    /// @notice True when an account is on a round's eligible list.
    function isEligible(uint256 _roundId, address _account) external view returns (bool);

    /// @notice Accounts currently on a round's eligible list.
    function eligibleCount(uint256 _roundId) external view returns (uint256);

    /// @notice Returns a page of a round's eligible list, for showing the winners.
    function getEligible(uint256 _roundId, uint256 _offset, uint256 _limit) external view returns (address[] memory);

    /// @notice Native coin a round still holds (funded - disbursed - withdrawn).
    function roundBalance(uint256 _roundId) external view returns (uint256);

    /// @notice How many more accounts the round can still pay at its current balance.
    function remainingClaims(uint256 _roundId) external view returns (uint256);

    /// @notice The newest round that is live and still funded, or 0 when none is.
    function activeRoundId() external view returns (uint256);

    // --- ADMIN CONFIGURATION ---

    /**
     * @notice Opens a round. Any native coin sent with the call becomes its initial funding.
     * @param _amountPerClaim Native coin each eligible account may claim.
     * @param _startAt Unix time claims open at, or 0 to open immediately.
     * @param _endAt Unix time claims close at, or 0 for no deadline. A round with no deadline can
     *        only be wound up by cancelling it.
     * @param _label Short title for the round.
     * @param _message Thank-you copy the client shows with the claim button.
     * @return roundId The id of the new round.
     */
    function createRound(
        uint256 _amountPerClaim,
        uint64 _startAt,
        uint64 _endAt,
        string calldata _label,
        string calldata _message
    ) external payable returns (uint256 roundId);

    /// @notice Adds accounts to a round's eligible list. Idempotent, so a re-run of the same
    ///         snapshot is harmless.
    function addEligible(uint256 _roundId, address[] calldata _accounts) external;

    /// @notice Removes accounts from a round's eligible list. Accounts that already claimed keep
    ///         their payout; removal only stops future claims.
    function removeEligible(uint256 _roundId, address[] calldata _accounts) external;

    /// @notice Changes the per-claim payout, only while no one has claimed yet.
    function setRoundAmount(uint256 _roundId, uint256 _amountPerClaim) external;

    /// @notice Moves the claim window, e.g. to extend a deadline.
    function setRoundWindow(uint256 _roundId, uint64 _startAt, uint64 _endAt) external;

    /// @notice Edits the round's title and thank-you copy.
    function setRoundText(uint256 _roundId, string calldata _label, string calldata _message) external;

    /// @notice Permanently stops a round.
    function cancelRound(uint256 _roundId) external;

    /**
     * @notice Sends the gift directly to eligible accounts that have not claimed, for recipients
     *         who cannot pay for a claim transaction themselves.
     * @dev Accounts that are ineligible or already paid are skipped rather than reverting, so one
     *      bad entry cannot fail an otherwise good batch.
     */
    function distribute(uint256 _roundId, address[] calldata _accounts) external;

    /// @notice Reclaims a closed round's unclaimed remainder. Only after cancellation or the
    ///         round's deadline — while a round is live its balance is out of admin reach.
    function withdrawUnclaimed(uint256 _roundId, address _to) external;

    /// @notice Sweeps native coin that belongs to no round (only reachable by force-send).
    function sweepStray(address _to) external;

    function pause() external;
    function unpause() external;
}
