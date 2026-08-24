// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "./../IHup.sol";

/**
 * @title IHupPolls
 * @author Hup Labs
 * @notice Shared interface for Hup Polls — free, verifiable opinion polls attached to posts.
 *         Anyone opens a poll with two to eight options and an open window; anyone with a
 *         wallet casts exactly one vote before it closes. No money moves, nothing is escrowed,
 *         and nothing is claimable: the whole contract exists so a tally can be counted by
 *         anyone rather than taken on trust.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used
 *      by HupPolls-compatible contracts, clients, and offchain indexers. The metadata field is
 *      an IPFS CID pointing to a JSON document with the shape
 *      { question, options: [{ label, emoji }] } where `options` must contain exactly
 *      `optionCount` entries — option ids are zero-based positions in that array. Only the
 *      tally and the window live onchain; display data lives in the metadata JSON.
 *
 *      A ballot is final. There is no changeVote and no unvote, deliberately: votes are
 *      sponsored by the platform relayer, and a reversible action paid for by someone else is
 *      a faucet. It also means a tally only ever counts up, so an indexer can trust the running
 *      totals carried in VoteCast without re-reading the contract.
 *
 *      A poll may narrow who votes with a requirement list carrying the same AssetRequirement /
 *      RequirementMode shape as HupCommunity. Empty is the norm and costs nothing; the list is
 *      announced separately in PollRequirementsSet so an indexer can ignore the feature until a
 *      poll uses it, and it freezes at the first ballot alongside the question.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 📊
 */
interface IHupPolls {
    // --- SHARED STRUCTS ---

    /// @notice One entry of a poll's composable requirement list. Deliberately the same shape
    ///         as HupCommunity's, so a wallet that understands one understands the other.
    enum RequirementType {
        NativeBalance, // hold >= minBalance of the chain's native coin (asset ignored)
        TokenBalance, // hold >= minBalance of an ERC-20/LSP7 at `asset`
        NftBalance, // hold >= minBalance (0 => 1) of an ERC-721/LSP8 collection at `asset`
        Allowlisted, // be a leaf of the poll's Merkle allowlist (asset/minBalance ignored)
        FollowsCreator, // follow the creator on the LSP26 registry (asset/minBalance ignored)
        CommunityMember // be an unbanned member of the community at `asset`, id `minBalance`
    }

    /// @notice How the requirement list combines: every entry must pass, or any one suffices.
    enum RequirementMode {
        AllOf,
        AnyOf
    }

    struct AssetRequirement {
        RequirementType rType;
        address asset;
        uint256 minBalance;
    }

    /// @dev Defines the structure for a single poll. Only fields the contract or an indexer must
    ///      trust live onchain — the question and option labels live in the metadata JSON.
    struct Poll {
        address creator; // Address of the poll creator, set once at creation
        uint64 opensAt; // Before this unix UTC time no votes are accepted
        uint8 optionCount; // Number of options; ids are 0..optionCount-1
        bool hidden; // Moderator flag — indexers and clients suppress the poll, tallies unaffected
        uint64 closesAt; // After this unix UTC time no votes are accepted
        uint64 closedAt; // When the creator closed voting early; 0 while running its full window
        uint64 createdAt; // Block time the poll was opened
        uint32 totalVotes; // Ballots cast across every option
        RequirementMode requirementMode; // How this poll's requirement list combines
        string metadata; // IPFS CID of the poll JSON (length-capped)
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when a creator opens a new poll. `createdAt` is the block's own
    ///         timestamp, which every indexer already has from the block header.
    event PollCreated(uint256 indexed pollId, address indexed creator, uint8 optionCount, uint64 opensAt, uint64 closesAt, string metadata);

    /// @notice Emitted on every ballot. Carries the running totals so an indexer can keep a
    ///         tally current from the log alone — votes are final, so these only ever grow.
    event VoteCast(uint256 indexed pollId, address indexed voter, uint8 optionIndex, uint32 optionVotes, uint32 totalVotes);

    /// @notice Emitted whenever a poll's electorate is defined — at creation when the list is
    ///         non-empty, and again on any pre-vote correction. Kept off PollCreated so the
    ///         common ungated poll pays neither the log nor the indexer a requirement column.
    event PollRequirementsSet(uint256 indexed pollId, RequirementMode mode, bytes32 allowlistRoot, AssetRequirement[] requirements);

    /// @notice Emitted when the creator ends voting before the poll's window is up.
    event PollClosedEarly(uint256 indexed pollId, address indexed creator, uint64 closedAt);

    /// @notice Emitted when the admin repoints the LSP26 registry backing FollowsCreator.
    event FollowerSystemUpdated(address oldValue, address newValue);

    /// @notice Emitted when a creator corrects a poll before anyone has voted on it.
    event PollMetadataUpdated(uint256 indexed pollId, uint8 optionCount, string metadata);

    /// @notice Emitted when a moderator hides or unhides a poll.
    event PollHiddenSet(uint256 indexed pollId, bool hidden, address indexed moderator);

    /// @notice Emitted when the admin repoints the Hup Core reference used for session lookups.
    event HupContractUpdated(address oldValue, address newValue);

    /// @notice Emitted when the admin changes the metadata length ceiling.
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when a trusted forwarder is added or removed.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidOptionCount();
    error InvalidOption();
    error InvalidWindow();
    error InvalidMetadata();
    error MetadataTooLarge(uint256 length, uint256 maxLength);
    error InvalidMetadataLimit();
    error PollNotFound();
    error NotCreator();
    error PollHasVotes();
    error VotingNotOpen();
    error VotingClosed();
    error AlreadyVoted();
    error Unauthorized();
    error SessionExpired();
    error TooManyRequirements();
    error InvalidAsset();
    error NotEligible();

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Opens a poll.
     * @param _owner Primary wallet the poll is attributed to (address(0) or the caller for a direct call).
     * @param _metadata IPFS CID of the poll JSON carrying the question and option labels.
     * @param _optionCount Number of options; ids are 0..optionCount-1.
     * @param _opensAt Unix UTC time voting opens; 0 opens immediately.
     * @param _closesAt Unix UTC time voting closes.
     * @param _requirements Who may vote; an empty list means anyone with a wallet.
     * @param _mode Whether every requirement must pass or any one suffices.
     * @param _allowlistRoot Merkle root over eligible voters, for an Allowlisted entry; 0 if unused.
     * @return pollId The id assigned to the new poll.
     */
    function createPoll(
        address _owner,
        string calldata _metadata,
        uint8 _optionCount,
        uint64 _opensAt,
        uint64 _closesAt,
        AssetRequirement[] calldata _requirements,
        RequirementMode _mode,
        bytes32 _allowlistRoot
    ) external returns (uint256 pollId);

    /**
     * @notice Casts the caller's single, final ballot on a poll.
     * @param _owner Primary wallet the vote is attributed to (address(0) or the caller for a direct call).
     * @param _pollId The poll being voted on.
     * @param _optionIndex Zero-based option id.
     * @param _proof Merkle proof of allowlist membership; empty for a poll without one.
     */
    function vote(address _owner, uint256 _pollId, uint8 _optionIndex, bytes32[] calldata _proof) external;

    /**
     * @notice Replaces a poll's electorate. Creator only, and only before the first ballot —
     *         an electorate that could move after votes land would let a creator retroactively
     *         invalidate people who already voted.
     * @param _owner Primary wallet of the creator (address(0) or the caller for a direct call).
     * @param _pollId The poll to re-gate.
     * @param _requirements Replacement requirement list.
     * @param _mode Replacement combination mode.
     * @param _allowlistRoot Replacement Merkle root; 0 to clear.
     */
    function setPollRequirements(
        address _owner,
        uint256 _pollId,
        AssetRequirement[] calldata _requirements,
        RequirementMode _mode,
        bytes32 _allowlistRoot
    ) external;

    /**
     * @notice Ends voting early. Creator only.
     * @param _owner Primary wallet of the creator (address(0) or the caller for a direct call).
     * @param _pollId The poll to close.
     */
    function closePoll(address _owner, uint256 _pollId) external;

    /**
     * @notice Corrects a poll's question, labels, or option count before the first vote lands.
     * @param _owner Primary wallet of the creator (address(0) or the caller for a direct call).
     * @param _pollId The poll to correct.
     * @param _optionCount Replacement option count.
     * @param _metadata Replacement IPFS CID.
     */
    function updatePollMetadata(address _owner, uint256 _pollId, uint8 _optionCount, string calldata _metadata) external;

    /**
     * @notice Hides or unhides a poll. Moderator only; tallies and voting are unaffected.
     * @param _pollId The poll to flag.
     * @param _hidden True to hide.
     */
    function setHidden(uint256 _pollId, bool _hidden) external;

    // --- VIEW FUNCTIONS ---

    /// @notice Contract version string.
    function version() external pure returns (string memory);

    /// @notice Full poll record, including the metadata CID.
    function getPoll(uint256 _pollId) external view returns (Poll memory);

    /// @notice Every option's vote count, indexed by option id.
    function getTallies(uint256 _pollId) external view returns (uint32[] memory counts);

    /// @notice Vote count for a single option.
    function tallies(uint256 _pollId, uint8 _optionIndex) external view returns (uint32);

    /**
     * @notice An account's ballot on a poll.
     * @return voted True once the account has voted.
     * @return optionIndex The option they chose; meaningless while `voted` is false.
     */
    function voterChoice(uint256 _pollId, address _account) external view returns (bool voted, uint8 optionIndex);

    /// @notice True when the poll is inside its window and has not been closed early.
    function isVotingOpen(uint256 _pollId) external view returns (bool);

    /// @notice A poll's requirement list. Empty means anyone with a wallet may vote.
    function getRequirements(uint256 _pollId) external view returns (AssetRequirement[] memory);

    /// @notice Merkle root over the poll's allowlisted voters; 0 when it has none.
    function allowlistRoot(uint256 _pollId) external view returns (bytes32);

    /**
     * @notice Whether an account passes a poll's requirement list right now. Says nothing about
     *         whether they have already voted or the poll is open — those are separate checks.
     * @param _proof Merkle proof of allowlist membership; empty when the poll has no allowlist.
     */
    function isEligibleToVote(uint256 _pollId, address _account, bytes32[] calldata _proof) external view returns (bool);

    /// @notice The LSP26 registry backing FollowsCreator; address(0) means that type fails closed.
    function followerSystem() external view returns (address);

    /// @notice The id the next poll will receive; ids start at 1, so 0 means "not found".
    function nextPollId() external view returns (uint256);

    /// @notice The maximum allowed byte length for a poll's metadata field.
    function maxMetadataBytes() external view returns (uint256);

    /// @notice True when the address is a registered ERC2771 forwarder.
    function trustedForwarders(address _forwarder) external view returns (bool);

    /// @dev See EIP-2771.
    function isTrustedForwarder(address _forwarder) external view returns (bool);

    // --- ADMIN CONFIGURATION ---

    function pause() external;

    function unpause() external;

    function setHupContract(address _hupAddress) external;

    function setTrustedForwarder(address _forwarder, bool _trusted) external;

    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external;

    function setFollowerSystem(address _followerSystem) external;
}
