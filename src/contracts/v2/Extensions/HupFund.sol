// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IHupFund.sol";

/**
 * @title Hup Fund
 * @author Hup Labs
 * @notice Extension contract powering fundraising campaigns on Hup. A creator opens a campaign
 *         with a goal in the chain's native coin, a deadline and a payout address; anyone backs
 *         it while it is open. The contract holds every backing. When backing ends the creator
 *         withdraws the pot, minus a fee frozen at creation, to the payout address — or, at any
 *         point before withdrawing, switches the campaign to refund mode and every backer pulls
 *         their own money back in full.
 * @dev Uses IHupFund for shared structs, events, errors, and view signatures. AccessControl for
 *      admin/moderator permissions, Pausable for emergency controls, and ReentrancyGuard around
 *      every value transfer. No `receive`: a plain transfer to this contract would be a backing
 *      nobody can attribute, so it is refused outright.
 *
 *      Deliberately no ERC2771 forwarder and no Hup Core session-key resolution: every function
 *      acts for `msg.sender` alone. A relayer or a delegated key standing in for the wallet that
 *      owns the money is exactly the trust a contract holding other people's coin must not ask.
 *
 *      The goal is a public promise the card measures progress against, never a condition. An
 *      all-or-nothing rule was considered and rejected; instead the creator decides, and the one
 *      thing the contract enforces is that the decision is honest: a pot is either withdrawn
 *      or refunded, never both, and a pot left unclaimed past CLAIM_WINDOW can be switched to
 *      refunds by anyone, so a creator who disappears cannot strand it.
 *
 *      Fees are taken once, at withdrawal, at the rate frozen into the campaign when it was
 *      created, and land in a separate ledger. Admin can move that ledger and nothing else;
 *      a pause blocks backing and withdrawal but never a refund claim.
 *
 *      Moderator `hidden` is a display flag only. It suppresses a campaign in the indexer and
 *      in clients and never touches the money.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🎯
 */
contract HupFund is IHupFund, Pausable, ReentrancyGuard, AccessControl {
    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_FUND_FEE_BPS = 1_000;
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 180 days;
    uint256 public constant CLAIM_WINDOW = 90 days;
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2_048;
    uint256 public constant ABSOLUTE_MAX_MEMO_BYTES = 2_048;

    /// @notice Maps campaign id to its campaign
    mapping(uint256 => Campaign) private _campaigns;

    /// @notice The id the next campaign will receive; ids start at 1 so 0 means "not found"
    uint256 public override nextCampaignId = 1;

    /// @notice Maps campaign id to backer to the wei currently held for them — what a refund
    ///         returns. Zeroed by claimRefund; a withdrawal leaves it as the record of who gave.
    mapping(uint256 => mapping(address => uint256)) public override backedBy;

    /// @notice Platform fees taken at withdrawals and not yet collected. Kept apart from the
    ///         campaign pots so the admin's withdrawFees can never reach money that is still
    ///         somebody's to refund.
    uint256 public override feesAccrued;

    /// @notice Fee rate frozen into campaigns created from now on, in basis points (100 = 1%)
    uint256 public override fundFeeBps = 0;

    /// @notice The maximum allowed byte length for a campaign's metadata field
    uint256 public override maxMetadataBytes = 256;

    /// @notice The maximum allowed byte length for a backing's memo
    uint256 public override maxMemoBytes = 256;

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
     * @notice Initializes the fund contract.
     * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     */
    constructor(address _admin) {
        if (_admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    // --- MUTATIVE LOGIC ---

    function createCampaign(
        string calldata _metadata,
        uint256 _goal,
        uint64 _closesAt,
        address _payout
    ) external override whenNotPaused returns (uint256 campaignId) {
        if (_goal == 0) revert InvalidGoal();
        if (_closesAt <= block.timestamp) revert InvalidWindow();
        uint256 duration = _closesAt - block.timestamp;
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidWindow();
        _requireValidMetadata(_metadata);

        address payout = _payout == address(0) ? msg.sender : _payout;
        uint16 feeBps = uint16(fundFeeBps);

        campaignId = nextCampaignId++;

        Campaign storage campaign = _campaigns[campaignId];
        campaign.creator = msg.sender;
        campaign.payout = payout;
        campaign.goal = _goal;
        campaign.closesAt = _closesAt;
        campaign.createdAt = uint64(block.timestamp);
        campaign.feeBps = feeBps;
        campaign.metadata = _metadata;

        emit CampaignCreated(campaignId, msg.sender, payout, _goal, _closesAt, feeBps, _metadata);
    }

    function back(uint256 _campaignId, bytes calldata _memo) external payable override whenNotPaused {
        Campaign storage campaign = _campaigns[_campaignId];
        if (campaign.creator == address(0)) revert CampaignNotFound();
        if (campaign.refunding) revert RefundsActive();
        if (campaign.closedAt != 0 || block.timestamp >= campaign.closesAt) revert CampaignClosed();
        if (msg.value == 0) revert InvalidAmount();
        if (_memo.length > maxMemoBytes) revert MemoTooLarge(_memo.length, maxMemoBytes);
        if (msg.sender == campaign.creator) revert SelfBack();

        if (backedBy[_campaignId][msg.sender] == 0) campaign.backerCount += 1;
        backedBy[_campaignId][msg.sender] += msg.value;
        campaign.raised += msg.value;

        emit Backed(_campaignId, msg.sender, msg.value, campaign.raised, campaign.backerCount, _memo);
    }

    function withdraw(uint256 _campaignId) external override whenNotPaused nonReentrant {
        Campaign storage campaign = _campaigns[_campaignId];
        if (campaign.creator == address(0)) revert CampaignNotFound();
        if (msg.sender != campaign.creator) revert NotCreator();
        if (campaign.refunding) revert RefundsActive();
        if (campaign.withdrawnAt != 0) revert AlreadyWithdrawn();
        if (campaign.closedAt == 0 && block.timestamp < campaign.closesAt) revert CampaignStillOpen();
        if (campaign.raised == 0) revert NothingToWithdraw();

        // Refunds are impossible before the switch and the switch is impossible after this, so
        // the pot is the whole of what was raised
        uint256 pot = campaign.raised;
        uint256 feeAmount = (pot * campaign.feeBps) / FEE_DENOMINATOR;
        uint256 amount = pot - feeAmount;

        // Accounting before the push, so a receiving hook re-entering finds the pot already
        // taken (and nonReentrant rejects it outright)
        campaign.withdrawnAt = uint64(block.timestamp);
        feesAccrued += feeAmount;

        (bool success, ) = campaign.payout.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Withdrawn(_campaignId, campaign.payout, amount, feeAmount);
    }

    function enableRefunds(uint256 _campaignId) external override {
        Campaign storage campaign = _campaigns[_campaignId];
        if (campaign.creator == address(0)) revert CampaignNotFound();
        if (campaign.withdrawnAt != 0) revert AlreadyWithdrawn();
        if (campaign.refunding) revert RefundsActive();

        // The creator may switch at any time. Anyone else only once the pot has sat unclaimed
        // past the window — measured from when backing actually ended, so an early close
        // starts the clock too.
        if (msg.sender != campaign.creator) {
            uint256 endedAt = campaign.closedAt != 0 ? campaign.closedAt : campaign.closesAt;
            if (block.timestamp < endedAt + CLAIM_WINDOW) revert Unauthorized();
        }

        campaign.refunding = true;
        if (campaign.closedAt == 0 && block.timestamp < campaign.closesAt) {
            campaign.closedAt = uint64(block.timestamp);
        }

        emit RefundsEnabled(_campaignId, msg.sender);
    }

    // Deliberately not whenNotPaused: an exit for backers must never depend on the admin
    function claimRefund(uint256 _campaignId) external override nonReentrant {
        Campaign storage campaign = _campaigns[_campaignId];
        if (campaign.creator == address(0)) revert CampaignNotFound();
        if (!campaign.refunding) revert NotRefunding();

        uint256 amount = backedBy[_campaignId][msg.sender];
        if (amount == 0) revert NothingToRefund();

        backedBy[_campaignId][msg.sender] = 0;
        campaign.refunded += amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Refunded(_campaignId, msg.sender, amount);
    }

    function updateCampaignMetadata(uint256 _campaignId, string calldata _metadata) external override whenNotPaused {
        Campaign storage campaign = _requireOpenAndOwned(_campaignId);
        _requireValidMetadata(_metadata);

        campaign.metadata = _metadata;

        emit CampaignMetadataUpdated(_campaignId, _metadata);
    }

    function setPayout(uint256 _campaignId, address _payout) external override whenNotPaused {
        Campaign storage campaign = _campaigns[_campaignId];
        if (campaign.creator == address(0)) revert CampaignNotFound();
        if (msg.sender != campaign.creator) revert NotCreator();
        if (campaign.withdrawnAt != 0) revert AlreadyWithdrawn();
        if (campaign.refunding) revert RefundsActive();

        address oldValue = campaign.payout;
        address payout = _payout == address(0) ? campaign.creator : _payout;
        campaign.payout = payout;

        emit PayoutUpdated(_campaignId, oldValue, payout);
    }

    function closeCampaign(uint256 _campaignId) external override whenNotPaused {
        Campaign storage campaign = _requireOpenAndOwned(_campaignId);

        campaign.closedAt = uint64(block.timestamp);

        emit CampaignClosedEarly(_campaignId, campaign.creator, uint64(block.timestamp), campaign.raised);
    }

    function setHidden(uint256 _campaignId, bool _hidden) external override onlyModerator {
        Campaign storage campaign = _campaigns[_campaignId];
        if (campaign.creator == address(0)) revert CampaignNotFound();

        campaign.hidden = _hidden;

        emit CampaignHiddenSet(_campaignId, _hidden, msg.sender);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getCampaign(uint256 _campaignId) external view override returns (Campaign memory) {
        return _campaigns[_campaignId];
    }

    function isOpen(uint256 _campaignId) external view override returns (bool) {
        Campaign storage campaign = _campaigns[_campaignId];
        if (campaign.creator == address(0)) return false;
        return !campaign.refunding && campaign.closedAt == 0 && block.timestamp < campaign.closesAt;
    }

    function canWithdraw(uint256 _campaignId) external view override returns (bool) {
        Campaign storage campaign = _campaigns[_campaignId];
        if (campaign.creator == address(0) || campaign.refunding || campaign.withdrawnAt != 0 || campaign.raised == 0) return false;
        return campaign.closedAt != 0 || block.timestamp >= campaign.closesAt;
    }

    // --- ADMIN CONFIGURATION ---

    function pause() external override onlyAdmin {
        _pause();
    }

    function unpause() external override onlyAdmin {
        _unpause();
    }

    function setFundFeeBps(uint256 _fundFeeBps) external override onlyAdmin {
        if (_fundFeeBps > ABSOLUTE_MAX_FUND_FEE_BPS) revert InvalidFeeBps();

        uint256 oldValue = fundFeeBps;
        fundFeeBps = _fundFeeBps;

        emit FundFeeUpdated(oldValue, _fundFeeBps);
    }

    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external override onlyAdmin {
        if (_maxMetadataBytes == 0 || _maxMetadataBytes > ABSOLUTE_MAX_METADATA_BYTES) revert InvalidMetadataLimit();

        uint256 oldValue = maxMetadataBytes;
        maxMetadataBytes = _maxMetadataBytes;

        emit MaxMetadataBytesUpdated(oldValue, _maxMetadataBytes);
    }

    function setMaxMemoBytes(uint256 _maxMemoBytes) external override onlyAdmin {
        if (_maxMemoBytes == 0 || _maxMemoBytes > ABSOLUTE_MAX_MEMO_BYTES) revert InvalidMemoLimit();

        uint256 oldValue = maxMemoBytes;
        maxMemoBytes = _maxMemoBytes;

        emit MaxMemoBytesUpdated(oldValue, _maxMemoBytes);
    }

    // Only the fee ledger, never address(this).balance — the rest is held for campaigns
    function withdrawFees(address payable _receiver) external override onlyAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 amount = feesAccrued;
        if (amount == 0) revert NothingToWithdraw();

        feesAccrued = 0;

        (bool success, ) = _receiver.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit FeesWithdrawn(_receiver, amount);
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

    /**
     * @dev Shared gate for every creator-only change that needs backing still open: the
     *      campaign exists, is open, and the caller is its creator.
     */
    function _requireOpenAndOwned(uint256 _campaignId) internal view returns (Campaign storage campaign) {
        campaign = _campaigns[_campaignId];
        if (campaign.creator == address(0)) revert CampaignNotFound();
        if (msg.sender != campaign.creator) revert NotCreator();
        if (campaign.refunding || campaign.closedAt != 0 || block.timestamp >= campaign.closesAt) revert CampaignClosed();
    }

    /**
     * @dev Reverts unless the metadata CID is present and inside the configured ceiling.
     */
    function _requireValidMetadata(string calldata _metadata) internal view {
        uint256 length = bytes(_metadata).length;
        if (length == 0) revert InvalidMetadata();
        if (length > maxMetadataBytes) revert MetadataTooLarge(length, maxMetadataBytes);
    }
}
