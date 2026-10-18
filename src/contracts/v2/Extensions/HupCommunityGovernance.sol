// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./HupCommunityTreasury.sol";

interface ICommunityVotingSource {
  function communities(uint256 id) external view returns (uint256, address, uint8, uint8, bool, string memory);
  function registry(uint256 id, address account) external view returns (bool, bool, bool, bool, bool);
}

/// @notice One member, one vote, directly or through a community member delegate.
/// @dev Rules and payment instructions are fixed at proposal creation. No admin withdrawal path.
///      All callers may be EOAs or Universal Profiles. Eligibility uses current membership.
contract HupCommunityGovernance is ReentrancyGuard {
  using SafeERC20 for IERC20;

  // --- Storage ---

  struct Rules {
    uint32 votingDelay;
    uint32 minVotingPeriod;
    uint32 maxVotingPeriod;
    uint32 executionDelay;
    uint32 minimumVotes;
    uint16 approvalBps;
  }

  struct Payment {
    address asset;
    address recipient;
    uint256 amount;
    bool isLsp7;
  }

  struct Proposal {
    uint256 id;
    uint256 communityId;
    address proposer;
    uint48 voteStart;
    uint48 voteEnd;
    uint48 executableAt;
    uint256 quorumVotes;
    uint16 approvalBps;
    uint8 optionCount;
    bool canceled;
    bool executed;
    uint256 voterCount;
    string metadata;
    Payment payment;
  }

  enum State { Pending, Active, Defeated, Succeeded, Canceled, Executed }

  ICommunityVotingSource public immutable community;
  uint256 public nextProposalId = 1;
  mapping(uint256 => Rules) private _rules;
  mapping(uint256 => Proposal) private _proposals;
  mapping(uint256 => uint256[]) private _communityProposals;
  mapping(uint256 => mapping(uint8 => uint256)) private _tallies;
  mapping(uint256 => mapping(address => bool)) public hasVoted;
  mapping(uint256 => HupCommunityTreasury) public treasuries;
  mapping(uint256 => mapping(address => address)) public delegates;
  mapping(uint256 => mapping(address => address[])) private _delegators;
  mapping(uint256 => mapping(address => uint256)) private _delegatorIndex;

  // --- Events ---

  event RulesUpdated(uint256 indexed communityId, Rules rules);
  event TreasuryCreated(uint256 indexed communityId, address treasury);
  event TreasuryFunded(uint256 indexed communityId, address indexed sender, address indexed asset, uint256 amount, bool isLsp7);
  event ProposalCreated(uint256 indexed proposalId, uint256 indexed communityId, address indexed proposer, string metadata, Payment payment);
  event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 option);
  event DelegateChanged(uint256 indexed communityId, address indexed member, address indexed delegatee);
  event DelegatedVoteCast(uint256 indexed proposalId, address indexed member, address indexed delegatee, uint8 option);
  event ProposalCanceled(uint256 indexed proposalId);
  event ProposalExecuted(uint256 indexed proposalId, address indexed executor);

  // --- Modifiers ---

  modifier onlyMember(uint256 id) {
    (bool member, , , bool banned, ) = community.registry(id, msg.sender);
    require(member && !banned, "Community members only");
    _;
  }

  // --- Logic ---

  constructor(address source) {
    require(source.code.length > 0, "Invalid community contract");
    community = ICommunityVotingSource(source);
  }

  function delegationVersion() external pure returns (uint256) {
    return 1;
  }

  /// @notice Appoint a direct representative. Zero address or self revokes delegation.
  /// @dev Current appointments apply to uncast ballots, including active proposals.
  ///      Delegation never forwards another member's authority or changes a recorded ballot.
  function delegate(uint256 id, address delegatee) external {
    _communityOwner(id);
    if (delegatee == msg.sender) delegatee = address(0);
    if (delegatee != address(0)) {
      _requireMember(id, msg.sender);
      _requireMember(id, delegatee);
    }
    address previous = delegates[id][msg.sender];
    if (previous == delegatee) return;
    if (previous != address(0)) {
      address[] storage members = _delegators[id][previous];
      uint256 index = _delegatorIndex[id][msg.sender];
      address last = members[members.length - 1];
      members[index] = last;
      _delegatorIndex[id][last] = index;
      members.pop();
      delete _delegatorIndex[id][msg.sender];
    }
    delegates[id][msg.sender] = delegatee;
    if (delegatee != address(0)) {
      _delegatorIndex[id][msg.sender] = _delegators[id][delegatee].length;
      _delegators[id][delegatee].push(msg.sender);
    }
    emit DelegateChanged(id, msg.sender, delegatee);
  }

  function getDelegators(uint256 id, address delegatee, uint256 offset, uint256 limit) external view returns (address[] memory rows, uint256 total) {
    require(limit <= 50, "Page too large");
    address[] storage members = _delegators[id][delegatee];
    total = members.length;
    uint256 count = offset >= total ? 0 : Math.min(limit, total - offset);
    rows = new address[](count);
    for (uint256 i = 0; i < count; i++) rows[i] = members[offset + i];
  }

  /// @notice Cast one ballot per named member. A member may always cast their own uncast ballot.
  function castVotesFor(uint256 proposalId, address[] calldata members, uint8 option) external {
    Proposal storage proposal = _proposal(proposalId);
    _requireMember(proposal.communityId, msg.sender);
    require(members.length > 0 && members.length <= 50, "Invalid batch");
    for (uint256 i = 0; i < members.length; i++) {
      address member = members[i];
      require(member == msg.sender || delegates[proposal.communityId][member] == msg.sender, "Not delegated");
      _requireMember(proposal.communityId, member);
      _castVote(proposalId, member, option);
      if (member != msg.sender) emit DelegatedVoteCast(proposalId, member, msg.sender, option);
    }
  }

  function _requireMember(uint256 id, address account) private view {
    (bool member, , , bool banned, ) = community.registry(id, account);
    require(member && !banned, "Community members only");
  }

  function getRules(uint256 id) public view returns (Rules memory) {
    _communityOwner(id);
    Rules memory rules = _rules[id];
    if (rules.maxVotingPeriod == 0) return Rules(0, 1 hours, 90 days, 2 days, 1, 5001);
    return rules;
  }

  function updateRules(uint256 id, Rules calldata rules) external {
    require(msg.sender == _communityOwner(id), "Community owner only");
    require(rules.minVotingPeriod >= 1 hours && rules.maxVotingPeriod <= 90 days && rules.minVotingPeriod <= rules.maxVotingPeriod, "Invalid duration bounds");
    require(rules.votingDelay <= 30 days && rules.executionDelay >= 1 hours && rules.executionDelay <= 30 days, "Invalid delay");
    require(rules.minimumVotes > 0, "Invalid turnout");
    require(rules.approvalBps > 5000 && rules.approvalBps <= 10000, "Invalid approval");
    _rules[id] = rules;
    emit RulesUpdated(id, rules);
  }

  function treasuryAddress(uint256 id) public view returns (address) {
    bytes32 salt = bytes32(id);
    bytes32 hash = keccak256(abi.encodePacked(type(HupCommunityTreasury).creationCode, abi.encode(id)));
    return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hash)))));
  }

  function ensureTreasury(uint256 id) public returns (HupCommunityTreasury treasury) {
    _communityOwner(id);
    treasury = treasuries[id];
    if (address(treasury) == address(0)) {
      treasury = new HupCommunityTreasury{salt: bytes32(id)}(id);
      treasuries[id] = treasury;
      emit TreasuryCreated(id, address(treasury));
    }
  }

  function depositNative(uint256 id) external payable nonReentrant {
    require(msg.value > 0, "Empty deposit");
    HupCommunityTreasury treasury = ensureTreasury(id);
    (bool success, ) = address(treasury).call{value: msg.value}("");
    require(success, "Deposit failed");
    emit TreasuryFunded(id, msg.sender, address(0), msg.value, false);
  }

  function depositToken(uint256 id, address asset, uint256 amount, bool isLsp7) external nonReentrant {
    require(asset.code.length > 0 && amount > 0, "Invalid deposit");
    address treasury = address(ensureTreasury(id));
    // Balance delta makes the deposit event honest for fee-taking assets.
    uint256 beforeBalance = IERC20(asset).balanceOf(treasury);
    if (isLsp7) ILSP7Minimal(asset).transfer(msg.sender, treasury, amount, true, "");
    else IERC20(asset).safeTransferFrom(msg.sender, treasury, amount);
    uint256 received = IERC20(asset).balanceOf(treasury) - beforeBalance;
    require(received > 0, "Empty deposit");
    emit TreasuryFunded(id, msg.sender, asset, received, isLsp7);
  }

  function propose(uint256 id, string calldata metadata, uint8 optionCount, uint32 votingPeriod, Payment calldata payment) external onlyMember(id) returns (uint256 proposalId) {
    (, , , , bool active, ) = community.communities(id);
    require(active, "Community archived");
    require(bytes(metadata).length > 0 && bytes(metadata).length <= 128, "Invalid metadata CID");
    require(optionCount == 0 || (optionCount >= 2 && optionCount <= 8), "Invalid choices");
    Rules memory rules = getRules(id);
    require(votingPeriod >= rules.minVotingPeriod && votingPeriod <= rules.maxVotingPeriod, "Voting duration outside allowed range");
    if (payment.amount > 0) {
      require(optionCount == 0 && payment.recipient != address(0), "Invalid payment");
      require(payment.asset != address(0) ? payment.asset.code.length > 0 : !payment.isLsp7, "Invalid asset");
      ensureTreasury(id);
      require(payment.recipient != treasuryAddress(id) && payment.recipient != address(this), "Invalid recipient");
    } else {
      require(payment.asset == address(0) && payment.recipient == address(0) && !payment.isLsp7, "Invalid signal payment");
    }

    proposalId = nextProposalId++;
    Proposal storage proposal = _proposals[proposalId];
    proposal.id = proposalId;
    proposal.communityId = id;
    proposal.proposer = msg.sender;
    proposal.voteStart = uint48(block.timestamp + rules.votingDelay);
    proposal.voteEnd = proposal.voteStart + votingPeriod;
    proposal.executableAt = proposal.voteEnd + rules.executionDelay;
    proposal.quorumVotes = rules.minimumVotes;
    proposal.approvalBps = rules.approvalBps;
    proposal.optionCount = optionCount;
    proposal.metadata = metadata;
    proposal.payment = payment;
    _communityProposals[id].push(proposalId);
    emit ProposalCreated(proposalId, id, msg.sender, metadata, payment);
  }

  function castVote(uint256 proposalId, uint8 option) external onlyMember(_proposal(proposalId).communityId) {
    _castVote(proposalId, msg.sender, option);
  }

  function _castVote(uint256 proposalId, address voter, uint8 option) private {
    Proposal storage proposal = _proposals[proposalId];
    require(state(proposalId) == State.Active, "Voting closed");
    require(!hasVoted[proposalId][voter], "Already voted");
    require(option < (proposal.optionCount == 0 ? 3 : proposal.optionCount), "Invalid option");
    hasVoted[proposalId][voter] = true;
    _tallies[proposalId][option]++;
    proposal.voterCount++;
    emit VoteCast(proposalId, voter, option);
  }

  function cancel(uint256 proposalId) external {
    Proposal storage proposal = _proposal(proposalId);
    State current = state(proposalId);
    require(current == State.Pending || current == State.Active, "Cannot cancel");
    require(msg.sender == proposal.proposer || (current == State.Pending && msg.sender == _communityOwner(proposal.communityId)), "Cannot cancel");
    proposal.canceled = true;
    emit ProposalCanceled(proposalId);
  }

  function execute(uint256 proposalId) external nonReentrant {
    Proposal storage proposal = _proposal(proposalId);
    require(state(proposalId) == State.Succeeded, "Proposal not passed");
    require(proposal.payment.amount > 0, "No payment");
    require(block.timestamp >= proposal.executableAt, "Execution delay");
    proposal.executed = true;
    Payment memory payment = proposal.payment;
    treasuries[proposal.communityId].pay(payment.asset, payment.recipient, payment.amount, payment.isLsp7);
    emit ProposalExecuted(proposalId, msg.sender);
  }

  function getProposal(uint256 proposalId) external view returns (Proposal memory) {
    return _proposal(proposalId);
  }

  function proposalCount(uint256 id) external view returns (uint256) {
    return _communityProposals[id].length;
  }

  function getProposals(uint256 id, uint256 offset, uint256 limit) external view returns (Proposal[] memory rows) {
    require(limit <= 100, "Page too large");
    uint256[] storage ids = _communityProposals[id];
    uint256 count = offset >= ids.length ? 0 : Math.min(limit, ids.length - offset);
    rows = new Proposal[](count);
    for (uint256 i = 0; i < count; i++) rows[i] = _proposals[ids[ids.length - 1 - offset - i]];
  }

  function getTallies(uint256 proposalId) public view returns (uint256[] memory tallies) {
    Proposal storage proposal = _proposal(proposalId);
    tallies = new uint256[](proposal.optionCount == 0 ? 3 : proposal.optionCount);
    for (uint8 i = 0; i < tallies.length; i++) tallies[i] = _tallies[proposalId][i];
  }

  function state(uint256 proposalId) public view returns (State) {
    Proposal storage proposal = _proposal(proposalId);
    if (proposal.executed) return State.Executed;
    if (proposal.canceled) return State.Canceled;
    if (block.timestamp < proposal.voteStart) return State.Pending;
    if (block.timestamp < proposal.voteEnd) return State.Active;
    // Every member ballot, including abstention, counts toward turnout.
    if (proposal.voterCount < proposal.quorumVotes) return State.Defeated;
    uint256[] memory tallies = getTallies(proposalId);
    uint256 support;
    uint256 decisive;
    if (proposal.optionCount == 0) {
      support = tallies[1];
      decisive = tallies[0] + tallies[1];
    } else {
      decisive = proposal.voterCount;
      for (uint256 i = 0; i < tallies.length; i++) support = Math.max(support, tallies[i]);
    }
    if (decisive == 0 || support < Math.mulDiv(decisive, proposal.approvalBps, 10000, Math.Rounding.Ceil)) return State.Defeated;
    return State.Succeeded;
  }

  function _proposal(uint256 id) private view returns (Proposal storage proposal) {
    proposal = _proposals[id];
    require(proposal.id != 0, "Proposal not found");
  }

  function _communityOwner(uint256 id) private view returns (address owner) {
    (uint256 foundId, address creator, , , , ) = community.communities(id);
    require(foundId != 0 && creator != address(0), "Community not found");
    return creator;
  }
}
