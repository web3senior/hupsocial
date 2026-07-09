// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

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
interface IHupCommunity {
    // --- SHARED ENUMS & STRUCTS ---

    enum MembershipType {
        Public,
        RequestBased,
        Private,
        NftGated,
        TokenGated,
        NftAndTokenGated,
        WhitelistGated,
        PaidGated,
        FollowerGated
    }

    enum CommunityType {
        Discussion,
        Broadcast
    }

    struct MemberStatus {
        bool isMember;
        bool isPending;
        bool isModerator;
        bool isBanned;
        bool canPost; // New permission bit for read-only
    }

    struct NftRequirement {
        address nftAddress;
        uint256 tokenId; // Set to 0 if any token in the collection is valid
    }

    struct TokenRequirement {
        address tokenAddress; // Use address(0) for native token
        uint256 minBalance;
    }

    struct PaymentRequirement {
        address token; // Use address(0) for native coin
        uint256 price;
        bool isLsp7; // If token is set, selects LSP7's transfer(from,to,amount,force,data) over
                     // ERC-20's transferFrom — the two are not selector-compatible for transfers
                     // (unlike balanceOf, which is why TokenRequirement doesn't need this flag)
    }

    // --- SHARED EVENTS ---

    event CommunityCreated(uint256 indexed id, address indexed creator, MembershipType mType);
    event MemberStatusUpdated(uint256 indexed id, address indexed actor, bool isMember);
    event ModeratorUpdated(uint256 indexed id, address indexed actor, bool isModerator);
    event UnattributedDeposit(address indexed from, uint256 amount);
    event FeeUpdated(uint256 oldValue, uint256 newValue);
    event CommunityUpdated(uint256 indexed id, MembershipType mType, CommunityType cType, string metadata);
    event CommunityStatusUpdated(uint256 indexed id, bool isActive);
    event CommunityOwnershipTransferStarted(uint256 indexed id, address indexed oldCreator, address indexed newCreator);
    event CommunityOwnershipTransferred(uint256 indexed id, address indexed oldCreator, address indexed newCreator);
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
    error NotWhitelisted();
    error BatchTooLarge();
    error MetadataTooLong();
    error CreationCooldownActive();
    error MaxCommunitiesReached();
    error IncorrectPaymentAmount();
    error PaymentNotConfigured();
    error ArrayLengthMismatch();
    error InvalidKeyVersion();
    error BacklinkAlreadyPublished();

    // --- SHARED HOOKS ---

    function version() external pure returns (string memory);
    function canPost(address actor, uint256 communityId) external view returns (bool);
    function updateCommunity(uint256 _id, MembershipType _type, CommunityType _communityType, string calldata _metadata) external;

    // --- STATE GETTERS ---

    // Auto-generated getter for HupCommunity's public `registry` mapping (bools only, so this
    // is type-identical to the real getter and safe to add here, unlike `communities()`).
    function registry(uint256 id, address user) external view returns (bool isMember, bool isPending, bool isModerator, bool isBanned, bool canPost);
}
