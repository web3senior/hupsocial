// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IHupPolls.sol";
import "./Follower System/ILSP26FollowerSystem.sol";

/**
 * @title Hup Polls
 * @author Hup Labs
 * @notice Extension contract powering free opinion polls on Hup. A creator opens a poll with
 *         two to eight options and a voting window; anyone casts exactly one final ballot
 *         before it closes. No value is ever escrowed, spent, or paid out — the contract exists
 *         so a result can be counted by anyone instead of trusted, which is the whole
 *         difference between an onchain poll and a number on a website.
 * @dev Uses IHupPolls for shared structs, events, errors, and view signatures. Integrates with
 *      Hup Core via IHup only to resolve burner session keys to primary wallets. Supports
 *      rotatable ERC2771 trusted forwarders for meta-transactions, AccessControl for
 *      admin/moderator permissions, and Pausable for emergency controls. No ReentrancyGuard and
 *      no `receive`: nothing here moves value, no function is payable, and a contract with
 *      neither cannot be paid by an ordinary transfer.
 *
 *      One address is one vote — a sybil bound, not a sybil defense, and the same bound likes
 *      already carry. A poll may narrow its electorate with a composable requirement list
 *      (native/token/NFT balance, a Merkle allowlist, following the creator, or membership of
 *      a HupCommunity), reusing HupCommunity's shape so one mental model covers both. That does
 *      put external reads in the hot path of the cheapest action on the platform, which is why
 *      the list is capped at three entries against HupCommunity's ten, every read is gas-capped
 *      and fails closed, and an ungated poll — still the overwhelming majority — touches none
 *      of it. Weighted voting (balance as vote power) remains out of scope: it changes what a
 *      tally means, not just who may add to it.
 *
 *      An electorate is frozen by the first ballot, like the question. A creator who could
 *      re-gate mid-poll could watch the count and then exclude the side that was winning.
 *
 *      Moderator `hidden` is a display flag only. It suppresses a poll in the indexer and in
 *      clients and never touches the tally or the ability to vote, so a moderator can quiet a
 *      poll but can never change its result.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 📊
 */
contract HupPolls is IHupPolls, Pausable, AccessControl, ERC2771Context {
    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    uint8 public constant MIN_OPTION_COUNT = 2;
    uint8 public constant MAX_OPTION_COUNT = 8;
    uint256 public constant MIN_DURATION = 5 minutes;
    uint256 public constant MAX_DURATION = 180 days;
    uint256 public constant MAX_START_DELAY = 30 days;
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2_048;

    /// @notice Deliberately lower than HupCommunity's ten. A community evaluates its list once
    ///         per join; a poll evaluates it on every ballot, which is the cheapest action on
    ///         the platform and the one the relayer pays for.
    uint256 public constant MAX_POLL_REQUIREMENTS = 3;

    /// @notice Gas ceiling for balance/membership reads against requirement assets — same
    ///         fail-closed philosophy as HupCommunity: a hostile or broken token can neither
    ///         gas-bomb nor revert a vote. Generous for any honest balanceOf, including proxied
    ///         and rebasing (shares-computed) tokens.
    uint256 public constant ASSET_READ_GAS_CAP = 50_000;

    /// @notice The Hup Core contract instance (burner session resolution only). Admin-rotatable
    ///         so a Hup Core redeploy doesn't strand live polls behind a stale session source.
    IHup public hupContract;

    /// @notice Maps poll id to its poll
    mapping(uint256 => Poll) private _polls;

    /// @notice The id the next poll will receive; ids start at 1 so 0 means "not found"
    uint256 public override nextPollId = 1;

    /// @notice Maps poll id to option id to that option's vote count
    mapping(uint256 => mapping(uint8 => uint32)) public override tallies;

    /// @dev Maps poll id to voter to their ballot, stored one-based so a fresh slot (0) reads
    ///      as "has not voted" — option 0 is a real choice, so a separate hasVoted flag would
    ///      cost a second cold SSTORE on the single most gas-sensitive call in the contract.
    mapping(uint256 => mapping(address => uint8)) private _ballots;

    /// @notice Maps poll id to the list of conditions a wallet must satisfy to vote. Empty for
    ///         the overwhelming majority of polls, which is why it lives outside the Poll struct
    ///         — an ungated poll pays nothing for the feature existing.
    mapping(uint256 => AssetRequirement[]) private _requirementsOf;

    /// @notice Maps poll id to a Merkle root over its allowlisted voters. A root rather than a
    ///         stored set: a community writes its whitelist once for a long-lived object, but a
    ///         poll is short-lived and nearly free, so N cold SSTOREs would cost more than the
    ///         poll they gate. Leaves are keccak256(bytes.concat(keccak256(abi.encode(voter)))).
    mapping(uint256 => bytes32) public override allowlistRoot;

    /// @notice LSP26 registry backing the FollowsCreator requirement. Admin-set per chain, and
    ///         address(0) on chains without one — where that requirement then fails closed.
    address public override followerSystem;

    mapping(address => bool) public override trustedForwarders;

    /// @notice The maximum allowed byte length for a poll's metadata field
    uint256 public override maxMetadataBytes = 256;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    modifier onlyDirectModerator() {
        if (!hasRole(MODERATOR_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the polls contract.
     * @param _hupAddress Address of the deployed core Hup contract.
     * @param _trustedForwarder Address of the initial EIP-2771 trusted forwarder (or address(0) to skip).
     * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     */
    constructor(address _hupAddress, address _trustedForwarder, address _admin) ERC2771Context(_trustedForwarder) {
        if (_hupAddress == address(0) || _admin == address(0)) revert InvalidAddress();

        hupContract = IHup(_hupAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        if (_trustedForwarder != address(0)) {
            trustedForwarders[_trustedForwarder] = true;
            emit TrustedForwarderUpdated(_trustedForwarder, true);
        }
    }

    // --- MUTATIVE LOGIC ---

    function createPoll(
        address _owner,
        string calldata _metadata,
        uint8 _optionCount,
        uint64 _opensAt,
        uint64 _closesAt,
        AssetRequirement[] calldata _requirements,
        RequirementMode _mode,
        bytes32 _allowlistRoot
    ) external override whenNotPaused returns (uint256 pollId) {
        if (_optionCount < MIN_OPTION_COUNT || _optionCount > MAX_OPTION_COUNT) revert InvalidOptionCount();
        _requireValidMetadata(_metadata);

        // Validation and the write both live in helpers rather than inline: with the
        // requirement parameters on the signature the legacy codegen runs out of stack here
        // otherwise, and via-IR would put every deployment on a different pipeline from the
        // rest of the extensions (and from their verification input).
        pollId = _openPoll(_resolveActor(_owner), _metadata, _optionCount, _resolveWindow(_opensAt, _closesAt), _closesAt);

        // An ungated poll — the overwhelming majority — writes nothing and emits nothing for
        // the feature. Anything else goes through the shared validator, including a lone root
        // with no list, which it rejects rather than storing as a gate that is never checked.
        if (_requirements.length != 0 || _allowlistRoot != bytes32(0)) {
            _writeRequirements(pollId, _requirements, _mode, _allowlistRoot);
        }
    }

    function vote(address _owner, uint256 _pollId, uint8 _optionIndex, bytes32[] calldata _proof) external override whenNotPaused {
        Poll storage poll = _polls[_pollId];
        if (poll.creator == address(0)) revert PollNotFound();
        if (_optionIndex >= poll.optionCount) revert InvalidOption();
        if (block.timestamp < poll.opensAt) revert VotingNotOpen();
        if (block.timestamp >= poll.closesAt || poll.closedAt != 0) revert VotingClosed();

        address voter = _resolveActor(_owner);
        // A ballot is final: no changeVote, no unvote. See the interface note — a reversible
        // action on the relayer's coin is a faucet, and finality is what keeps the running
        // totals in VoteCast trustworthy for the indexer.
        if (_ballots[_pollId][voter] != 0) revert AlreadyVoted();
        // Checked after AlreadyVoted so a repeat tap costs the cheap revert, not the asset reads
        if (!_isEligible(_pollId, voter, _proof)) revert NotEligible();

        _ballots[_pollId][voter] = _optionIndex + 1;

        uint32 optionVotes = tallies[_pollId][_optionIndex] + 1;
        tallies[_pollId][_optionIndex] = optionVotes;
        poll.totalVotes += 1;

        emit VoteCast(_pollId, voter, _optionIndex, optionVotes, poll.totalVotes);
    }

    function closePoll(address _owner, uint256 _pollId) external override whenNotPaused {
        Poll storage poll = _polls[_pollId];
        if (poll.creator == address(0)) revert PollNotFound();
        if (poll.closedAt != 0 || block.timestamp >= poll.closesAt) revert VotingClosed();
        if (_resolveActor(_owner) != poll.creator) revert NotCreator();

        poll.closedAt = uint64(block.timestamp);

        emit PollClosedEarly(_pollId, poll.creator, uint64(block.timestamp));
    }

    function updatePollMetadata(
        address _owner,
        uint256 _pollId,
        uint8 _optionCount,
        string calldata _metadata
    ) external override whenNotPaused {
        Poll storage poll = _polls[_pollId];
        if (poll.creator == address(0)) revert PollNotFound();
        if (poll.closedAt != 0 || block.timestamp >= poll.closesAt) revert VotingClosed();
        // The question people voted on can never change under them — a poll locks at the
        // first ballot, so this window only ever covers a typo nobody has answered yet
        if (poll.totalVotes != 0) revert PollHasVotes();
        if (_resolveActor(_owner) != poll.creator) revert NotCreator();
        if (_optionCount < MIN_OPTION_COUNT || _optionCount > MAX_OPTION_COUNT) revert InvalidOptionCount();
        _requireValidMetadata(_metadata);

        // Resizing options is safe in this window: no ballots exist, so every tally is still
        // zero and no vote can reference an option id that just disappeared
        poll.optionCount = _optionCount;
        poll.metadata = _metadata;

        emit PollMetadataUpdated(_pollId, _optionCount, _metadata);
    }

    function setPollRequirements(
        address _owner,
        uint256 _pollId,
        AssetRequirement[] calldata _requirements,
        RequirementMode _mode,
        bytes32 _allowlistRoot
    ) external override whenNotPaused {
        Poll storage poll = _polls[_pollId];
        if (poll.creator == address(0)) revert PollNotFound();
        if (poll.closedAt != 0 || block.timestamp >= poll.closesAt) revert VotingClosed();
        // The electorate locks with the question at the first ballot. Without this a creator
        // could watch the count, then re-gate the poll to exclude the side that was winning.
        if (poll.totalVotes != 0) revert PollHasVotes();
        if (_resolveActor(_owner) != poll.creator) revert NotCreator();

        // Unconditional, unlike createPoll: an empty list here is a clearing, and the helper
        // announces it so an indexer drops the gate it recorded instead of showing it forever
        delete _requirementsOf[_pollId];
        _writeRequirements(_pollId, _requirements, _mode, _allowlistRoot);
    }

    function setHidden(uint256 _pollId, bool _hidden) external override onlyDirectModerator {
        Poll storage poll = _polls[_pollId];
        if (poll.creator == address(0)) revert PollNotFound();

        poll.hidden = _hidden;

        emit PollHiddenSet(_pollId, _hidden, msg.sender);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getPoll(uint256 _pollId) external view override returns (Poll memory) {
        return _polls[_pollId];
    }

    function getTallies(uint256 _pollId) external view override returns (uint32[] memory counts) {
        uint8 optionCount = _polls[_pollId].optionCount;
        counts = new uint32[](optionCount);

        for (uint8 i = 0; i < optionCount; i++) {
            counts[i] = tallies[_pollId][i];
        }
    }

    function voterChoice(uint256 _pollId, address _account) external view override returns (bool voted, uint8 optionIndex) {
        uint8 ballot = _ballots[_pollId][_account];
        if (ballot == 0) return (false, 0);

        return (true, ballot - 1);
    }

    function getRequirements(uint256 _pollId) external view override returns (AssetRequirement[] memory) {
        return _requirementsOf[_pollId];
    }

    function isEligibleToVote(uint256 _pollId, address _account, bytes32[] calldata _proof) external view override returns (bool) {
        return _isEligible(_pollId, _account, _proof);
    }

    function isVotingOpen(uint256 _pollId) external view override returns (bool) {
        Poll storage poll = _polls[_pollId];
        if (poll.creator == address(0)) return false;

        return block.timestamp >= poll.opensAt && block.timestamp < poll.closesAt && poll.closedAt == 0;
    }

    // --- ADMIN CONFIGURATION ---

    function pause() external override onlyDirectAdmin {
        _pause();
    }

    function unpause() external override onlyDirectAdmin {
        _unpause();
    }

    function setHupContract(address _hupAddress) external override onlyDirectAdmin {
        if (_hupAddress == address(0)) revert InvalidAddress();

        address oldValue = address(hupContract);
        hupContract = IHup(_hupAddress);

        emit HupContractUpdated(oldValue, _hupAddress);
    }

    function setTrustedForwarder(address _forwarder, bool _trusted) external override onlyDirectAdmin {
        if (_forwarder == address(0)) revert InvalidAddress();

        trustedForwarders[_forwarder] = _trusted;

        emit TrustedForwarderUpdated(_forwarder, _trusted);
    }

    function setFollowerSystem(address _followerSystem) external override onlyDirectAdmin {
        address oldValue = followerSystem;
        followerSystem = _followerSystem;

        emit FollowerSystemUpdated(oldValue, _followerSystem);
    }

    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external override onlyDirectAdmin {
        if (_maxMetadataBytes == 0 || _maxMetadataBytes > ABSOLUTE_MAX_METADATA_BYTES) revert InvalidMetadataLimit();

        uint256 oldValue = maxMetadataBytes;
        maxMetadataBytes = _maxMetadataBytes;

        emit MaxMetadataBytesUpdated(oldValue, _maxMetadataBytes);
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

    // --- INTERNAL & OVERRIDE HELPERS ---

    /**
     * @dev Assigns the next id and writes the poll itself. Split out of createPoll purely for
     *      stack room — it holds the six values PollCreated carries, which do not fit alongside
     *      the requirement parameters in one frame.
     */
    function _openPoll(
        address _creator,
        string calldata _metadata,
        uint8 _optionCount,
        uint64 _opensAt,
        uint64 _closesAt
    ) private returns (uint256 pollId) {
        pollId = nextPollId++;

        Poll storage poll = _polls[pollId];
        poll.creator = _creator;
        poll.opensAt = _opensAt;
        poll.optionCount = _optionCount;
        poll.closesAt = _closesAt;
        poll.createdAt = uint64(block.timestamp);
        poll.metadata = _metadata;

        emit PollCreated(pollId, _creator, _optionCount, _opensAt, _closesAt, _metadata);
    }

    /**
     * @dev Validates and stores a poll's requirement list, then announces it — always, even
     *      when the list is empty. From setPollRequirements an empty list is a clearing, and
     *      an indexer that never hears about it keeps showing a gate the chain no longer
     *      enforces; createPoll skips the call for an ungated poll instead, so the common
     *      case still pays nothing. Shared by both so they can only ever write a list `vote`
     *      can evaluate: a Merkle root and an Allowlisted entry must come together, since an
     *      entry without a root is a poll nobody can ever vote on, and a root without an
     *      entry is a gate the creator believes exists and the contract never checks.
     */
    function _writeRequirements(
        uint256 _pollId,
        AssetRequirement[] calldata _requirements,
        RequirementMode _mode,
        bytes32 _allowlistRoot
    ) private {
        if (_requirements.length > MAX_POLL_REQUIREMENTS) revert TooManyRequirements();

        bool hasAllowlist;
        for (uint256 i = 0; i < _requirements.length; i++) {
            AssetRequirement calldata r = _requirements[i];
            if (r.rType == RequirementType.TokenBalance || r.rType == RequirementType.NftBalance) {
                if (r.asset == address(0)) revert InvalidAddress();
                // Probe balanceOf at creation so a wrong asset (an ERC-1155, an EOA, a typo) is
                // rejected here with a clear error, rather than surfacing later as a poll that
                // silently refuses every voter.
                (bool ok, ) = _tryBalanceOf(r.asset, _msgSender());
                if (!ok) revert InvalidAsset();
            }
            if (r.rType == RequirementType.CommunityMember && r.asset == address(0)) revert InvalidAddress();
            if (r.rType == RequirementType.Allowlisted) hasAllowlist = true;
            _requirementsOf[_pollId].push(r);
        }
        if (hasAllowlist != (_allowlistRoot != bytes32(0))) revert InvalidAllowlistRoot();

        _polls[_pollId].requirementMode = _mode;
        allowlistRoot[_pollId] = _allowlistRoot;

        emit PollRequirementsSet(_pollId, _mode, _allowlistRoot, _requirements);
    }

    /**
     * @dev The requirement list under its ALL/ANY mode. An empty list means anybody may vote,
     *      which is what almost every poll wants.
     */
    function _isEligible(uint256 _pollId, address _account, bytes32[] calldata _proof) private view returns (bool) {
        AssetRequirement[] storage reqs = _requirementsOf[_pollId];
        uint256 len = reqs.length;
        if (len == 0) return true;

        if (_polls[_pollId].requirementMode == RequirementMode.AnyOf) {
            for (uint256 i = 0; i < len; i++) {
                if (_passesRequirement(_pollId, _account, reqs[i], _proof)) return true;
            }
            return false;
        }

        for (uint256 i = 0; i < len; i++) {
            if (!_passesRequirement(_pollId, _account, reqs[i], _proof)) return false;
        }
        return true;
    }

    /**
     * @dev One requirement entry against one wallet. Every external read is gas-capped and fails
     *      closed (see _tryBalanceOf): a broken asset, a mis-wired registry, or a hostile token
     *      makes the requirement fail, and can never make voting revert for reasons a voter
     *      cannot see. NFT minBalance 0 is kept as "hold any 1".
     */
    function _passesRequirement(
        uint256 _pollId,
        address _account,
        AssetRequirement memory r,
        bytes32[] calldata _proof
    ) private view returns (bool) {
        if (r.rType == RequirementType.NativeBalance) {
            return _account.balance >= r.minBalance;
        }
        if (r.rType == RequirementType.TokenBalance) {
            (bool ok, uint256 balance) = _tryBalanceOf(r.asset, _account);
            return ok && balance >= r.minBalance;
        }
        if (r.rType == RequirementType.NftBalance) {
            uint256 required = r.minBalance == 0 ? 1 : r.minBalance;
            (bool ok, uint256 balance) = _tryBalanceOf(r.asset, _account);
            return ok && balance >= required;
        }
        if (r.rType == RequirementType.Allowlisted) {
            bytes32 root = allowlistRoot[_pollId];
            if (root == bytes32(0)) return false;
            // Double-hashed leaf, per OpenZeppelin's guidance: a single hash over a 20-byte
            // address leaves the tree open to a second-preimage attack through internal nodes.
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(_account))));
            return MerkleProof.verifyCalldata(_proof, root, leaf);
        }
        if (r.rType == RequirementType.CommunityMember) {
            return _isCommunityMember(r.asset, r.minBalance, _account);
        }

        // FollowsCreator
        if (followerSystem == address(0)) return false;
        (bool success, bytes memory data) = followerSystem.staticcall{gas: ASSET_READ_GAS_CAP}(
            abi.encodeCall(ILSP26FollowerSystem.isFollowing, (_account, _polls[_pollId].creator))
        );
        // Decoded as a word, not a bool: abi.decode(bool) panics on any value other than 0/1,
        // which would turn a malformed registry reply into exactly the revert this guards against
        return success && data.length >= 32 && abi.decode(data, (uint256)) == 1;
    }

    /**
     * @dev Reads HupCommunity's public `registry` mapping — an unbanned member passes. The
     *      community contract travels in the requirement itself rather than an admin-set
     *      address, so a HupCommunity redeploy needs no action here and a poll can gate on a
     *      community living at any address the creator names.
     */
    function _isCommunityMember(address _community, uint256 _communityId, address _account) private view returns (bool) {
        (bool success, bytes memory data) = _community.staticcall{gas: ASSET_READ_GAS_CAP}(
            abi.encodeWithSignature("registry(uint256,address)", _communityId, _account)
        );
        // MemberStatus is five bools, returned as five words: isMember, isPending, isModerator,
        // isBanned, canPost. Words again rather than bools, same panic reasoning as above.
        if (!success || data.length < 160) return false;
        (uint256 isMember, , , uint256 isBanned, ) = abi.decode(data, (uint256, uint256, uint256, uint256, uint256));
        return isMember == 1 && isBanned == 0;
    }

    /**
     * @dev Gas-capped balanceOf that reports failure instead of propagating it.
     *      Deliberately a raw staticcall rather than try/catch: try/catch does NOT catch the
     *      revert from calling an address with no code, nor a return-data decoding failure —
     *      exactly what a typo'd, EOA, or ERC-1155 `asset` produces.
     */
    function _tryBalanceOf(address _asset, address _holder) private view returns (bool ok, uint256 balance) {
        (bool success, bytes memory data) = _asset.staticcall{gas: ASSET_READ_GAS_CAP}(abi.encodeCall(IERC20.balanceOf, (_holder)));
        if (!success || data.length < 32) return (false, 0);
        return (true, abi.decode(data, (uint256)));
    }

    /**
     * @dev Reverts unless the metadata CID is present and inside the configured ceiling.
     */
    function _requireValidMetadata(string calldata _metadata) internal view {
        uint256 length = bytes(_metadata).length;
        if (length == 0) revert InvalidMetadata();
        if (length > maxMetadataBytes) revert MetadataTooLarge(length, maxMetadataBytes);
    }

    /**
     * @dev Validates a voting window and resolves the "open now" shorthand.
     * @param _opensAt Requested start; 0 means the current block.
     * @param _closesAt Requested end.
     * @return opensAt The effective start timestamp.
     */
    function _resolveWindow(uint64 _opensAt, uint64 _closesAt) internal view returns (uint64 opensAt) {
        opensAt = _opensAt == 0 ? uint64(block.timestamp) : _opensAt;

        if (opensAt > block.timestamp + MAX_START_DELAY) revert InvalidWindow();
        if (_closesAt <= opensAt) revert InvalidWindow();
        if (_closesAt - opensAt < MIN_DURATION || _closesAt - opensAt > MAX_DURATION) revert InvalidWindow();
    }

    /**
     * @dev Resolves the primary owner address based on burner session rules.
     */
    function _resolveActor(address _owner) internal view returns (address) {
        address sender = _msgSender();

        if (sender == address(0)) revert InvalidAddress();

        if (_owner == address(0) || _owner == sender) {
            return sender;
        }

        (address burnerKey, uint256 expiresAt) = hupContract.userSessions(_owner);
        if (burnerKey != sender) revert Unauthorized();
        if (block.timestamp >= expiresAt) revert SessionExpired();

        return _owner;
    }

    /**
     * @dev See EIP-2771. Returns true if the address is a trusted forwarder.
     */
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupPolls) returns (bool) {
        return trustedForwarders[forwarder];
    }

    /**
     * @dev Returns the original signer of the transaction, supporting meta-transactions.
     */
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    /**
     * @dev Returns the input call data, supporting meta-transactions.
     */
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    /**
     * @dev Returns the context suffix length, supporting meta-transactions.
     */
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
