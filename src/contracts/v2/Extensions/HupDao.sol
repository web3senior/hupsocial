// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IHupDao.sol";
import "./ILSP7Minimal.sol";

/// @dev The slice of IVotes / ERC-6372 that VotesToken mode reads. ERC20Votes and LSP7Votes
///      both expose it.
interface IVotesMinimal {
  function getVotes(address account) external view returns (uint256);
  function getPastVotes(address account, uint256 timepoint) external view returns (uint256);
  function getPastTotalSupply(uint256 timepoint) external view returns (uint256);
}

/**
 * @title Hup DAO
 * @author Hup Labs
 * @notice Standalone DAOs on Hup. Anyone opens a DAO, picks where its voting power comes from
 *         (staked tokens, an existing votes token, or one vote per member), and its members
 *         vote on proposals — directly, or through someone they delegate to.
 * @dev v1 is signalling only: a proposal that passes records a decision, it executes nothing.
 *      Nothing here is tied to HupCommunity or Hup Core.
 *
 *      Every proposal reads voting power at a snapshot one tick before it was created, so
 *      power acquired after a proposal exists — a fresh stake, a delegation, a membership, or
 *      tokens moved to a second wallet — can never vote on it. Staked and Members modes keep
 *      their own OpenZeppelin checkpoints on a timestamp clock; VotesToken mode reads the
 *      token's checkpoints on the token's own clock (ERC-6372, block number when absent).
 *
 *      Wallet compatibility: identity is always _msgSender() — an EOA, a Universal Profile
 *      calling through ERC725X, or either relayed by a trusted ERC2771 forwarder. Nothing reads
 *      tx.origin. delegateBySig verifies through SignatureChecker, so ERC-1271 signers (UPs)
 *      can delegate gaslessly too. Unstaking pays LSP7 with force=true and ERC20 through
 *      SafeERC20, and is never paused, so a stake can always be withdrawn.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🏛️
 */
contract HupDao is IHupDao, Pausable, AccessControl, ReentrancyGuard, Nonces, EIP712, ERC2771Context {
  using Checkpoints for Checkpoints.Trace208;
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeERC20 for IERC20;

  // --- Storage ---

  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
  bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
  bytes32 public constant DELEGATION_TYPEHASH =
    keccak256("Delegation(uint256 daoId,address delegator,address delegatee,uint256 nonce,uint256 expiry)");

  uint8 public constant MIN_OPTION_COUNT = 2;
  uint8 public constant MAX_OPTION_COUNT = 8;
  uint8 public constant BINARY_TALLY_SLOTS = 3;
  uint32 public constant MIN_VOTING_PERIOD = 1 hours;
  uint32 public constant MAX_VOTING_PERIOD = 90 days;
  uint32 public constant MAX_VOTING_DELAY = 30 days;
  uint16 public constant MAX_BPS = 10_000;
  uint256 public constant MAX_BATCH_SIZE = 100;
  uint256 public constant MAX_PAGE_SIZE = 100;

  /// @notice Metadata is an IPFS CID, never a JSON blob — 128 bytes fits every CID format.
  uint256 public constant MAX_METADATA_BYTES = 128;
  uint256 public constant MAX_REASON_BYTES = 1_024;

  /// @notice Gas ceiling for probing a token at DAO creation, so a hostile address can only
  ///         fail the probe, never gas-bomb it.
  uint256 public constant TOKEN_PROBE_GAS_CAP = 100_000;

  /// @notice Ids start at 1 so 0 reads as "not found".
  uint256 public override nextDaoId = 1;
  uint256 public override nextProposalId = 1;

  mapping(uint256 => Dao) private _daos;
  mapping(uint256 => Proposal) private _proposals;

  /// @dev daoId => its proposal ids, oldest first.
  mapping(uint256 => uint256[]) private _daoProposals;

  /// @dev proposalId => option => summed weight.
  mapping(uint256 => mapping(uint8 => uint256)) private _tallies;
  mapping(uint256 => mapping(address => Receipt)) private _receipts;

  /// @dev daoId => account => staked amount (Staked) or 1 (Members). Unused in VotesToken.
  mapping(uint256 => mapping(address => uint256)) private _units;

  /// @dev daoId => account => chosen delegate. address(0) means "myself", so a wallet votes
  ///      with its own units from the first stake without an extra self-delegation tx.
  mapping(uint256 => mapping(address => address)) private _delegations;

  /// @dev daoId => delegate => votes over time (timestamp clock).
  mapping(uint256 => mapping(address => Checkpoints.Trace208)) private _votes;

  /// @dev daoId => total units over time — the quorum base in Staked and Members modes.
  mapping(uint256 => Checkpoints.Trace208) private _totalUnits;

  /// @dev daoId => every account holding units or votes, for the roster and delegate views.
  mapping(uint256 => EnumerableSet.AddressSet) private _participants;

  mapping(address => bool) private _trustedForwarders;

  // --- Modifiers ---

  modifier onlyDirectAdmin() {
    if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
    _;
  }

  modifier onlyDirectModerator() {
    if (!hasRole(MODERATOR_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
    _;
  }

  modifier onlyDaoAdmin(uint256 _daoId) {
    Dao storage dao = _daos[_daoId];
    if (dao.createdAt == 0) revert DaoNotFound();
    if (dao.admin == address(0) || dao.admin != _msgSender()) revert NotDaoAdmin();
    _;
  }

  // --- Constructor ---

  /**
   * @param _trustedForwarder Initial EIP-2771 forwarder, or address(0) to skip.
   * @param _admin Receives DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
   */
  constructor(address _trustedForwarder, address _admin) EIP712("HupDao", "1") ERC2771Context(_trustedForwarder) {
    if (_admin == address(0)) revert InvalidAddress();

    _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    _grantRole(ADMIN_ROLE, _admin);

    if (_trustedForwarder != address(0)) {
      _trustedForwarders[_trustedForwarder] = true;
      emit TrustedForwarderUpdated(_trustedForwarder, true);
    }
  }

  // --- Logic: DAOs ---

  function createDao(
    VotingMode _mode,
    address _token,
    bool _isLsp7,
    DaoSettings calldata _settings,
    string calldata _metadata,
    address[] calldata _initialMembers
  ) external override whenNotPaused returns (uint256 daoId) {
    _requireValidMetadata(_metadata);
    _requireValidSettings(_settings);
    _requireValidToken(_mode, _token);
    if (_mode != VotingMode.Members && _initialMembers.length != 0) revert WrongMode();
    if (_initialMembers.length > MAX_BATCH_SIZE) revert TooManyMembers();

    address creator = _msgSender();
    daoId = nextDaoId++;

    Dao storage dao = _daos[daoId];
    dao.id = daoId;
    dao.admin = creator;
    dao.mode = _mode;
    dao.isLsp7 = _mode == VotingMode.Staked && _isLsp7;
    dao.createdAt = uint48(block.timestamp);
    dao.token = _token;
    dao.settings = _settings;
    dao.metadata = _metadata;

    emit DaoCreated(daoId, creator, _mode, _token, dao.isLsp7, _metadata);
    emit DaoSettingsUpdated(daoId, _settings.votingDelay, _settings.votingPeriod, _settings.quorumBps, _settings.proposalThreshold);

    for (uint256 i = 0; i < _initialMembers.length; i++) {
      _addMember(daoId, _initialMembers[i]);
    }
  }

  function updateSettings(uint256 _daoId, DaoSettings calldata _settings) external override whenNotPaused onlyDaoAdmin(_daoId) {
    _requireValidSettings(_settings);
    // Open proposals keep the rules they were created under — see Proposal.quorumVotes
    _daos[_daoId].settings = _settings;

    emit DaoSettingsUpdated(_daoId, _settings.votingDelay, _settings.votingPeriod, _settings.quorumBps, _settings.proposalThreshold);
  }

  function updateMetadata(uint256 _daoId, string calldata _metadata) external override whenNotPaused onlyDaoAdmin(_daoId) {
    _requireValidMetadata(_metadata);
    _daos[_daoId].metadata = _metadata;

    emit DaoMetadataUpdated(_daoId, _metadata);
  }

  /// @notice address(0) renounces: settings, metadata and the member list freeze for good.
  function transferDaoAdmin(uint256 _daoId, address _newAdmin) external override whenNotPaused onlyDaoAdmin(_daoId) {
    address previous = _daos[_daoId].admin;
    _daos[_daoId].admin = _newAdmin;

    emit DaoAdminTransferred(_daoId, previous, _newAdmin);
  }

  // --- Logic: Members mode ---

  function addMembers(uint256 _daoId, address[] calldata _accounts) external override whenNotPaused onlyDaoAdmin(_daoId) {
    if (_daos[_daoId].mode != VotingMode.Members) revert WrongMode();
    if (_accounts.length > MAX_BATCH_SIZE) revert TooManyMembers();

    for (uint256 i = 0; i < _accounts.length; i++) {
      _addMember(_daoId, _accounts[i]);
    }
  }

  function removeMembers(uint256 _daoId, address[] calldata _accounts) external override whenNotPaused onlyDaoAdmin(_daoId) {
    if (_daos[_daoId].mode != VotingMode.Members) revert WrongMode();
    if (_accounts.length > MAX_BATCH_SIZE) revert TooManyMembers();

    for (uint256 i = 0; i < _accounts.length; i++) {
      _removeMember(_daoId, _accounts[i]);
    }
  }

  /// @notice Not paused, like unstake: leaving is always possible.
  function leaveDao(uint256 _daoId) external override {
    Dao storage dao = _requireDao(_daoId);
    if (dao.mode != VotingMode.Members) revert WrongMode();

    _removeMember(_daoId, _msgSender());
  }

  // --- Logic: Staked mode ---

  /**
   * @notice Locks `_amount` of the DAO's token. ERC20 needs an allowance for this contract;
   *         LSP7 needs `authorizeOperator(thisContract, amount, "")` on the token first.
   * @dev Credits what actually arrived, so a fee-on-transfer token can't mint phantom votes.
   */
  function stake(uint256 _daoId, uint256 _amount) external override whenNotPaused nonReentrant {
    Dao storage dao = _requireDao(_daoId);
    if (dao.mode != VotingMode.Staked) revert WrongMode();
    if (_amount == 0) revert InvalidAmount();

    address account = _msgSender();
    address token = dao.token;
    uint256 balanceBefore = IERC20(token).balanceOf(address(this));

    if (dao.isLsp7) {
      // force=true: this contract is not an LSP1 receiver
      ILSP7Minimal(token).transfer(account, address(this), _amount, true, "");
    } else {
      IERC20(token).safeTransferFrom(account, address(this), _amount);
    }

    uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
    if (received == 0) revert InvalidAmount();

    _addUnits(_daoId, account, received);

    emit Staked(_daoId, account, received);
  }

  /// @notice Never paused: a stake must always be withdrawable. Votes already cast keep their
  ///         weight — they were counted at the proposal's snapshot.
  function unstake(uint256 _daoId, uint256 _amount) external override nonReentrant {
    Dao storage dao = _requireDao(_daoId);
    if (dao.mode != VotingMode.Staked) revert WrongMode();
    if (_amount == 0) revert InvalidAmount();

    address account = _msgSender();
    if (_units[_daoId][account] < _amount) revert InsufficientStake();

    // Effects before the transfer: an LSP7 payout calls the receiver's universalReceiver hook
    _removeUnits(_daoId, account, _amount);

    if (dao.isLsp7) {
      // force=true so EOAs and contracts without an LSP1 delegate can both receive
      ILSP7Minimal(dao.token).transfer(address(this), account, _amount, true, "");
    } else {
      IERC20(dao.token).safeTransfer(account, _amount);
    }

    emit Unstaked(_daoId, account, _amount);
  }

  // --- Logic: Delegation ---

  /// @notice Hands this wallet's units in one DAO to `_delegatee`; address(0) or self takes
  ///         them back. In VotesToken mode delegate on the token itself.
  function delegate(uint256 _daoId, address _delegatee) external override whenNotPaused {
    _delegate(_daoId, _msgSender(), _delegatee);
  }

  /**
   * @notice Gasless delegation from an EIP-712 signature. `_delegator` is explicit rather than
   *         recovered so ERC-1271 accounts (Universal Profiles) can sign as themselves.
   */
  function delegateBySig(
    uint256 _daoId,
    address _delegator,
    address _delegatee,
    uint256 _nonce,
    uint256 _expiry,
    bytes calldata _signature
  ) external override whenNotPaused {
    if (block.timestamp > _expiry) revert SignatureExpired();
    if (_delegator == address(0)) revert InvalidAddress();

    bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(DELEGATION_TYPEHASH, _daoId, _delegator, _delegatee, _nonce, _expiry)));
    if (!SignatureChecker.isValidSignatureNow(_delegator, digest, _signature)) revert InvalidSignature();

    _useCheckedNonce(_delegator, _nonce);
    _delegate(_daoId, _delegator, _delegatee);
  }

  // --- Logic: Proposals ---

  /**
   * @param _optionCount 0 for For/Against/Abstain, 2..8 for multiple choice.
   */
  function propose(uint256 _daoId, string calldata _metadata, uint8 _optionCount) external override whenNotPaused returns (uint256 proposalId) {
    Dao storage dao = _requireDao(_daoId);
    _requireValidMetadata(_metadata);
    if (_optionCount != 0 && (_optionCount < MIN_OPTION_COUNT || _optionCount > MAX_OPTION_COUNT)) revert InvalidOptionCount();

    address proposer = _msgSender();
    // One tick back: power gained in this very block (a flash stake) can neither propose nor vote
    uint48 snapshot = _clock(dao) - 1;

    uint256 proposerVotes = _pastVotes(dao, proposer, snapshot);
    if (proposerVotes < dao.settings.proposalThreshold) revert BelowProposalThreshold(proposerVotes, dao.settings.proposalThreshold);

    proposalId = nextProposalId++;
    uint48 voteStart = uint48(block.timestamp) + dao.settings.votingDelay;

    Proposal storage proposal = _proposals[proposalId];
    proposal.id = proposalId;
    proposal.daoId = _daoId;
    proposal.proposer = proposer;
    proposal.snapshot = snapshot;
    proposal.voteStart = voteStart;
    proposal.voteEnd = voteStart + dao.settings.votingPeriod;
    proposal.optionCount = _optionCount;
    proposal.quorumVotes = Math.mulDiv(_pastTotal(dao, snapshot), dao.settings.quorumBps, MAX_BPS);
    proposal.metadata = _metadata;

    _daoProposals[_daoId].push(proposalId);
    dao.proposalCount += 1;

    emit ProposalCreated(proposalId, _daoId, proposer, snapshot, voteStart, proposal.voteEnd, _optionCount, proposal.quorumVotes, _metadata);
  }

  /**
   * @param _option Binary: 0 Against, 1 For, 2 Abstain. Multiple choice: the option index.
   * @param _reason Optional, emitted only — never stored.
   */
  function castVote(uint256 _proposalId, uint8 _option, string calldata _reason) external override whenNotPaused {
    Proposal storage proposal = _requireProposal(_proposalId);
    if (_stateOf(proposal) != ProposalState.Active) revert VotingNotActive();
    if (_option >= _slotCount(proposal)) revert InvalidOption();
    if (bytes(_reason).length > MAX_REASON_BYTES) revert ReasonTooLarge(bytes(_reason).length, MAX_REASON_BYTES);

    address voter = _msgSender();
    Receipt storage receipt = _receipts[_proposalId][voter];
    // Final, like a poll ballot: a changeable vote lets a whale wait and flip at the last block
    if (receipt.hasVoted) revert AlreadyVoted();

    uint256 weight = _pastVotes(_daos[proposal.daoId], voter, proposal.snapshot);
    if (weight == 0) revert NoVotingPower();

    receipt.hasVoted = true;
    receipt.option = _option;
    receipt.weight = SafeCast.toUint208(weight);

    _tallies[_proposalId][_option] += weight;
    proposal.totalVotes += weight;
    proposal.voterCount += 1;

    emit VoteCast(_proposalId, proposal.daoId, voter, _option, weight, _reason);
  }

  /// @notice The proposer may cancel until voting ends; the DAO admin only before it starts,
  ///         so an admin can clear spam but never kill a vote that is going against them.
  function cancel(uint256 _proposalId) external override whenNotPaused {
    Proposal storage proposal = _requireProposal(_proposalId);
    ProposalState current = _stateOf(proposal);
    address sender = _msgSender();

    bool byProposer = sender == proposal.proposer && (current == ProposalState.Pending || current == ProposalState.Active);
    bool byAdmin = sender == _daos[proposal.daoId].admin && sender != address(0) && current == ProposalState.Pending;
    if (!byProposer && !byAdmin) revert NotCancelable();

    proposal.canceled = true;

    emit ProposalCanceled(_proposalId, proposal.daoId, sender);
  }

  // --- Logic: Moderation ---

  /// @notice Display flags only — a moderator can quiet a DAO but never change a result.
  function setDaoHidden(uint256 _daoId, bool _hidden) external override onlyDirectModerator {
    _requireDao(_daoId).hidden = _hidden;

    emit DaoHiddenSet(_daoId, _hidden, msg.sender);
  }

  function setProposalHidden(uint256 _proposalId, bool _hidden) external override onlyDirectModerator {
    _requireProposal(_proposalId).hidden = _hidden;

    emit ProposalHiddenSet(_proposalId, _hidden, msg.sender);
  }

  // --- Logic: Views ---

  function version() external pure override returns (string memory) {
    return "1.0.0";
  }

  function getDao(uint256 _daoId) external view override returns (Dao memory) {
    return _daos[_daoId];
  }

  /// @notice DAOs by id ascending, starting after `_offset` (offset 0 = DAO #1).
  function getDaos(uint256 _offset, uint256 _count) external view override returns (Dao[] memory daos) {
    uint256 total = nextDaoId - 1;
    if (_offset >= total) return new Dao[](0);

    uint256 size = Math.min(Math.min(_count, MAX_PAGE_SIZE), total - _offset);
    daos = new Dao[](size);
    for (uint256 i = 0; i < size; i++) {
      daos[i] = _daos[_offset + i + 1];
    }
  }

  function getProposal(uint256 _proposalId) external view override returns (Proposal memory) {
    return _proposals[_proposalId];
  }

  /// @notice A DAO's proposals newest first, skipping the `_offset` most recent.
  function getProposals(uint256 _daoId, uint256 _offset, uint256 _count) external view override returns (Proposal[] memory proposals) {
    uint256[] storage ids = _daoProposals[_daoId];
    uint256 total = ids.length;
    if (_offset >= total) return new Proposal[](0);

    uint256 size = Math.min(Math.min(_count, MAX_PAGE_SIZE), total - _offset);
    proposals = new Proposal[](size);
    for (uint256 i = 0; i < size; i++) {
      proposals[i] = _proposals[ids[total - 1 - _offset - i]];
    }
  }

  function getTallies(uint256 _proposalId) external view override returns (uint256[] memory counts) {
    Proposal storage proposal = _proposals[_proposalId];
    if (proposal.id == 0) return new uint256[](0);

    uint8 slots = _slotCount(proposal);
    counts = new uint256[](slots);
    for (uint8 i = 0; i < slots; i++) {
      counts[i] = _tallies[_proposalId][i];
    }
  }

  function state(uint256 _proposalId) external view override returns (ProposalState) {
    return _stateOf(_requireProposal(_proposalId));
  }

  function getReceipt(uint256 _proposalId, address _account) external view override returns (Receipt memory) {
    return _receipts[_proposalId][_account];
  }

  /// @notice The DAO's timepoint unit: block timestamp, or the votes token's own clock.
  function clock(uint256 _daoId) external view override returns (uint48) {
    return _clock(_requireDao(_daoId));
  }

  function getVotes(uint256 _daoId, address _account) external view override returns (uint256) {
    Dao storage dao = _requireDao(_daoId);
    if (dao.mode == VotingMode.VotesToken) return IVotesMinimal(dao.token).getVotes(_account);

    return _votes[_daoId][_account].latest();
  }

  function getPastVotes(uint256 _daoId, address _account, uint256 _timepoint) external view override returns (uint256) {
    return _pastVotes(_requireDao(_daoId), _account, SafeCast.toUint48(_timepoint));
  }

  function getPastTotalVotes(uint256 _daoId, uint256 _timepoint) external view override returns (uint256) {
    return _pastTotal(_requireDao(_daoId), SafeCast.toUint48(_timepoint));
  }

  function delegates(uint256 _daoId, address _account) external view override returns (address) {
    return _delegateOf(_daoId, _account);
  }

  function unitsOf(uint256 _daoId, address _account) external view override returns (uint256) {
    return _units[_daoId][_account];
  }

  function isMember(uint256 _daoId, address _account) external view override returns (bool) {
    return _daos[_daoId].mode == VotingMode.Members && _units[_daoId][_account] != 0;
  }

  function participantCount(uint256 _daoId) external view override returns (uint256) {
    return _participants[_daoId].length();
  }

  /// @notice Roster in set order (not sorted — sort by `votes` client-side for a leaderboard).
  function getParticipants(uint256 _daoId, uint256 _offset, uint256 _count) external view override returns (Participant[] memory rows) {
    EnumerableSet.AddressSet storage set = _participants[_daoId];
    uint256 total = set.length();
    if (_offset >= total) return new Participant[](0);

    uint256 size = Math.min(Math.min(_count, MAX_PAGE_SIZE), total - _offset);
    rows = new Participant[](size);
    for (uint256 i = 0; i < size; i++) {
      address account = set.at(_offset + i);
      rows[i] = Participant({
        account: account,
        units: _units[_daoId][account],
        votes: _votes[_daoId][account].latest(),
        delegate: _delegateOf(_daoId, account)
      });
    }
  }

  // --- Logic: Admin ---

  function pause() external onlyDirectAdmin {
    _pause();
  }

  function unpause() external onlyDirectAdmin {
    _unpause();
  }

  function setTrustedForwarder(address _forwarder, bool _trusted) external onlyDirectAdmin {
    if (_forwarder == address(0)) revert InvalidAddress();
    _trustedForwarders[_forwarder] = _trusted;

    emit TrustedForwarderUpdated(_forwarder, _trusted);
  }

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

  // --- Logic: Internal ---

  function _addMember(uint256 _daoId, address _account) private {
    if (_account == address(0)) revert InvalidAddress();
    if (_units[_daoId][_account] != 0) revert AlreadyMember();

    _addUnits(_daoId, _account, 1);

    emit MemberAdded(_daoId, _account);
  }

  function _removeMember(uint256 _daoId, address _account) private {
    if (_units[_daoId][_account] == 0) revert NotMember();

    _removeUnits(_daoId, _account, 1);

    emit MemberRemoved(_daoId, _account);
  }

  function _addUnits(uint256 _daoId, address _account, uint256 _amount) private {
    _units[_daoId][_account] += _amount;
    Checkpoints.Trace208 storage total = _totalUnits[_daoId];
    total.push(_now(), SafeCast.toUint208(total.latest() + _amount));

    _moveVotes(_daoId, address(0), _delegateOf(_daoId, _account), _amount);
    _syncParticipant(_daoId, _account);
  }

  function _removeUnits(uint256 _daoId, address _account, uint256 _amount) private {
    _units[_daoId][_account] -= _amount;
    Checkpoints.Trace208 storage total = _totalUnits[_daoId];
    total.push(_now(), SafeCast.toUint208(total.latest() - _amount));

    _moveVotes(_daoId, _delegateOf(_daoId, _account), address(0), _amount);
    _syncParticipant(_daoId, _account);
  }

  function _delegate(uint256 _daoId, address _delegator, address _to) private {
    Dao storage dao = _requireDao(_daoId);
    if (dao.mode == VotingMode.VotesToken) revert DelegationOnToken();

    address target = _to == address(0) ? _delegator : _to;
    address previous = _delegateOf(_daoId, _delegator);
    // Self is stored as zero, which is also what a never-delegated wallet reads as
    _delegations[_daoId][_delegator] = target == _delegator ? address(0) : target;

    emit DelegateChanged(_daoId, _delegator, previous, target);

    _moveVotes(_daoId, previous, target, _units[_daoId][_delegator]);
  }

  /// @dev address(0) on either side means minting into / burning out of the vote supply.
  function _moveVotes(uint256 _daoId, address _from, address _to, uint256 _amount) private {
    if (_from == _to || _amount == 0) return;

    if (_from != address(0)) {
      Checkpoints.Trace208 storage fromVotes = _votes[_daoId][_from];
      (uint256 oldValue, uint256 newValue) = fromVotes.push(_now(), SafeCast.toUint208(fromVotes.latest() - _amount));
      emit DelegateVotesChanged(_daoId, _from, oldValue, newValue);
      _syncParticipant(_daoId, _from);
    }

    if (_to != address(0)) {
      Checkpoints.Trace208 storage toVotes = _votes[_daoId][_to];
      (uint256 oldValue, uint256 newValue) = toVotes.push(_now(), SafeCast.toUint208(toVotes.latest() + _amount));
      emit DelegateVotesChanged(_daoId, _to, oldValue, newValue);
      _syncParticipant(_daoId, _to);
    }
  }

  /// @dev Keeps the roster to exactly the accounts holding units or votes.
  function _syncParticipant(uint256 _daoId, address _account) private {
    if (_units[_daoId][_account] != 0 || _votes[_daoId][_account].latest() != 0) {
      _participants[_daoId].add(_account);
    } else {
      _participants[_daoId].remove(_account);
    }
  }

  function _delegateOf(uint256 _daoId, address _account) private view returns (address) {
    address stored = _delegations[_daoId][_account];
    return stored == address(0) ? _account : stored;
  }

  function _pastVotes(Dao storage _dao, address _account, uint48 _timepoint) private view returns (uint256) {
    if (_dao.mode == VotingMode.VotesToken) return IVotesMinimal(_dao.token).getPastVotes(_account, _timepoint);

    return _votes[_dao.id][_account].upperLookupRecent(_timepoint);
  }

  function _pastTotal(Dao storage _dao, uint48 _timepoint) private view returns (uint256) {
    if (_dao.mode == VotingMode.VotesToken) return IVotesMinimal(_dao.token).getPastTotalSupply(_timepoint);

    return _totalUnits[_dao.id].upperLookupRecent(_timepoint);
  }

  /// @dev ERC-6372: a votes token without clock() is block-number based by definition.
  function _clock(Dao storage _dao) private view returns (uint48) {
    if (_dao.mode != VotingMode.VotesToken) return _now();

    (bool ok, bytes memory data) = _dao.token.staticcall(abi.encodeWithSignature("clock()"));
    if (ok && data.length >= 32) return SafeCast.toUint48(abi.decode(data, (uint256)));

    return SafeCast.toUint48(block.number);
  }

  function _now() private view returns (uint48) {
    return uint48(block.timestamp);
  }

  function _stateOf(Proposal storage _proposal) private view returns (ProposalState) {
    if (_proposal.canceled) return ProposalState.Canceled;
    if (block.timestamp < _proposal.voteStart) return ProposalState.Pending;
    if (block.timestamp < _proposal.voteEnd) return ProposalState.Active;

    return _passed(_proposal) ? ProposalState.Succeeded : ProposalState.Defeated;
  }

  /**
   * @dev Binary: quorum counts For + Abstain, and For must strictly beat Against.
   *      Multiple choice: quorum counts every ballot, and one option must strictly lead —
   *      a tie at the top is no decision.
   */
  function _passed(Proposal storage _proposal) private view returns (bool) {
    uint256 id = _proposal.id;

    if (_proposal.optionCount == 0) {
      uint256 forVotes = _tallies[id][uint8(BinaryOption.For)];
      uint256 againstVotes = _tallies[id][uint8(BinaryOption.Against)];
      uint256 counted = forVotes + _tallies[id][uint8(BinaryOption.Abstain)];
      return counted >= _proposal.quorumVotes && forVotes > againstVotes;
    }

    if (_proposal.totalVotes < _proposal.quorumVotes) return false;

    uint256 best;
    bool tied;
    for (uint8 i = 0; i < _proposal.optionCount; i++) {
      uint256 votes = _tallies[id][i];
      if (votes > best) {
        best = votes;
        tied = false;
      } else if (votes == best) {
        tied = true;
      }
    }
    return best > 0 && !tied;
  }

  function _slotCount(Proposal storage _proposal) private view returns (uint8) {
    return _proposal.optionCount == 0 ? BINARY_TALLY_SLOTS : _proposal.optionCount;
  }

  function _requireDao(uint256 _daoId) private view returns (Dao storage dao) {
    dao = _daos[_daoId];
    if (dao.createdAt == 0) revert DaoNotFound();
  }

  function _requireProposal(uint256 _proposalId) private view returns (Proposal storage proposal) {
    proposal = _proposals[_proposalId];
    if (proposal.id == 0) revert ProposalNotFound();
  }

  function _requireValidMetadata(string calldata _metadata) private pure {
    uint256 length = bytes(_metadata).length;
    if (length == 0) revert InvalidMetadata();
    if (length > MAX_METADATA_BYTES) revert MetadataTooLarge(length, MAX_METADATA_BYTES);
  }

  function _requireValidSettings(DaoSettings calldata _settings) private pure {
    if (_settings.votingPeriod < MIN_VOTING_PERIOD || _settings.votingPeriod > MAX_VOTING_PERIOD) revert InvalidSettings();
    if (_settings.votingDelay > MAX_VOTING_DELAY) revert InvalidSettings();
    if (_settings.quorumBps > MAX_BPS) revert InvalidSettings();
  }

  /**
   * @dev Probes the token once at creation so a typo, an EOA or the wrong standard fails here
   *      with a clear error instead of producing a DAO nobody can ever vote in.
   */
  function _requireValidToken(VotingMode _mode, address _token) private view {
    if (_mode == VotingMode.Members) {
      if (_token != address(0)) revert InvalidToken();
      return;
    }
    if (_token == address(0) || _token.code.length == 0) revert InvalidToken();

    bytes memory probe = _mode == VotingMode.Staked
      ? abi.encodeCall(IERC20.balanceOf, (address(this)))
      : abi.encodeCall(IVotesMinimal.getVotes, (address(this)));
    (bool ok, bytes memory data) = _token.staticcall{gas: TOKEN_PROBE_GAS_CAP}(probe);
    if (!ok || data.length < 32) revert InvalidToken();
  }

  // --- Logic: ERC2771 ---

  function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupDao) returns (bool) {
    return _trustedForwarders[forwarder];
  }

  function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
    return ERC2771Context._msgSender();
  }

  function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
    return ERC2771Context._msgData();
  }

  function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
    return ERC2771Context._contextSuffixLength();
  }
}
