// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IHupCommunity
 * @notice Shared interface for community management and access control.
 */
interface IHupCommunity {
    enum MembershipType { Public, RequestBased, Private }

    struct MemberStatus {
        bool isMember;
        bool isPending;
        bool isModerator;
        bool isBanned;
    }

    event CommunityCreated(uint256 indexed id, address indexed creator, MembershipType mType);
    event MemberStatusUpdated(uint256 indexed id, address indexed actor, bool isMember);
    event UnattributedDeposit(address indexed from, uint256 amount);
    event FeeUpdated(uint256 oldValue, uint256 newValue);

    error Unauthorized();
    error InsufficientFee();
    error InvalidAddress();
    error AlreadyMember();
    error Banned();

    function canPost(address actor, uint256 communityId) external view returns (bool);
}