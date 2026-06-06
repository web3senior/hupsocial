// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Interface for your existing HupCommunity registry.
 */
interface IHupCommunity {
    function communities(uint256 id) external view returns (
        uint256 communityId,
        address creator,
        uint8 membershipType,
        uint8 communityType,
        string calldata metadata
    );
    function isCommunityMember(uint256 communityId, address user) external view returns (bool);
}

/**
 * @dev Interface for your provided Hup Core contract.
 */
interface IHupCore {
    enum ContentType { Post, Comment, Repost }
    
    function create(
        address _owner,
        ContentType _type,
        string calldata _metadata,
        uint256 _parentId,
        bool _allowedComments
    ) external payable returns (uint256);
}

contract HupCommunityFeed {
    IHupCommunity public immutable communityRegistry;
    IHupCore public immutable hupCore;
    
    mapping(uint256 => mapping(uint256 => uint256)) private _communityFeeds;
    mapping(uint256 => uint256) public communityPostCount;
    
    event PostPublished(
        uint256 indexed communityId,
        uint256 indexed globalPostId,
        uint256 indexed localIndex,
        address author
    );

    constructor(address _registryAddress, address _coreAddress) {
        communityRegistry = IHupCommunity(_registryAddress);
        hupCore = IHupCore(_coreAddress);
    }

    /**
     * @notice Validates membership and routes the post to the Hup Core create function.
     * @param communityId The ID of the community from the registry.
     * @param metadata The JSON string (already containing communityId per your requirement).
     */
    function postToCommunity(uint256 communityId, string calldata metadata) external returns (uint256) {
        // Retrieve registry data to check gating rules
        (uint256 registeredId, , uint8 membershipType, , ) = communityRegistry.communities(communityId);
        require(registeredId == communityId, "Community does not exist");

        // Enforce membership checks for non-public spaces
        if (membershipType != 0) {
            require(communityRegistry.isCommunityMember(communityId, msg.sender), "Not a member");
        }

        // Call the core Hup 'create' function
        // Arguments: msg.sender, ContentType.Post (0), metadata, parentId (0), allowComments (true)
        uint256 globalPostId = hupCore.create(
            msg.sender, 
            IHupCore.ContentType.Post, //TODO: get from arg, not static
            metadata, 
            0, 
            true
        );

        // Update local indexing for feed discovery
        uint256 currentLocalIndex = communityPostCount[communityId];
        _communityFeeds[communityId][currentLocalIndex] = globalPostId;
        communityPostCount[communityId] = currentLocalIndex + 1;

        emit PostPublished(communityId, globalPostId, currentLocalIndex, msg.sender);
        return globalPostId;
    }

    function getCommunityFeed(uint256 communityId, uint256 cursor, uint256 size) 
        external view returns (uint256[] memory ids, uint256 nextCursor) 
    {
        uint256 total = communityPostCount[communityId];
        if (total == 0 || cursor == 0) return (new uint256[](0), 0);

        uint256 current = cursor > total ? total : cursor;
        uint256 limit = size > current ? current : size;
        ids = new uint256[](limit);

        for (uint256 i = 0; i < limit; i++) {
            current--;
            ids[i] = _communityFeeds[communityId][current];
        }
        return (ids, current);
    }
}