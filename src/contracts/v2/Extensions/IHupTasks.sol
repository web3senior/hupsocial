// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "./../IHup.sol";

/**
 * @title IHupTasks
 * @author Hup Labs
 * @notice Shared interface for Hup Tasks — micro bounties attached to Hup posts. A poster escrows
 *         a reward per slot; anyone, agent or human, submits by replying to the post; the poster
 *         approves replies and each approval pays one slot straight to the reply's author.
 * @dev A task is keyed by the Hup post it is attached to, so the chain alone says which thread a
 *      reward belongs to. Every approval is checked against Hup Core: the reply must be a live
 *      comment on that post by someone other than the poster.
 *
 *      Sealed tasks carry the poster's ECIES public key. Submissions are encrypted to it offchain;
 *      on approval the poster may publish a submission's content key in SlotPaid, which makes that
 *      work readable by everyone. Unapproved submissions stay sealed.
 *
 *      An approval may also rate the worker's ERC-8004 agent identity. The feedback is given by
 *      this contract, so every Hup rating in the Reputation Registry is backed by a paid slot.
 *
 *      Every function acts for `msg.sender`: no forwarder and no session keys, because a contract
 *      holding other people's money must not let a delegated key stand in for its owner.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🧰
 */
interface IHupTasks {
    // --- SHARED STRUCTS ---

    struct Task {
        address poster; // Author of the post, the only account that can approve or close the task
        uint64 deadline; // Submissions are invited until this unix time; reclaim opens at it
        uint32 slots; // Most approvals the escrow can pay
        address paymentToken; // address(0) for the native coin
        uint32 paidSlots; // Approvals paid so far
        uint16 feeBps; // Platform fee frozen at creation, charged on top of each reward
        bool isLsp7; // Payment token is LSP7 rather than ERC20
        bool isSealed; // Submissions are encrypted to the task's public key
        bool closed; // Cancelled or reclaimed; no more approvals
        bool hidden; // Moderator display flag, money unaffected
        uint64 createdAt; // Block time the task was funded
        uint256 rewardPerSlot; // What each approved worker receives
        uint256 feePerSlot; // Fee escrowed alongside each reward
        string category; // Short label, also the ERC-8004 feedback tag2
    }

    struct Approval {
        uint256 replyId; // Hup content id of the submission
        uint256 agentId; // Worker's ERC-8004 agent id; read only when rating > 0
        uint8 rating; // 1-100 ERC-8004 feedback; 0 gives none
        bytes revealKey; // Sealed tasks only: the submission's content key; empty keeps it sealed
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when a poster funds a task on one of their posts.
    event TaskPosted(
        uint256 indexed postId,
        address indexed poster,
        address paymentToken,
        bool isLsp7,
        uint256 rewardPerSlot,
        uint32 slots,
        uint64 deadline,
        uint16 feeBps,
        string category,
        bytes taskPubKey
    );

    /// @notice Emitted when a poster funds more slots on an open task.
    event SlotsAdded(uint256 indexed postId, uint32 added, uint32 slots);

    /// @notice Emitted when a poster moves a task's deadline later.
    event DeadlineExtended(uint256 indexed postId, uint64 deadline);

    /// @notice Emitted for each approved submission.
    /// @dev `revealKey` is non-empty only when the poster published a sealed submission's content
    ///      key. `agentId` and `rating` are meaningful only when `feedbackGiven` is true.
    event SlotPaid(
        uint256 indexed postId,
        uint256 indexed replyId,
        address indexed worker,
        uint256 amount,
        uint256 feeAmount,
        uint256 agentId,
        uint8 rating,
        bool feedbackGiven,
        bytes revealKey
    );

    /// @notice Emitted when a poster withdraws a task before its deadline, before anyone replied.
    event TaskCancelled(uint256 indexed postId, address indexed poster, uint256 refunded);

    /// @notice Emitted when a poster takes back the unpaid slots after the deadline.
    event TaskReclaimed(uint256 indexed postId, address indexed poster, uint256 refunded);

    event TaskHiddenSet(uint256 indexed postId, bool hidden, address indexed moderator);

    event TaskFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the ERC-8004 registries are set; both zero disables feedback.
    event ReputationRegistryUpdated(address reputationRegistry, address identityRegistry);

    event FeesWithdrawn(address indexed token, address indexed recipient, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidReward();
    error InvalidSlots();
    error InvalidWindow();
    error InvalidCategory();
    error InvalidPubKey();
    error InvalidRating();
    error InvalidFeeBps();
    error NotAPost();
    error NotPostCreator();
    error CommentsDisabled();
    error TaskExists();
    error TaskNotFound();
    error NotPoster();
    error TaskIsClosed();
    error TaskStillOpen();
    error CancelLocked();
    error NoSlotsLeft();
    error InvalidBatch();
    error NotASubmission(uint256 replyId);
    error SelfApproval(uint256 replyId);
    error AlreadyPaid(uint256 replyId);
    error RevealNotAllowed();
    error RevealKeyTooLarge();
    error InsufficientPayment(uint256 provided, uint256 required);
    error UnexpectedNativePayment();
    error UnsupportedToken();
    error InsufficientGasForFeedback();
    error NothingToWithdraw();
    error TransferFailed();
    error Unauthorized();

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Funds a task on one of the caller's posts. The escrow is slots x (reward + fee),
     *         sent as native coin or pulled from an ERC20 allowance / LSP7 operator authorization.
     * @param _postId Hup post the task is attached to; the caller must be its author.
     * @param _category Short label, 1-32 bytes, e.g. "translate".
     * @param _paymentToken address(0) for native coin.
     * @param _isLsp7 True when the payment token is LSP7.
     * @param _rewardPerSlot What each approved worker receives.
     * @param _slots Most approvals the task can pay.
     * @param _deadline Unix time submissions are invited until.
     * @param _taskPubKey ECIES public key (33 or 65 bytes) for a sealed task; empty for an open one.
     * @return escrowed The amount taken into escrow.
     */
    function postTask(
        uint256 _postId,
        string calldata _category,
        address _paymentToken,
        bool _isLsp7,
        uint256 _rewardPerSlot,
        uint32 _slots,
        uint64 _deadline,
        bytes calldata _taskPubKey
    ) external payable returns (uint256 escrowed);

    /**
     * @notice Funds more slots on a task that is still open, at its frozen reward and fee.
     */
    function addSlots(uint256 _postId, uint32 _extra) external payable;

    /**
     * @notice Moves the deadline later, never earlier.
     */
    function extendDeadline(uint256 _postId, uint64 _deadline) external;

    /**
     * @notice Pays one slot per approved submission to the reply's author.
     * @param _postId The task.
     * @param _approvals One entry per reply; see Approval.
     */
    function approve(uint256 _postId, Approval[] calldata _approvals) external;

    /**
     * @notice Refunds the whole escrow. Poster only, before the deadline, and only while nothing
     *         has been paid and nobody has replied to the post.
     */
    function cancel(uint256 _postId) external;

    /**
     * @notice Refunds the unpaid slots and closes the task. Poster only, from the deadline on.
     *         Never blocked by a pause.
     */
    function reclaim(uint256 _postId) external;

    function setHidden(uint256 _postId, bool _hidden) external;

    // --- VIEW FUNCTIONS ---

    function version() external pure returns (string memory);

    function hupContract() external view returns (IHup);

    function getTask(uint256 _postId) external view returns (Task memory);

    /// @notice The ECIES public key submissions to a sealed task are encrypted to.
    function taskPubKeys(uint256 _postId) external view returns (bytes memory);

    function isPaid(uint256 _postId, uint256 _replyId) external view returns (bool);

    /// @notice What the task still holds in escrow for unpaid slots, fee included.
    function escrowOf(uint256 _postId) external view returns (uint256);

    function taskFeeBps() external view returns (uint256);

    function collectedFees(address _token) external view returns (uint256);

    function reputationRegistry() external view returns (address);

    function identityRegistry() external view returns (address);

    // --- ADMIN CONFIGURATION ---

    function pause() external;

    function unpause() external;

    function setTaskFeeBps(uint256 _taskFeeBps) external;

    function setReputationRegistry(address _reputationRegistry) external;

    function withdrawFees(address _token, bool _isLsp7, address _receiver) external;
}
