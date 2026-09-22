// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IHupTasks.sol";
import "./ILSP7Minimal.sol";

/// @dev The two ERC-8004 registry calls HupTasks makes, as deployed by the 8004 team.
interface IERC8004Identity {
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);

    function getAgentWallet(uint256 agentId) external view returns (address);
}

interface IERC8004Reputation {
    function getIdentityRegistry() external view returns (address);

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

/**
 * @title Hup Tasks
 * @author Hup Labs
 * @notice Micro bounties attached to Hup posts. A poster escrows slots x reward; workers submit
 *         by replying; each approved reply is paid one slot, straight to its author. After the
 *         deadline the poster takes back whatever was not paid.
 * @dev Uses IHupTasks for shared structs, events, errors and view signatures. AccessControl for
 *      admin and moderator roles, Pausable for emergencies, ReentrancyGuard on every value path.
 *      No receive(): a bare transfer could not be attributed to any task.
 *
 *      Admin can move the fee ledger and nothing else. A pause stops new tasks and approvals,
 *      never cancel or reclaim.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🧰
 */
contract HupTasks is IHupTasks, Pausable, ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_TASK_FEE_BPS = 1_000;
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 90 days;
    uint256 public constant MAX_SLOTS = 1_000;
    uint256 public constant MAX_BATCH_SIZE = 50;
    uint256 public constant MAX_CATEGORY_BYTES = 32;
    uint256 public constant MAX_REVEAL_KEY_BYTES = 64;
    uint256 public constant MAX_RATING = 100;

    /// @notice ERC-8004 tag1 for every rating HupTasks gives; tag2 is the task's category.
    string public constant FEEDBACK_TAG = "starred";

    uint256 private constant IDENTITY_GAS = 50_000;
    uint256 private constant FEEDBACK_GAS = 400_000;
    // Gas estimation would otherwise find a limit where the capped calls run dry and are caught
    uint256 private constant FEEDBACK_GAS_FLOOR = ((FEEDBACK_GAS + 2 * IDENTITY_GAS) * 64) / 63 + 20_000;

    IHup public immutable override hupContract;

    mapping(uint256 => Task) private _tasks;

    mapping(uint256 => bytes) public override taskPubKeys;

    mapping(uint256 => mapping(uint256 => bool)) private _paid;

    /// @notice Fees earned per payment token (address(0) for native); escrow is never counted here.
    mapping(address => uint256) public override collectedFees;

    uint256 public override taskFeeBps;

    address public override reputationRegistry;

    address public override identityRegistry;

    // --- MODIFIERS ---

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    modifier onlyModerator() {
        if (!hasRole(MODERATOR_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @param _hupAddress The chain's Hup Core contract.
     * @param _reputationRegistry The chain's ERC-8004 Reputation Registry, or address(0) for none.
     * @param _admin Granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     */
    constructor(address _hupAddress, address _reputationRegistry, address _admin) {
        if (_hupAddress == address(0) || _admin == address(0)) revert InvalidAddress();

        hupContract = IHup(_hupAddress);
        _setReputationRegistry(_reputationRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    // --- MUTATIVE LOGIC ---

    function postTask(
        uint256 _postId,
        string calldata _category,
        address _paymentToken,
        bool _isLsp7,
        uint256 _rewardPerSlot,
        uint32 _slots,
        uint64 _deadline,
        bytes calldata _taskPubKey
    ) external payable override whenNotPaused nonReentrant returns (uint256 escrowed) {
        if (_tasks[_postId].poster != address(0)) revert TaskExists();
        if (_rewardPerSlot == 0) revert InvalidReward();
        if (_slots == 0 || _slots > MAX_SLOTS) revert InvalidSlots();
        if (_deadline <= block.timestamp) revert InvalidWindow();
        uint256 duration = _deadline - block.timestamp;
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidWindow();

        uint256 categoryLength = bytes(_category).length;
        if (categoryLength == 0 || categoryLength > MAX_CATEGORY_BYTES) revert InvalidCategory();

        uint256 pubKeyLength = _taskPubKey.length;
        if (pubKeyLength != 0 && pubKeyLength != 33 && pubKeyLength != 65) revert InvalidPubKey();

        (IHup.ContentView memory post, bool found) = _readContent(_postId);
        if (!found || post.cType != IHup.ContentType.Post || post.isDeleted) revert NotAPost();
        if (post.creator != msg.sender) revert NotPostCreator();
        if (!post.allowedComments) revert CommentsDisabled();

        // Safe: setTaskFeeBps caps the rate at ABSOLUTE_MAX_TASK_FEE_BPS
        uint16 feeBps = uint16(taskFeeBps);
        uint256 feePerSlot = (_rewardPerSlot * feeBps) / FEE_DENOMINATOR;
        bool isLsp7 = _paymentToken != address(0) && _isLsp7;

        Task storage task = _tasks[_postId];
        task.poster = msg.sender;
        task.deadline = _deadline;
        task.slots = _slots;
        task.paymentToken = _paymentToken;
        task.feeBps = feeBps;
        task.isLsp7 = isLsp7;
        task.isSealed = pubKeyLength != 0;
        task.createdAt = uint64(block.timestamp);
        task.rewardPerSlot = _rewardPerSlot;
        task.feePerSlot = feePerSlot;
        task.category = _category;

        if (pubKeyLength != 0) taskPubKeys[_postId] = _taskPubKey;

        escrowed = uint256(_slots) * (_rewardPerSlot + feePerSlot);
        _collect(_paymentToken, isLsp7, msg.sender, escrowed);

        emit TaskPosted(_postId, msg.sender, _paymentToken, isLsp7, _rewardPerSlot, _slots, _deadline, feeBps, _category, _taskPubKey);
    }

    function addSlots(uint256 _postId, uint32 _extra) external payable override whenNotPaused nonReentrant {
        Task storage task = _requireOpenTaskOf(_postId);
        if (_extra == 0 || uint256(task.slots) + _extra > MAX_SLOTS) revert InvalidSlots();

        task.slots += _extra;

        _collect(task.paymentToken, task.isLsp7, msg.sender, uint256(_extra) * (task.rewardPerSlot + task.feePerSlot));

        emit SlotsAdded(_postId, _extra, task.slots);
    }

    function extendDeadline(uint256 _postId, uint64 _deadline) external override whenNotPaused {
        Task storage task = _requireOpenTaskOf(_postId);
        if (_deadline <= task.deadline || _deadline > uint256(task.createdAt) + MAX_DURATION) revert InvalidWindow();

        task.deadline = _deadline;

        emit DeadlineExtended(_postId, _deadline);
    }

    function approve(uint256 _postId, Approval[] calldata _approvals) external override whenNotPaused nonReentrant {
        Task storage task = _requireOpenTaskOf(_postId);

        uint256 count = _approvals.length;
        if (count == 0 || count > MAX_BATCH_SIZE) revert InvalidBatch();
        if (uint256(task.paidSlots) + count > task.slots) revert NoSlotsLeft();

        address poster = task.poster;
        address token = task.paymentToken;
        bool isLsp7 = task.isLsp7;
        bool isSealed = task.isSealed;
        uint256 reward = task.rewardPerSlot;
        uint256 fee = task.feePerSlot;

        for (uint256 i = 0; i < count; i++) {
            Approval calldata approval = _approvals[i];
            uint256 replyId = approval.replyId;

            if (_paid[_postId][replyId]) revert AlreadyPaid(replyId);
            if (approval.rating > MAX_RATING) revert InvalidRating();

            uint256 revealLength = approval.revealKey.length;
            if (revealLength != 0) {
                if (!isSealed) revert RevealNotAllowed();
                if (revealLength > MAX_REVEAL_KEY_BYTES) revert RevealKeyTooLarge();
            }

            (IHup.ContentView memory reply, bool found) = _readContent(replyId);
            if (!found || reply.cType != IHup.ContentType.Comment || reply.parentId != _postId || reply.isDeleted) {
                revert NotASubmission(replyId);
            }

            address worker = reply.creator;
            if (worker == poster) revert SelfApproval(replyId);

            _paid[_postId][replyId] = true;
            task.paidSlots += 1;
            if (fee != 0) collectedFees[token] += fee;

            _payout(token, isLsp7, worker, reward);

            bool feedbackGiven = approval.rating != 0 && _giveFeedback(worker, approval.agentId, approval.rating, task.category, _postId, replyId);

            emit SlotPaid(_postId, replyId, worker, reward, fee, approval.agentId, approval.rating, feedbackGiven, approval.revealKey);
        }
    }

    // Deliberately not whenNotPaused: the poster's exit must never depend on the admin
    function cancel(uint256 _postId) external override nonReentrant {
        Task storage task = _requireOpenTaskOf(_postId);

        (IHup.ContentView memory post, bool found) = _readContent(_postId);
        if (!found || task.paidSlots != 0 || post.commentCount != 0) revert CancelLocked();

        emit TaskCancelled(_postId, task.poster, _close(task));
    }

    // Deliberately not whenNotPaused: the poster's exit must never depend on the admin
    function reclaim(uint256 _postId) external override nonReentrant {
        Task storage task = _requireOpenTaskOf(_postId);
        if (block.timestamp < task.deadline) revert TaskStillOpen();

        emit TaskReclaimed(_postId, task.poster, _close(task));
    }

    function setHidden(uint256 _postId, bool _hidden) external override onlyModerator {
        Task storage task = _tasks[_postId];
        if (task.poster == address(0)) revert TaskNotFound();

        task.hidden = _hidden;

        emit TaskHiddenSet(_postId, _hidden, msg.sender);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getTask(uint256 _postId) external view override returns (Task memory) {
        return _tasks[_postId];
    }

    function isPaid(uint256 _postId, uint256 _replyId) external view override returns (bool) {
        return _paid[_postId][_replyId];
    }

    function escrowOf(uint256 _postId) external view override returns (uint256) {
        Task storage task = _tasks[_postId];
        if (task.poster == address(0) || task.closed) return 0;
        return _unpaidEscrow(task);
    }

    // --- ADMIN CONFIGURATION ---

    function pause() external override onlyAdmin {
        _pause();
    }

    function unpause() external override onlyAdmin {
        _unpause();
    }

    function setTaskFeeBps(uint256 _taskFeeBps) external override onlyAdmin {
        if (_taskFeeBps > ABSOLUTE_MAX_TASK_FEE_BPS) revert InvalidFeeBps();

        uint256 oldValue = taskFeeBps;
        taskFeeBps = _taskFeeBps;

        emit TaskFeeUpdated(oldValue, _taskFeeBps);
    }

    function setReputationRegistry(address _reputationRegistry) external override onlyAdmin {
        _setReputationRegistry(_reputationRegistry);
    }

    // Only the fee ledger, never the balance — the rest is escrow
    function withdrawFees(address _token, bool _isLsp7, address _receiver) external override onlyAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 amount = collectedFees[_token];
        if (amount == 0) revert NothingToWithdraw();

        collectedFees[_token] = 0;

        _payout(_token, _token != address(0) && _isLsp7, _receiver, amount);

        emit FeesWithdrawn(_token, _receiver, amount);
    }

    // --- ROLE MANAGEMENT ---

    function grantRole(bytes32 role, address account) public override {
        if (!hasRole(getRoleAdmin(role), msg.sender)) revert Unauthorized();

        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override {
        if (!hasRole(getRoleAdmin(role), msg.sender)) revert Unauthorized();

        _revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address callerConfirmation) public override {
        if (callerConfirmation != msg.sender) revert Unauthorized();

        _revokeRole(role, callerConfirmation);
    }

    // --- INTERNAL HELPERS ---

    function _requireOpenTaskOf(uint256 _postId) private view returns (Task storage task) {
        task = _tasks[_postId];
        if (task.poster == address(0)) revert TaskNotFound();
        if (msg.sender != task.poster) revert NotPoster();
        if (task.closed) revert TaskIsClosed();
    }

    function _unpaidEscrow(Task storage task) private view returns (uint256) {
        return uint256(task.slots - task.paidSlots) * (task.rewardPerSlot + task.feePerSlot);
    }

    function _close(Task storage task) private returns (uint256 refund) {
        refund = _unpaidEscrow(task);
        task.closed = true;

        _payout(task.paymentToken, task.isLsp7, task.poster, refund);
    }

    /// @dev Hup Core reverts on an unknown id; that is reported as not found rather than bubbled.
    function _readContent(uint256 _id) private view returns (IHup.ContentView memory content, bool found) {
        try hupContract.getContent(_id, address(0)) returns (IHup.ContentView memory result) {
            return (result, true);
        } catch {
            return (content, false);
        }
    }

    /**
     * @dev Rates the worker's agent when the worker controls it. A registry that refuses or fails
     *      never blocks the payment it is attached to.
     */
    function _giveFeedback(
        address _worker,
        uint256 _agentId,
        uint8 _rating,
        string storage _category,
        uint256 _postId,
        uint256 _replyId
    ) private returns (bool) {
        address reputation = reputationRegistry;
        if (reputation == address(0)) return false;
        if (gasleft() < FEEDBACK_GAS_FLOOR) revert InsufficientGasForFeedback();
        if (!_controlsAgent(_worker, _agentId)) return false;

        bytes32 feedbackHash = keccak256(abi.encode(block.chainid, address(this), _postId, _replyId));

        try IERC8004Reputation(reputation).giveFeedback{gas: FEEDBACK_GAS}(
            _agentId,
            int128(uint128(_rating)),
            0,
            FEEDBACK_TAG,
            _category,
            "",
            "",
            feedbackHash
        ) {
            return true;
        } catch {
            return false;
        }
    }

    function _controlsAgent(address _worker, uint256 _agentId) private view returns (bool) {
        IERC8004Identity identity = IERC8004Identity(identityRegistry);

        // Reverts for an agent id that does not exist
        try identity.isAuthorizedOrOwner{gas: IDENTITY_GAS}(_worker, _agentId) returns (bool authorized) {
            if (authorized) return true;
        } catch {
            return false;
        }

        try identity.getAgentWallet{gas: IDENTITY_GAS}(_agentId) returns (address wallet) {
            return wallet == _worker;
        } catch {
            return false;
        }
    }

    function _setReputationRegistry(address _reputationRegistry) private {
        address identity = address(0);
        if (_reputationRegistry != address(0)) {
            identity = IERC8004Reputation(_reputationRegistry).getIdentityRegistry();
            if (identity == address(0)) revert InvalidAddress();
        }

        reputationRegistry = _reputationRegistry;
        identityRegistry = identity;

        emit ReputationRegistryUpdated(_reputationRegistry, identity);
    }

    /// @dev ERC20 needs an allowance, LSP7 an authorizeOperator(this, amount) from the payer.
    function _collect(address _token, bool _isLsp7, address _from, uint256 _amount) private {
        if (_token == address(0)) {
            if (msg.value != _amount) revert InsufficientPayment(msg.value, _amount);
            return;
        }
        if (msg.value != 0) revert UnexpectedNativePayment();

        uint256 balanceBefore = IERC20(_token).balanceOf(address(this));

        if (_isLsp7) {
            ILSP7Minimal(_token).transfer(_from, address(this), _amount, true, "");
        } else {
            IERC20(_token).safeTransferFrom(_from, address(this), _amount);
        }

        // A fee-on-transfer token would let one task's payouts spend another task's escrow
        if (IERC20(_token).balanceOf(address(this)) - balanceBefore != _amount) revert UnsupportedToken();
    }

    /// @dev `.call` rather than `transfer`, so a Universal Profile's LSP1 hook has gas to run.
    function _payout(address _token, bool _isLsp7, address _receiver, uint256 _amount) private {
        if (_amount == 0) return;

        if (_token == address(0)) {
            (bool success, ) = _receiver.call{value: _amount}("");
            if (!success) revert TransferFailed();
        } else if (_isLsp7) {
            ILSP7Minimal(_token).transfer(address(this), _receiver, _amount, true, "");
        } else {
            IERC20(_token).safeTransfer(_receiver, _amount);
        }
    }
}
