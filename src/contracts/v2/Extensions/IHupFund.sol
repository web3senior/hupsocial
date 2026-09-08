// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

/**
 * @title IHupFund
 * @author Hup Labs
 * @notice Shared interface for Hup Fund — onchain fundraising campaigns attached to posts.
 *         Anyone opens a campaign with a goal in the chain's native coin, a deadline and a
 *         payout address; anyone backs it with a native payment while it is open. Backings are
 *         held by the contract. Once the campaign ends the creator withdraws the pot to the
 *         payout address, or — at any point before withdrawing — switches the campaign to
 *         refund mode, after which every backer pulls their own money back in full. The goal
 *         is a public promise the card measures progress against, never a condition: whether
 *         to withdraw or refund is the creator's call, not the contract's.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used
 *      by HupFund-compatible contracts, clients, and offchain indexers. The metadata field is an
 *      IPFS CID pointing to a JSON document with the shape
 *      { title, description, image, faq: [{ question, answer }] }. Only the money and the
 *      window live onchain; display data lives in the metadata JSON.
 *
 *      Every function acts for `msg.sender` and nobody else: no meta-transaction forwarder and
 *      no session-key resolution, deliberately, because a contract holding other people's money
 *      must not let a relayer or a delegated key stand in for the wallet that owns the funds.
 *
 *      `raised` and `backerCount` ride on every Backed event so an indexer can keep a campaign
 *      current from the log alone; both only ever grow. Refunds are announced per backer and
 *      never reduce `raised` — they are subtracted in `refunded`.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🎯
 */
interface IHupFund {
    // --- SHARED STRUCTS ---

    /// @dev Defines the structure for a single campaign. Only fields the contract or an indexer
    ///      must trust live onchain — the title, description and FAQ live in the metadata JSON.
    struct Campaign {
        address creator; // Address of the campaign creator, set once at creation
        uint64 closesAt; // After this unix UTC time no backing is accepted
        uint32 backerCount; // Distinct wallets that have backed at least once
        uint16 feeBps; // Platform fee frozen at creation, taken once at withdrawal
        bool hidden; // Moderator flag — indexers and clients suppress the campaign, money unaffected
        bool refunding; // Once set, backing and withdrawal are over and backers pull refunds
        address payout; // Where the pot is withdrawn to; the creator unless re-pointed
        uint64 closedAt; // When backing ended early (creator close or refund switch); 0 while running its full window
        uint64 createdAt; // Block time the campaign was opened
        uint64 withdrawnAt; // When the creator took the pot; 0 while it is still held
        uint256 goal; // Target in wei of the chain's native coin; a promise, never enforced
        uint256 raised; // Gross wei backed so far; never decreases
        uint256 refunded; // Wei handed back to backers so far
        string metadata; // IPFS CID of the campaign JSON (length-capped)
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when a creator opens a new campaign. `createdAt` is the block's own
    ///         timestamp, which every indexer already has from the block header.
    event CampaignCreated(uint256 indexed campaignId, address indexed creator, address payout, uint256 goal, uint64 closesAt, uint16 feeBps, string metadata);

    /// @notice Emitted on every backing. Carries the running totals so an indexer can keep a
    ///         campaign current from the log alone — both only ever grow.
    /// @dev `memo` is never stored — it exists only in this event, for an optional short
    ///      message from the backer, without adding storage cost to every backing.
    event Backed(uint256 indexed campaignId, address indexed backer, uint256 amount, uint256 raised, uint32 backerCount, bytes memo);

    /// @notice Emitted when the creator takes the pot after the campaign has ended.
    /// @dev `amount` is what reached the payout address; `feeAmount` stayed with the platform.
    event Withdrawn(uint256 indexed campaignId, address indexed payout, uint256 amount, uint256 feeAmount);

    /// @notice Emitted when a campaign switches to refund mode — by its creator, or by anyone
    ///         once the creator has left the pot unclaimed past the claim window.
    event RefundsEnabled(uint256 indexed campaignId, address indexed by);

    /// @notice Emitted when a backer pulls their money back out of a refunding campaign.
    event Refunded(uint256 indexed campaignId, address indexed backer, uint256 amount);

    /// @notice Emitted when a creator replaces the campaign's metadata document.
    event CampaignMetadataUpdated(uint256 indexed campaignId, string metadata);

    /// @notice Emitted when a creator re-points where the pot is withdrawn to.
    event PayoutUpdated(uint256 indexed campaignId, address oldValue, address newValue);

    /// @notice Emitted when the creator ends backing before the campaign's window is up.
    event CampaignClosedEarly(uint256 indexed campaignId, address indexed creator, uint64 closedAt, uint256 raised);

    /// @notice Emitted when a moderator hides or unhides a campaign.
    event CampaignHiddenSet(uint256 indexed campaignId, bool hidden, address indexed moderator);

    /// @notice Emitted when the percentage platform fee (in basis points) is updated. Applies
    ///         to campaigns created afterwards only — each campaign freezes its own rate.
    event FundFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the admin changes the metadata length ceiling.
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the maximum backing memo byte length is updated.
    event MaxMemoBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when accrued platform fees are withdrawn by an admin.
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidGoal();
    error InvalidWindow();
    error InvalidMetadata();
    error MetadataTooLarge(uint256 length, uint256 maxLength);
    error InvalidMetadataLimit();
    error MemoTooLarge(uint256 length, uint256 maxLength);
    error InvalidMemoLimit();
    error InvalidFeeBps();
    error InvalidAmount();
    error CampaignNotFound();
    error NotCreator();
    error CampaignClosed();
    error CampaignStillOpen();
    /// @notice Backing your own campaign is rejected so the raised figure can't be self-inflated.
    error SelfBack();
    error AlreadyWithdrawn();
    error RefundsActive();
    error NotRefunding();
    error NothingToWithdraw();
    error NothingToRefund();
    error TransferFailed();
    error Unauthorized();

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Opens a campaign for the caller.
     * @param _metadata IPFS CID of the campaign JSON carrying the title, description and FAQ.
     * @param _goal Target amount in wei of the chain's native coin.
     * @param _closesAt Unix UTC time backing closes.
     * @param _payout Where the pot is withdrawn to; address(0) means the creator.
     * @return campaignId The id assigned to the new campaign.
     */
    function createCampaign(string calldata _metadata, uint256 _goal, uint64 _closesAt, address _payout) external returns (uint256 campaignId);

    /**
     * @notice Backs a campaign with the native coin sent along. The contract holds it until the
     *         creator withdraws the pot or the campaign switches to refunds.
     * @param _campaignId The campaign being backed.
     * @param _memo Optional opaque data emitted with Backed (e.g. a short message). Never
     *        stored — capped at maxMemoBytes since it's only ever calldata + a log.
     */
    function back(uint256 _campaignId, bytes calldata _memo) external payable;

    /**
     * @notice Takes the pot to the payout address, minus the campaign's frozen fee. Creator
     *         only, once backing has ended — by deadline or by an early close — and only while
     *         the campaign is not refunding. A payout address that cannot receive makes this
     *         revert until the creator re-points it with setPayout.
     * @param _campaignId The campaign to withdraw.
     */
    function withdraw(uint256 _campaignId) external;

    /**
     * @notice Switches a campaign to refund mode: backing ends if it was still open, the pot
     *         can no longer be withdrawn, and every backer may pull their own money back in
     *         full. One way — there is no undo. The creator may do this at any time before
     *         withdrawing; anyone may do it once the pot has sat unclaimed for CLAIM_WINDOW
     *         after backing ended, so a vanished creator cannot strand the money forever.
     * @param _campaignId The campaign to switch.
     */
    function enableRefunds(uint256 _campaignId) external;

    /**
     * @notice Pulls the caller's whole backing back out of a refunding campaign. Pull rather
     *         than push, so one unreachable wallet blocks nobody else, and never blocked by a
     *         pause — backers can always leave.
     * @param _campaignId The campaign to refund from.
     */
    function claimRefund(uint256 _campaignId) external;

    /**
     * @notice Replaces a campaign's metadata document. Creator only, while backing is open.
     * @param _campaignId The campaign to update.
     * @param _metadata Replacement IPFS CID.
     */
    function updateCampaignMetadata(uint256 _campaignId, string calldata _metadata) external;

    /**
     * @notice Re-points where the pot is withdrawn to. Creator only, any time before the pot
     *         has been withdrawn and while the campaign is not refunding — so an unreceivable
     *         payout can be fixed after backing has ended.
     * @param _campaignId The campaign to re-point.
     * @param _payout Replacement payout address; address(0) means the creator.
     */
    function setPayout(uint256 _campaignId, address _payout) external;

    /**
     * @notice Ends backing early. Creator only. The pot becomes withdrawable at once.
     * @param _campaignId The campaign to close.
     */
    function closeCampaign(uint256 _campaignId) external;

    /**
     * @notice Hides or unhides a campaign. Moderator only; money is unaffected.
     * @param _campaignId The campaign to flag.
     * @param _hidden True to hide.
     */
    function setHidden(uint256 _campaignId, bool _hidden) external;

    // --- VIEW FUNCTIONS ---

    /// @notice Contract version string.
    function version() external pure returns (string memory);

    /// @notice Full campaign record, including the metadata CID.
    function getCampaign(uint256 _campaignId) external view returns (Campaign memory);

    /// @notice Wei an account currently has held in a campaign — what a refund would return.
    ///         Zero once refunded, and untouched by a withdrawal.
    function backedBy(uint256 _campaignId, address _account) external view returns (uint256);

    /// @notice True while the campaign accepts backings.
    function isOpen(uint256 _campaignId) external view returns (bool);

    /// @notice True when the creator could withdraw the pot right now.
    function canWithdraw(uint256 _campaignId) external view returns (bool);

    /// @notice The id the next campaign will receive; ids start at 1, so 0 means "not found".
    function nextCampaignId() external view returns (uint256);

    /// @notice Fee rate frozen into campaigns created from now on, in basis points (100 = 1%).
    function fundFeeBps() external view returns (uint256);

    /// @notice Platform fees taken at withdrawals and not yet collected. The only balance an
    ///         admin can ever move — campaign pots are out of reach.
    function feesAccrued() external view returns (uint256);

    function FEE_DENOMINATOR() external view returns (uint256);

    function ABSOLUTE_MAX_FUND_FEE_BPS() external view returns (uint256);

    /// @notice How long after backing ends a creator has to withdraw before anyone may switch
    ///         the campaign to refunds.
    function CLAIM_WINDOW() external view returns (uint256);

    /// @notice The maximum allowed byte length for a campaign's metadata field.
    function maxMetadataBytes() external view returns (uint256);

    /// @notice The maximum allowed byte length for a backing's memo.
    function maxMemoBytes() external view returns (uint256);

    // --- ADMIN CONFIGURATION ---

    function pause() external;

    function unpause() external;

    function setFundFeeBps(uint256 _fundFeeBps) external;

    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external;

    function setMaxMemoBytes(uint256 _maxMemoBytes) external;

    function withdrawFees(address payable _receiver) external;
}
