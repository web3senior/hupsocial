// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupPredict
 * @author Hup Labs
 * @notice Shared interface for Hup Predict — friendly parimutuel prediction markets. Anyone
 *         creates a multi-outcome market with named judges; bettors stake native coins, ERC20,
 *         or LSP7 tokens into per-outcome pools; when a judge resolves, winners split the whole
 *         pot pro-rata minus a protocol fee. If no judge resolves within the resolve window, the
 *         market becomes refundable by anyone and every bettor reclaims their full stake.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used
 *      by HupPredict-compatible contracts, clients, and offchain indexers. The metadata field is
 *      an IPFS CID pointing to a JSON document with the shape
 *      { title, description, outcomes: [{ label, emoji, color }], image } where `outcomes` must
 *      contain exactly `outcomeCount` entries — outcome ids are zero-based positions in that
 *      array. Only pool math and lifecycle live onchain; display data lives in the metadata JSON.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🎯
 */
interface IHupPredict {
    // --- SHARED STRUCTS ---

    /// @dev Lifecycle of a market. Closed markets await resolution; Refunding markets (canceled,
    ///      judge timeout, or resolved with an empty winning pool) pay every stake back in full.
    enum MarketState {
        Open,
        Closed,
        Resolved,
        Refunding
    }

    /// @dev Defines the structure for a single market. Only fields the contract or indexer must
    ///      trust and settle on live onchain — display data lives in the metadata JSON on IPFS.
    struct Market {
        address creator; // Address of the market creator, set once at creation
        address token; // Stake token: address(0) for native, otherwise an ERC20/LSP7 address
        bool isTokenLsp7; // True when `token` is an LSP7 (LUKSO) asset rather than ERC20
        uint64 bettingDeadline; // After this unix UTC time no new bets are accepted
        uint64 closedAt; // When betting was explicitly closed; 0 while still open
        uint8 outcomeCount; // Number of outcomes; ids are 0..outcomeCount-1
        uint8 winningOutcome; // Winning outcome id, meaningful only when state == Resolved
        MarketState state; // Current lifecycle state
        uint16 feeBps; // Protocol fee snapshotted at creation, taken only from resolved pots
        bool hidden; // Moderator flag — indexers and clients suppress the market, funds unaffected
        uint256 totalPool; // Sum of all stakes across all outcomes
        string metadata; // IPFS CID of the market JSON (length-capped)
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when a creator opens a new market.
    /// @dev `judges` is the full initial judge list (any listed judge can close/resolve/cancel).
    ///      `feeBps` is snapshotted so later admin fee changes never affect existing markets.
    event MarketCreated(uint256 indexed marketId, address indexed creator, address token, bool isTokenLsp7, uint64 bettingDeadline, uint8 outcomeCount, uint16 feeBps, address[] judges, string metadata);

    /// @notice Emitted for every stake. `outcomePool` and `totalPool` are the post-bet totals so
    ///         indexers can maintain pool aggregates without replaying history.
    event BetPlaced(uint256 indexed marketId, address indexed bettor, uint8 outcome, uint256 amount, uint256 outcomePool, uint256 totalPool);

    /// @notice Emitted when a judge or the creator closes betting early (before the deadline the
    ///         market can otherwise only close by the deadline passing).
    event BettingClosed(uint256 indexed marketId, address indexed by, uint64 closedAt);

    /// @notice Emitted when a judge resolves the market. `feeAmount` is the protocol cut accrued;
    ///         the remaining pot is claimable pro-rata by winning-outcome bettors.
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, address indexed judge, uint256 feeAmount);

    /// @notice Emitted when the creator or a judge cancels the market; all stakes become refundable.
    event MarketCanceled(uint256 indexed marketId, address indexed by);

    /// @notice Emitted when the market flips to Refunding — either permissionlessly after the
    ///         resolve window lapsed, or automatically when resolution found an empty winning pool.
    event RefundsEnabled(uint256 indexed marketId, address indexed by);

    /// @notice Emitted when a winning bettor claims their share of a resolved pot.
    event WinningsClaimed(uint256 indexed marketId, address indexed account, uint256 amount);

    /// @notice Emitted when a bettor reclaims their full stake from a Refunding market.
    event RefundClaimed(uint256 indexed marketId, address indexed account, uint256 amount);

    /// @notice Emitted when the creator adds a judge (only possible before the first bet).
    event JudgeAdded(uint256 indexed marketId, address indexed judge);

    /// @notice Emitted when the creator removes a judge (only possible before the first bet).
    event JudgeRemoved(uint256 indexed marketId, address indexed judge);

    /// @notice Emitted when a moderator hides or unhides a market. Funds are unaffected.
    event MarketHiddenSet(uint256 indexed marketId, bool hidden, address indexed moderator);

    /// @notice Emitted when the Hup Core contract reference is updated.
    event HupContractUpdated(address oldValue, address newValue);

    /// @notice Emitted when the protocol fee for newly created markets is updated.
    event PredictFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the resolve window is updated.
    event ResolveWindowUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the maximum market metadata byte length is updated.
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when a trusted forwarder's status is updated.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    /// @notice Emitted when accrued protocol fees are withdrawn by an admin.
    event FeesWithdrawn(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
    event UnattributedDeposit(address indexed from, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidDeadline();
    error InvalidOutcomeCount();
    error InvalidOutcome();
    error InvalidAmount();
    error InvalidJudges();
    error InvalidFeeBps();
    error InvalidResolveWindow();
    error InvalidMetadata();
    error MetadataTooLarge(uint256 length, uint256 maxLength);
    error InvalidMetadataLimit();
    error MarketNotFound();
    error NotCreator();
    error NotJudge();
    /// @notice The market is not in the state this action requires.
    error MarketNotOpen();
    error MarketNotResolvable();
    error MarketNotRefundable();
    /// @notice The market was hidden by a moderator; new bets are suppressed, claims still work.
    error MarketInactive();
    error BettingDeadlinePassed();
    /// @notice Judges can only change while the pool is empty — bettors bet under a fixed panel.
    error MarketHasBets();
    error InsufficientPayment(uint256 sent, uint256 expected);
    error UnexpectedNativePayment();
    error NothingToClaim();
    error AlreadyClaimed();
    error TransferFailed();
    error Unauthorized();
    error SessionExpired();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function hupContract() external view returns (IHup);
    function nextMarketId() external view returns (uint256);
    function ADMIN_ROLE() external view returns (bytes32);
    function MODERATOR_ROLE() external view returns (bytes32);
    function trustedForwarders(address forwarder) external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);
    function predictFeeBps() external view returns (uint256);
    function resolveWindow() external view returns (uint256);
    function maxMetadataBytes() external view returns (uint256);
    function accruedFees(address token) external view returns (uint256);
    function FEE_DENOMINATOR() external view returns (uint256);
    function ABSOLUTE_MAX_FEE_BPS() external view returns (uint256);
    function MIN_RESOLVE_WINDOW() external view returns (uint256);
    function MAX_RESOLVE_WINDOW() external view returns (uint256);
    function MAX_OUTCOME_COUNT() external view returns (uint256);
    function MAX_JUDGES() external view returns (uint256);
    function ABSOLUTE_MAX_METADATA_BYTES() external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Creates a new parimutuel market. Free of charge — the protocol fee is taken only
     *         from resolved pots.
     * @dev The current predictFeeBps is snapshotted into the market. Judges gain the power to
     *      close, resolve, and cancel this market; the list is frozen at the first bet.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _token Stake token: address(0) for the chain's native coin, otherwise ERC20/LSP7.
     * @param _isTokenLsp7 True when `_token` is an LSP7 asset. Ignored for native markets.
     * @param _bettingDeadline Unix UTC seconds after which no new bets are accepted; must be in
     *        the future. Also anchors the refund fallback: if judges never act, refunds unlock at
     *        `_bettingDeadline + resolveWindow`.
     * @param _outcomeCount Number of outcomes (2..MAX_OUTCOME_COUNT). Labels live in metadata.
     * @param _judges Judge panel. An empty array defaults to the creator as sole judge.
     * @param _metadata IPFS CID of the market JSON. See the interface @dev for the expected shape.
     * @return marketId The id assigned to the new market.
     */
    function createMarket(
        address _owner,
        address _token,
        bool _isTokenLsp7,
        uint64 _bettingDeadline,
        uint8 _outcomeCount,
        address[] calldata _judges,
        string calldata _metadata
    ) external returns (uint256 marketId);

    /**
     * @notice Stakes on an outcome. Betting on an outcome you already backed tops up your stake.
     * @dev Native markets require msg.value == _amount; token markets require msg.value == 0 and
     *      a prior approval (ERC20 `approve` or LSP7 `authorizeOperator`) for at least _amount.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _marketId The id of the market to bet on.
     * @param _outcome Zero-based outcome id to back.
     * @param _amount Stake amount in the market's token (or native wei).
     */
    function placeBet(address _owner, uint256 _marketId, uint8 _outcome, uint256 _amount) external payable;

    /**
     * @notice Closes betting early. After the deadline this is unnecessary — bets are already
     *         rejected and resolution/refund timing anchors on the deadline itself.
     * @dev Only the creator or a judge can execute this. Starts the resolve window from now.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _marketId The id of the market to close.
     */
    function closeBetting(address _owner, uint256 _marketId) external;

    /**
     * @notice Resolves the market to a winning outcome and accrues the protocol fee.
     * @dev Only a judge can execute this, either after closeBetting or, once the betting
     *      deadline has passed, straight from the Open state. If nobody staked the winning
     *      outcome the market flips to Refunding instead so no funds are ever stranded.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _marketId The id of the market to resolve.
     * @param _winningOutcome Zero-based id of the outcome that occurred.
     */
    function resolve(address _owner, uint256 _marketId, uint8 _winningOutcome) external;

    /**
     * @notice Cancels the market and makes every stake refundable in full.
     * @dev Only the creator or a judge can execute this, any time before resolution.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _marketId The id of the market to cancel.
     */
    function cancelMarket(address _owner, uint256 _marketId) external;

    /**
     * @notice Flips an abandoned market to Refunding. Callable by anyone once the resolve window
     *         has lapsed — from closedAt when betting was closed early, otherwise from the
     *         betting deadline.
     * @param _marketId The id of the market.
     */
    function enableRefunds(uint256 _marketId) external;

    /**
     * @notice Claims what the caller is owed: their pro-rata share of a resolved pot, or their
     *         full stake back from a Refunding market. Claims never expire.
     * @dev Payout always goes to the resolved primary wallet, never to a burner key.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _marketId The id of the market to claim from.
     */
    function claim(address _owner, uint256 _marketId) external;

    /**
     * @notice Adds a judge to the market's panel.
     * @dev Only the creator can execute this, and only while the pool is empty — the panel
     *      bettors saw when staking is the panel that resolves.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _marketId The id of the market.
     * @param _judge The judge address to add.
     */
    function addJudge(address _owner, uint256 _marketId, address _judge) external;

    /**
     * @notice Removes a judge from the market's panel. At least one judge must remain.
     * @dev Only the creator can execute this, and only while the pool is empty.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _marketId The id of the market.
     * @param _judge The judge address to remove.
     */
    function removeJudge(address _owner, uint256 _marketId, address _judge) external;

    /**
     * @notice Hides or unhides a market. Hidden markets are suppressed by indexers and clients
     *         and reject new bets; resolution, refunds, and claims keep working.
     * @dev Callable by MODERATOR_ROLE or ADMIN_ROLE (direct caller only, no meta-transactions).
     * @param _marketId The id of the market.
     * @param _hidden True to hide, false to restore.
     */
    function setHidden(uint256 _marketId, bool _hidden) external;

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Retrieves a single market.
     * @param _marketId The id of the market.
     */
    function getMarket(uint256 _marketId) external view returns (Market memory);

    /**
     * @notice Returns the market's judge panel.
     * @param _marketId The id of the market.
     */
    function getJudges(uint256 _marketId) external view returns (address[] memory);

    /**
     * @notice Returns whether an address is a judge of the market.
     */
    function isJudge(uint256 _marketId, address _account) external view returns (bool);

    /**
     * @notice Returns the per-outcome pools of a market, indexed by outcome id.
     * @param _marketId The id of the market.
     */
    function getOutcomePools(uint256 _marketId) external view returns (uint256[] memory pools);

    /**
     * @notice Returns an account's position in a market.
     * @param _marketId The id of the market.
     * @param _account The primary wallet to inspect.
     * @return stakesPerOutcome The account's stake on each outcome, indexed by outcome id.
     * @return totalStake The account's total stake across all outcomes.
     * @return hasClaimed True once the account has claimed winnings or a refund.
     */
    function getPosition(uint256 _marketId, address _account)
        external
        view
        returns (uint256[] memory stakesPerOutcome, uint256 totalStake, bool hasClaimed);

    /**
     * @notice Returns what `claim` would currently pay the account: a winning share when the
     *         market is Resolved, the full stake when Refunding, zero otherwise or once claimed.
     * @param _marketId The id of the market.
     * @param _account The primary wallet to inspect.
     */
    function claimableAmount(uint256 _marketId, address _account) external view returns (uint256);

    /**
     * @notice Returns the unix UTC time after which `enableRefunds` succeeds, or 0 when the
     *         market can no longer lapse (already Resolved or Refunding).
     * @param _marketId The id of the market.
     */
    function refundEligibleAt(uint256 _marketId) external view returns (uint256);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setHupContract(address _hupAddress) external;
    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    function setPredictFeeBps(uint256 _feeBps) external;
    function setResolveWindow(uint256 _resolveWindow) external;
    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external;
    function withdrawFees(address _token, address _receiver) external;
}
