// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IHupGift.sol";

/**
 * @title Hup Gift
 * @author Hup Labs
 * @notice Extension contract for handing out native-coin gifts to a chosen set of accounts. An
 *         admin opens a round, funds it, and adds the addresses that may claim; each of those
 *         addresses then pulls an equal share with one transaction. Rounds are independent, so a
 *         single deployment can run a leaderboard reward this month, a contributor thank-you the
 *         next, and something else entirely on another chain.
 * @dev Uses IHupGift for shared structs, events, errors, and view signatures. Deliberately holds
 *      no policy: who deserves a gift is decided offchain and pushed in as an address list, which
 *      is what keeps the contract reusable — the app's leaderboard is a database ranking that no
 *      contract could verify, and hardcoding a winner rule would freeze this deployment to one
 *      campaign. Payout size, claim window, and the copy shown to claimants are per-round
 *      parameters for the same reason; nothing about "how big" or "how many" lives in the code.
 *
 *      Value is accounted per round (`funded - disbursed - withdrawn`), so rounds sharing this
 *      contract's balance can never spend each other's money, and `escrowed` tracks the total owed
 *      to rounds so admin sweeps can only ever touch coin that belongs to no one.
 *
 *      Like HupOffers, and unlike its non-custodial siblings, this contract holds user-destined
 *      funds, so it takes no trusted forwarder and honors no burner session: `msg.sender` is the
 *      only identity it acts on, and a claim always pays the caller. An ERC2771 forwarder is by
 *      construction an address permitted to name any sender, and while it could not steal from a
 *      round here (payouts follow eligibility, not the caller's word), keeping it out means there
 *      is no configuration under which a gift lands anywhere but the winner's own wallet. For
 *      recipients with no gas at all, `distribute` lets the admin push the same payout instead.
 *
 *      Payouts use a bare `call`, never `transfer`, so Universal Profiles and other smart contract
 *      accounts with receive logic can claim. AccessControl for admin permissions, Pausable for
 *      emergency stops, ReentrancyGuard on every path that moves value.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🎁
 */
contract HupGift is IHupGift, Pausable, ReentrancyGuard, AccessControl {
    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Maximum addresses accepted per eligibility or distribution batch.
    uint256 public constant MAX_BATCH = 250;

    /// @notice Total rounds ever created; ids are 1..roundCount.
    uint256 public roundCount;

    /// @notice Native coin held on behalf of rounds. Anything the contract holds above this is
    ///         stray value that belongs to no round.
    uint256 public escrowed;

    /// @notice True once an account has been paid for a round.
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    /// @dev Maps roundId to its round. Private because the struct carries strings, which Solidity
    ///      omits from an auto-generated getter; getRound returns the whole thing instead.
    mapping(uint256 => Round) private _rounds;

    /// @dev The eligible list per round, kept as an array so clients can show the winners.
    mapping(uint256 => address[]) private _eligible;

    /// @dev One-based position of an account in `_eligible[roundId]`; 0 means not eligible. Doing
    ///      double duty as the eligibility flag keeps membership and enumeration from ever
    ///      disagreeing, which a separate bool mapping would eventually let them do.
    mapping(uint256 => mapping(address => uint256)) private _eligibleIndex;

    // --- MODIFIERS ---

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the gift contract.
     * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     */
    constructor(address _admin) {
        if (_admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    // --- CORE MUTATIVE LOGIC ---

    /**
     * @inheritdoc IHupGift
     */
    function claim(uint256 _roundId) external whenNotPaused nonReentrant {
        address recipient = msg.sender;
        Round storage round = _requireRound(_roundId);

        if (round.cancelled) revert RoundIsCancelled();
        if (round.startAt != 0 && block.timestamp < round.startAt) revert RoundNotStarted();
        if (round.endAt != 0 && block.timestamp > round.endAt) revert RoundEnded();
        if (_eligibleIndex[_roundId][recipient] == 0) revert NotEligible();
        if (hasClaimed[_roundId][recipient]) revert AlreadyClaimed();

        _payout(_roundId, round, recipient, false);
    }

    /**
     * @inheritdoc IHupGift
     */
    function fundRound(uint256 _roundId) external payable {
        Round storage round = _requireRound(_roundId);

        if (msg.value == 0) revert InvalidAmount();
        if (round.cancelled) revert RoundIsCancelled();

        _fund(_roundId, round, msg.value);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    /**
     * @inheritdoc IHupGift
     */
    function getRound(uint256 _roundId) external view returns (Round memory) {
        return _requireRound(_roundId);
    }

    /**
     * @inheritdoc IHupGift
     */
    function getClaimState(uint256 _roundId, address _account) external view returns (ClaimState memory state) {
        uint256 roundId = _roundId == 0 ? _activeRoundId() : _roundId;
        if (roundId == 0 || roundId > roundCount) return state;

        Round storage round = _rounds[roundId];

        state.roundId = roundId;
        state.amountPerClaim = round.amountPerClaim;
        state.eligibleCount = _eligible[roundId].length;
        state.claimCount = round.claimCount;
        state.balance = _roundBalance(round);
        state.startAt = round.startAt;
        state.endAt = round.endAt;
        state.eligible = _eligibleIndex[roundId][_account] != 0;
        state.claimed = hasClaimed[roundId][_account];
        state.open = _isOpen(round);
        state.cancelled = round.cancelled;
        state.label = round.label;
        state.message = round.message;
    }

    /**
     * @inheritdoc IHupGift
     */
    function isEligible(uint256 _roundId, address _account) external view returns (bool) {
        return _eligibleIndex[_roundId][_account] != 0;
    }

    /**
     * @inheritdoc IHupGift
     */
    function eligibleCount(uint256 _roundId) external view returns (uint256) {
        return _eligible[_roundId].length;
    }

    /**
     * @inheritdoc IHupGift
     */
    function getEligible(uint256 _roundId, uint256 _offset, uint256 _limit) external view returns (address[] memory page) {
        address[] storage list = _eligible[_roundId];
        uint256 total = list.length;

        if (_offset >= total || _limit == 0) return new address[](0);

        uint256 end = _offset + _limit;
        if (end > total) end = total;

        page = new address[](end - _offset);
        for (uint256 i = _offset; i < end; i++) {
            page[i - _offset] = list[i];
        }
    }

    /**
     * @inheritdoc IHupGift
     */
    function roundBalance(uint256 _roundId) external view returns (uint256) {
        return _roundBalance(_requireRound(_roundId));
    }

    /**
     * @inheritdoc IHupGift
     */
    function remainingClaims(uint256 _roundId) external view returns (uint256) {
        Round storage round = _requireRound(_roundId);
        if (round.amountPerClaim == 0) return 0;

        return _roundBalance(round) / round.amountPerClaim;
    }

    /**
     * @inheritdoc IHupGift
     */
    function activeRoundId() external view returns (uint256) {
        return _activeRoundId();
    }

    // --- ADMIN CONFIGURATION ---

    /**
     * @inheritdoc IHupGift
     */
    function createRound(
        uint256 _amountPerClaim,
        uint64 _startAt,
        uint64 _endAt,
        string calldata _label,
        string calldata _message
    ) external payable onlyAdmin returns (uint256 roundId) {
        if (_amountPerClaim == 0) revert InvalidAmount();
        if (_endAt != 0) {
            if (_endAt <= block.timestamp) revert InvalidWindow();
            if (_startAt != 0 && _endAt <= _startAt) revert InvalidWindow();
        }

        roundId = ++roundCount;

        Round storage round = _rounds[roundId];
        round.amountPerClaim = _amountPerClaim;
        round.startAt = _startAt;
        round.endAt = _endAt;
        round.label = _label;
        round.message = _message;

        emit RoundCreated(roundId, _amountPerClaim, _startAt, _endAt, _label);

        if (msg.value > 0) {
            _fund(roundId, round, msg.value);
        }
    }

    /**
     * @inheritdoc IHupGift
     */
    function addEligible(uint256 _roundId, address[] calldata _accounts) external onlyAdmin {
        _requireRound(_roundId);

        uint256 len = _accounts.length;
        if (len == 0) revert EmptyList();
        if (len > MAX_BATCH) revert BatchTooLarge();

        address[] storage list = _eligible[_roundId];

        for (uint256 i = 0; i < len; i++) {
            address account = _accounts[i];
            if (account == address(0)) revert InvalidAddress();
            // Already on the list: skip rather than revert, so re-submitting a snapshot that
            // partly landed (or overlaps the previous one) is safe to run again.
            if (_eligibleIndex[_roundId][account] != 0) continue;

            list.push(account);
            _eligibleIndex[_roundId][account] = list.length;

            emit EligibilityGranted(_roundId, account);
        }
    }

    /**
     * @inheritdoc IHupGift
     */
    function removeEligible(uint256 _roundId, address[] calldata _accounts) external onlyAdmin {
        _requireRound(_roundId);

        uint256 len = _accounts.length;
        if (len == 0) revert EmptyList();
        if (len > MAX_BATCH) revert BatchTooLarge();

        address[] storage list = _eligible[_roundId];

        for (uint256 i = 0; i < len; i++) {
            address account = _accounts[i];
            uint256 index = _eligibleIndex[_roundId][account];
            if (index == 0) continue;

            uint256 lastIndex = list.length;
            if (index != lastIndex) {
                address moved = list[lastIndex - 1];
                list[index - 1] = moved;
                _eligibleIndex[_roundId][moved] = index;
            }

            list.pop();
            _eligibleIndex[_roundId][account] = 0;

            emit EligibilityRevoked(_roundId, account);
        }
    }

    /**
     * @inheritdoc IHupGift
     */
    function setRoundAmount(uint256 _roundId, uint256 _amountPerClaim) external onlyAdmin {
        Round storage round = _requireRound(_roundId);

        if (_amountPerClaim == 0) revert InvalidAmount();
        if (round.cancelled) revert RoundIsCancelled();
        // Frozen after the first payout: whoever already claimed accepted the old figure, and
        // moving it afterwards would pay two winners of the same round differently.
        if (round.claimCount != 0) revert RoundAlreadyStarted();

        uint256 previous = round.amountPerClaim;
        round.amountPerClaim = _amountPerClaim;

        emit RoundAmountUpdated(_roundId, previous, _amountPerClaim);
    }

    /**
     * @inheritdoc IHupGift
     */
    function setRoundWindow(uint256 _roundId, uint64 _startAt, uint64 _endAt) external onlyAdmin {
        Round storage round = _requireRound(_roundId);

        if (round.cancelled) revert RoundIsCancelled();
        if (_endAt != 0 && _startAt != 0 && _endAt <= _startAt) revert InvalidWindow();

        round.startAt = _startAt;
        round.endAt = _endAt;

        emit RoundWindowUpdated(_roundId, _startAt, _endAt);
    }

    /**
     * @inheritdoc IHupGift
     */
    function setRoundText(uint256 _roundId, string calldata _label, string calldata _message) external onlyAdmin {
        Round storage round = _requireRound(_roundId);

        round.label = _label;
        round.message = _message;

        emit RoundTextUpdated(_roundId, _label, _message);
    }

    /**
     * @inheritdoc IHupGift
     */
    function cancelRound(uint256 _roundId) external onlyAdmin {
        Round storage round = _requireRound(_roundId);

        if (round.cancelled) revert RoundIsCancelled();
        round.cancelled = true;

        emit RoundCancelled(_roundId);
    }

    /**
     * @inheritdoc IHupGift
     */
    function distribute(uint256 _roundId, address[] calldata _accounts) external onlyAdmin nonReentrant {
        Round storage round = _requireRound(_roundId);

        if (round.cancelled) revert RoundIsCancelled();

        uint256 len = _accounts.length;
        if (len == 0) revert EmptyList();
        if (len > MAX_BATCH) revert BatchTooLarge();

        for (uint256 i = 0; i < len; i++) {
            address account = _accounts[i];
            if (_eligibleIndex[_roundId][account] == 0) continue;
            if (hasClaimed[_roundId][account]) continue;

            // A recipient that rejects the transfer fails the whole batch rather than being
            // silently marked paid; the admin re-runs the batch without that address.
            _payout(_roundId, round, account, true);
        }
    }

    /**
     * @inheritdoc IHupGift
     */
    function withdrawUnclaimed(uint256 _roundId, address _to) external onlyAdmin nonReentrant {
        Round storage round = _requireRound(_roundId);

        if (_to == address(0)) revert InvalidAddress();
        // Live rounds are untouchable: an admin can only reclaim what a closed round left over,
        // so funds cannot be pulled out from under someone about to claim.
        if (!round.cancelled && (round.endAt == 0 || block.timestamp <= round.endAt)) revert RoundStillOpen();

        uint256 amount = _roundBalance(round);
        if (amount == 0) revert InvalidAmount();

        round.withdrawn += amount;
        escrowed -= amount;

        _sendNative(_to, amount);

        emit UnclaimedWithdrawn(_roundId, _to, amount);
    }

    /**
     * @inheritdoc IHupGift
     */
    function sweepStray(address _to) external onlyAdmin nonReentrant {
        if (_to == address(0)) revert InvalidAddress();

        // The contract has no receive/fallback, so this can only ever be force-sent value. It is
        // owed to no round, and without this it would be permanently stranded.
        uint256 stray = address(this).balance - escrowed;
        if (stray == 0) revert NothingToSweep();

        _sendNative(_to, stray);

        emit StraySwept(_to, stray);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    // --- INTERNAL LOGIC ---

    /**
     * @dev Marks an account paid and sends its share. Callers own the eligibility and
     *      already-claimed checks; this owns the funding check and the accounting.
     */
    function _payout(uint256 _roundId, Round storage _round, address _recipient, bool _pushed) internal {
        uint256 amount = _round.amountPerClaim;
        if (_roundBalance(_round) < amount) revert InsufficientRoundBalance();

        hasClaimed[_roundId][_recipient] = true;
        _round.disbursed += amount;
        _round.claimCount += 1;
        escrowed -= amount;

        _sendNative(_recipient, amount);

        emit GiftClaimed(_roundId, _recipient, amount, _pushed);
    }

    /**
     * @dev Books a deposit against a round.
     */
    function _fund(uint256 _roundId, Round storage _round, uint256 _amount) internal {
        _round.funded += _amount;
        escrowed += _amount;

        emit RoundFunded(_roundId, msg.sender, _amount, _round.funded);
    }

    /**
     * @dev Native coin a round may still pay from.
     */
    function _roundBalance(Round storage _round) internal view returns (uint256) {
        return _round.funded - _round.disbursed - _round.withdrawn;
    }

    /**
     * @dev True when a round would accept a claim right now from an eligible, unpaid account.
     */
    function _isOpen(Round storage _round) internal view returns (bool) {
        if (_round.cancelled) return false;
        if (_round.amountPerClaim == 0) return false;
        if (_round.startAt != 0 && block.timestamp < _round.startAt) return false;
        if (_round.endAt != 0 && block.timestamp > _round.endAt) return false;

        return _roundBalance(_round) >= _round.amountPerClaim;
    }

    /**
     * @dev Newest open round, so a client only needs this contract's address to find the round it
     *      should show. Walks backwards over rounds, which are admin-created and few.
     */
    function _activeRoundId() internal view returns (uint256) {
        for (uint256 id = roundCount; id > 0; id--) {
            if (_isOpen(_rounds[id])) return id;
        }

        return 0;
    }

    /**
     * @dev Resolves a round id to storage, rejecting ids that were never created.
     */
    function _requireRound(uint256 _roundId) internal view returns (Round storage) {
        if (_roundId == 0 || _roundId > roundCount) revert RoundNotFound();

        return _rounds[_roundId];
    }

    /**
     * @dev Sends native value, reverting on failure. A bare call, not transfer — the 2300 gas
     *      stipend would break Universal Profiles and other accounts with receive logic.
     */
    function _sendNative(address _to, uint256 _amount) internal {
        (bool success, ) = _to.call{value: _amount}("");
        if (!success) revert TransferFailed();
    }
}
