// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IHupCommunity
 * @notice Shared interface for community management and access control.
 */
interface IHupCommunity {
    enum MembershipType {
        Public,
        RequestBased,
        Private,
        NftGated,
        TokenGated
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

    event CommunityCreated(uint256 indexed id, address indexed creator, MembershipType mType);
    event MemberStatusUpdated(uint256 indexed id, address indexed actor, bool isMember);
    event ModeratorUpdated(uint256 indexed id, address indexed actor, bool isModerator);
    event UnattributedDeposit(address indexed from, uint256 amount);
    event FeeUpdated(uint256 oldValue, uint256 newValue);
    event CommunityUpdated(uint256 indexed id, MembershipType mType, string metadata);

    error Unauthorized();
    error InsufficientFee();
    error InvalidAddress();
    error AlreadyMember();
    error Banned();
    error CommunityDoesNotExist();

    function canPost(address actor, uint256 communityId) external view returns (bool);
    function updateCommunity(uint256 _id, MembershipType _type, string calldata _metadata) external;
}
