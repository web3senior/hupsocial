// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

/**
 * @title IHupCommunity
 * @author Hup Labs
 * @notice Shared interface for the Hup community protocol.
 * @dev Defines the protocol's public enums, structs, events, and custom errors, plus the narrow
 *      set of hooks other Hup extension contracts call into HupCommunity for. Deliberately does
 *      not mirror every HupCommunity function (e.g. the auto-generated `communities()` getter is
 *      omitted since its enum-typed fields aren't type-identical to a uint8-based declaration here).
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💬
 */
/**
 * @notice Escape hatch for eligibility logic the built-in requirement list can't express
 *         (nested boolean conditions, offchain-attested scores, cross-community state, ...).
 *         A community may point at a module implementing this; see HupCommunity.isEligible.
 */
interface IHupEligibilityModule {
    function isEligible(uint256 communityId, address actor) external view returns (bool);
}

interface IHupCommunity {
    // --- SHARED ENUMS & STRUCTS ---

    /// @notice How wallets get onto the roster. Orthogonal to the requirement list (what they
    ///         must hold/be) and to content encryption (keyVersion > 0) — the three axes the
    ///         old MembershipType enum conflated.
    enum AdmissionMode {
        Open, // join() admits anyone
        RequestApproval, // join() files a request; a moderator approves
        InviteOnly, // moderators invite; the wallet accepts (consent handshake)
        SelfServeIfEligible, // join() admits instantly iff the requirement list passes
        PayToJoin // join() collects paymentRequirements, then admits
    }

    enum CommunityType {
        Discussion,
        Broadcast
    }

    /// @notice One entry of a community's composable requirement list.
    enum RequirementType {
        NativeBalance, // hold >= minBalance of the chain's native coin (asset ignored)
        TokenBalance, // hold >= minBalance of an ERC-20/LSP7 at `asset`
        NftBalance, // hold >= minBalance (0 => 1) of an ERC-721/LSP8 collection at `asset`
        Whitelisted, // be on the community's whitelist (asset/minBalance ignored)
        FollowsCreator // follow the creator on the LSP26 registry (asset/minBalance ignored)
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

    struct MemberStatus {
        bool isMember;
        bool isPending;
        bool isModerator;
        bool isBanned;
        bool canPost; // New permission bit for read-only
    }

    struct PaymentRequirement {
        address token; // Use address(0) for native coin
        uint256 price;
        bool isLsp7; // If token is set, selects LSP7's transfer(from,to,amount,force,data) over
                     // ERC-20's transferFrom — the two are not selector-compatible for transfers
                     // (unlike balanceOf, which is why TokenRequirement doesn't need this flag)
    }

    // --- SHARED EVENTS ---

    // NOTE: AdmissionMode encodes as uint8 exactly like the old MembershipType did, so the
    // CommunityCreated/CommunityUpdated selectors are unchanged and existing indexers keep
    // decoding them — only the value's meaning shifted from "membership type" to "admission mode".
    event CommunityCreated(uint256 indexed id, address indexed creator, AdmissionMode admission);
    event MemberStatusUpdated(uint256 indexed id, address indexed actor, bool isMember);
    event ModeratorUpdated(uint256 indexed id, address indexed actor, bool isModerator);
    event UnattributedDeposit(address indexed from, uint256 amount);
    event FeeUpdated(uint256 oldValue, uint256 newValue);
    event CommunityUpdated(uint256 indexed id, AdmissionMode admission, CommunityType cType, string metadata);
    event RequirementsUpdated(uint256 indexed id, RequirementMode mode, uint256 count);
    event EligibilityModuleUpdated(uint256 indexed id, address module);
    event PaymentRequirementUpdated(uint256 indexed id, address token, uint256 price, bool isLsp7);
    /// @notice The creator pointed the community's join fees at a new destination — a wallet or
    ///         a contract (Safe, DAO, splitter) with its own rules. address(0) means cleared:
    ///         fees go to the creator again.
    event PayoutDestinationUpdated(uint256 indexed id, address indexed destination);
    event CommunityStatusUpdated(uint256 indexed id, bool isActive);
    event CommunityOwnershipTransferStarted(uint256 indexed id, address indexed oldCreator, address indexed newCreator);
    event CommunityOwnershipTransferred(uint256 indexed id, address indexed oldCreator, address indexed newCreator);
    event CommunityGovernorUpdated(uint256 indexed id, address indexed governor);
    /// @notice A wallet filed a join request against a RequestApproval community (join() setting
    ///         isPending). Without this, a pending request left no trace in the log at all and the
    ///         moderator queue could only be reconstructed offchain. Any later MemberStatusUpdated
    ///         for the same (id, actor) resolves the request — approveRequest emits it with
    ///         isMember true, rejectRequest with the wallet's unchanged (false) membership.
    event MembershipRequested(uint256 indexed id, address indexed actor);
    event MemberInvited(uint256 indexed id, address indexed actor);
    event InviteRevoked(uint256 indexed id, address indexed actor);
    event Withdrawal(address indexed recipient, uint256 amount);
    event IdentityKeyRegistered(address indexed user);
    event KeyInitialized(uint256 indexed communityId);
    event KeyGranted(uint256 indexed communityId, address indexed holder, uint256 indexed version);
    event KeyRotated(uint256 indexed communityId, uint256 indexed newVersion);
    event HistoryVisibilityUpdated(uint256 indexed communityId, bool visible);
    event KeyBacklinkPublished(uint256 indexed communityId, uint256 indexed version);
    event WhitelistUpdated(uint256 indexed id, address indexed actor, bool isWhitelisted);
    event CreationLimitsUpdated(uint256 cooldown, uint256 maxPerWallet);
    event MembershipPaid(uint256 indexed id, address indexed payer, address token, uint256 amount);
    event FollowerSystemUpdated(address oldValue, address newValue);

    // --- SHARED ERRORS ---

    error Unauthorized();
    error InsufficientFee();
    error InvalidAddress();
    error AlreadyMember();
    error Banned();
    error CommunityDoesNotExist();
    error CommunityInactive();
    error NotPendingCreator();
    error TransferFailed();
    error AlreadyInitialized();
    error NotInitialized();
    error NotMember();
    error BatchTooLarge();
    error MetadataTooLong();
    error CreationCooldownActive();
    error MaxCommunitiesReached();
    error IncorrectPaymentAmount();
    error PaymentNotConfigured();
    error PriceExceedsMax();
    error ArrayLengthMismatch();
    error InvalidKeyVersion();
    error BacklinkAlreadyPublished();
    error NotInvited();
    error NoPendingRequest();
    error NotEligible();
    error TooManyRequirements();
    error InvalidAsset();
    error NothingToWithdraw();
    error IdentityNotRegistered();

    // --- SHARED HOOKS ---

    function version() external pure returns (string memory);
    function canPost(address actor, uint256 communityId) external view returns (bool);
    function updateCommunity(uint256 _id, AdmissionMode _admission, CommunityType _communityType, string calldata _metadata) external;

    // --- STATE GETTERS ---

    // Auto-generated getter for HupCommunity's public `registry` mapping (bools only, so this
    // is type-identical to the real getter and safe to add here, unlike `communities()`).
    function registry(uint256 id, address user) external view returns (bool isMember, bool isPending, bool isModerator, bool isBanned, bool canPost);
}
