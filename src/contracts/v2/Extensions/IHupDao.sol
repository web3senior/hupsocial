// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

/**
 * @title IHupDao
 * @author Hup Labs
 * @notice Shared types, events, errors and external surface of HupDao — standalone DAOs with
 *         snapshot-based voting power, delegation, and signalling proposals.
 * @custom:website https://hup.social
 */
interface IHupDao {
  // --- Types ---

  /// @notice Where a DAO's voting power comes from. Order is the wire format — append only.
  ///         Staked:     wallets lock an ERC20 or LSP7 token in this contract, 1 unit = 1 vote.
  ///         VotesToken: an ERC20Votes / LSP7Votes token already checkpoints votes; delegation
  ///                     happens on that token, not here.
  ///         Members:    one vote per member, members managed by the DAO admin.
  enum VotingMode {
    Staked,
    VotesToken,
    Members
  }

  /// @notice Derived, never stored — see state().
  enum ProposalState {
    Pending,
    Active,
    Defeated,
    Succeeded,
    Canceled
  }

  /// @notice Binary proposals (optionCount 0) tally into these three slots.
  enum BinaryOption {
    Against,
    For,
    Abstain
  }

  /// @notice Admin-editable voting rules. A change applies to proposals created after it —
  ///         every proposal copies the rules it was opened under.
  struct DaoSettings {
    /// @dev Seconds between a proposal's creation and the start of its vote.
    uint32 votingDelay;
    /// @dev Seconds the vote stays open.
    uint32 votingPeriod;
    /// @dev Share of total voting power (at the snapshot) that must take part, in bps.
    uint16 quorumBps;
    /// @dev Voting power (at the snapshot) needed to open a proposal.
    uint256 proposalThreshold;
  }

  struct Dao {
    uint256 id;
    /// @dev Edits settings and metadata, and manages members in Members mode. address(0) once
    ///      renounced, which freezes all of that for good.
    address admin;
    VotingMode mode;
    /// @dev Staked mode only: the staked token speaks LSP7 rather than ERC20.
    bool isLsp7;
    /// @dev Moderator display flag — never touches voting.
    bool hidden;
    uint48 createdAt;
    /// @dev The staked token (Staked), the votes token (VotesToken), address(0) (Members).
    address token;
    DaoSettings settings;
    uint256 proposalCount;
    /// @dev IPFS CID of { name, description, image, links }.
    string metadata;
  }

  struct Proposal {
    uint256 id;
    uint256 daoId;
    address proposer;
    /// @dev Timepoint in the DAO's clock (see clock()) whose voting power counts.
    uint48 snapshot;
    uint48 voteStart;
    uint48 voteEnd;
    /// @dev 0 = binary For/Against/Abstain, 2..8 = multiple choice.
    uint8 optionCount;
    bool canceled;
    /// @dev Moderator display flag — never touches voting.
    bool hidden;
    uint32 voterCount;
    /// @dev Absolute participation needed, fixed at creation from the snapshot's total power.
    uint256 quorumVotes;
    /// @dev Sum of every ballot's weight, abstentions included.
    uint256 totalVotes;
    /// @dev IPFS CID of { title, body, options[] }.
    string metadata;
  }

  struct Receipt {
    bool hasVoted;
    uint8 option;
    uint208 weight;
  }

  /// @notice One row of a DAO's roster: anyone holding units or delegated votes.
  struct Participant {
    address account;
    uint256 units;
    uint256 votes;
    address delegate;
  }

  // --- Events ---

  event DaoCreated(uint256 indexed daoId, address indexed admin, VotingMode mode, address token, bool isLsp7, string metadata);
  event DaoSettingsUpdated(uint256 indexed daoId, uint32 votingDelay, uint32 votingPeriod, uint16 quorumBps, uint256 proposalThreshold);
  event DaoMetadataUpdated(uint256 indexed daoId, string metadata);
  event DaoAdminTransferred(uint256 indexed daoId, address indexed previousAdmin, address indexed newAdmin);
  event DaoHiddenSet(uint256 indexed daoId, bool hidden, address indexed moderator);

  event MemberAdded(uint256 indexed daoId, address indexed account);
  event MemberRemoved(uint256 indexed daoId, address indexed account);
  event Staked(uint256 indexed daoId, address indexed account, uint256 amount);
  event Unstaked(uint256 indexed daoId, address indexed account, uint256 amount);

  event DelegateChanged(uint256 indexed daoId, address indexed delegator, address fromDelegate, address toDelegate);
  event DelegateVotesChanged(uint256 indexed daoId, address indexed delegate, uint256 previousVotes, uint256 newVotes);

  event ProposalCreated(
    uint256 indexed proposalId,
    uint256 indexed daoId,
    address indexed proposer,
    uint48 snapshot,
    uint48 voteStart,
    uint48 voteEnd,
    uint8 optionCount,
    uint256 quorumVotes,
    string metadata
  );
  event ProposalCanceled(uint256 indexed proposalId, uint256 indexed daoId, address indexed canceledBy);
  event ProposalHiddenSet(uint256 indexed proposalId, bool hidden, address indexed moderator);
  event VoteCast(uint256 indexed proposalId, uint256 indexed daoId, address indexed voter, uint8 option, uint256 weight, string reason);

  event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

  // --- Errors ---

  error Unauthorized();
  error InvalidAddress();
  error InvalidToken();
  error InvalidSettings();
  error InvalidMetadata();
  error MetadataTooLarge(uint256 length, uint256 max);
  error ReasonTooLarge(uint256 length, uint256 max);
  error DaoNotFound();
  error ProposalNotFound();
  error NotDaoAdmin();
  error WrongMode();
  error DelegationOnToken();
  error TooManyMembers();
  error AlreadyMember();
  error NotMember();
  error InvalidAmount();
  error InsufficientStake();
  error BelowProposalThreshold(uint256 votes, uint256 threshold);
  error InvalidOptionCount();
  error InvalidOption();
  error VotingNotActive();
  error AlreadyVoted();
  error NoVotingPower();
  error NotCancelable();
  error SignatureExpired();
  error InvalidSignature();

  // --- Logic ---

  function createDao(
    VotingMode _mode,
    address _token,
    bool _isLsp7,
    DaoSettings calldata _settings,
    string calldata _metadata,
    address[] calldata _initialMembers
  ) external returns (uint256 daoId);

  function updateSettings(uint256 _daoId, DaoSettings calldata _settings) external;
  function updateMetadata(uint256 _daoId, string calldata _metadata) external;
  function transferDaoAdmin(uint256 _daoId, address _newAdmin) external;

  function addMembers(uint256 _daoId, address[] calldata _accounts) external;
  function removeMembers(uint256 _daoId, address[] calldata _accounts) external;
  function leaveDao(uint256 _daoId) external;

  function stake(uint256 _daoId, uint256 _amount) external;
  function unstake(uint256 _daoId, uint256 _amount) external;

  function delegate(uint256 _daoId, address _delegatee) external;
  function delegateBySig(
    uint256 _daoId,
    address _delegator,
    address _delegatee,
    uint256 _nonce,
    uint256 _expiry,
    bytes calldata _signature
  ) external;

  function propose(uint256 _daoId, string calldata _metadata, uint8 _optionCount) external returns (uint256 proposalId);
  function castVote(uint256 _proposalId, uint8 _option, string calldata _reason) external;
  function cancel(uint256 _proposalId) external;

  function setDaoHidden(uint256 _daoId, bool _hidden) external;
  function setProposalHidden(uint256 _proposalId, bool _hidden) external;

  function version() external pure returns (string memory);
  function nextDaoId() external view returns (uint256);
  function nextProposalId() external view returns (uint256);
  function getDao(uint256 _daoId) external view returns (Dao memory);
  function getDaos(uint256 _offset, uint256 _count) external view returns (Dao[] memory);
  function getProposal(uint256 _proposalId) external view returns (Proposal memory);
  function getProposals(uint256 _daoId, uint256 _offset, uint256 _count) external view returns (Proposal[] memory);
  function getTallies(uint256 _proposalId) external view returns (uint256[] memory);
  function state(uint256 _proposalId) external view returns (ProposalState);
  function getReceipt(uint256 _proposalId, address _account) external view returns (Receipt memory);
  function clock(uint256 _daoId) external view returns (uint48);
  function getVotes(uint256 _daoId, address _account) external view returns (uint256);
  function getPastVotes(uint256 _daoId, address _account, uint256 _timepoint) external view returns (uint256);
  function getPastTotalVotes(uint256 _daoId, uint256 _timepoint) external view returns (uint256);
  function delegates(uint256 _daoId, address _account) external view returns (address);
  function unitsOf(uint256 _daoId, address _account) external view returns (uint256);
  function isMember(uint256 _daoId, address _account) external view returns (bool);
  function participantCount(uint256 _daoId) external view returns (uint256);
  function getParticipants(uint256 _daoId, uint256 _offset, uint256 _count) external view returns (Participant[] memory);
  function isTrustedForwarder(address _forwarder) external view returns (bool);
}
