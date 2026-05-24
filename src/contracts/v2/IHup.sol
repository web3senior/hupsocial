// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IHup
 * @author Hup Labs
 * @notice Shared interface for the Hup core social protocol.
 * @dev Defines the protocol's public enums, structs, events, custom errors, and read interface used
 *      by Hup-compatible contracts and off-chain indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 📜
 */
interface IHup {
    // --- SHARED ENUMS & STRUCTS ---

    enum ContentType {
        Post,
        Comment,
        Repost
    }

    struct ContentView {
        uint256 id;
        ContentType cType;
        string metadata;
        uint256 parentId;
        uint256 createdAt;
        address creator;
        uint256 likeCount;
        uint256 commentCount;
        uint256 repostCount;
        bool isDeleted;
        bool isUpdated;
        bool allowedComments;
        bool hasLiked;
    }

    struct Session {
        address burnerKey;
        uint256 expiresAt;
    }

    // --- SHARED EVENTS ---

    event ContentCreated(uint256 indexed id, address indexed creator, ContentType indexed cType, uint256 parentId);
    event ContentUpdated(uint256 indexed id, address indexed creator, string metadata);
    event ContentDeleted(uint256 indexed id, address indexed deleter);
    event ContentLiked(uint256 indexed id, address indexed liker, address indexed creator);
    event ContentUnliked(uint256 indexed id, address indexed unliker, address indexed creator);
    event SessionAuthorized(address indexed primaryWallet, address indexed burnerKey, uint256 expiresAt);
    event SessionRevoked(address indexed primaryWallet, address indexed burnerKey);
    event Withdrawal(address indexed recipient, uint256 amount);
    event FeeUpdated(uint256 oldValue, uint256 newValue);
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);

    // --- SHARED ERRORS ---

    error Unauthorized();
    error ContentNotFound();
    error ContentDeletedError();
    error InsufficientFee();
    error InteractionNotAllowed();
    error TransferFailed();
    error InvalidIndex();
    error InputEmpty();
    error SessionExpired();
    error MetadataTooLarge(uint256 length, uint256 maxLength);
    error InvalidAddress();
    error InvalidDuration();
    error InvalidMetadataLimit();

    // --- CORE VIEW SPECIFICATIONS ---

    function contentCount() external view returns (uint256);

    function getContent(
        uint256 _id
    )
        external
        view
        returns (
            uint8 cType,
            string memory metadata,
            uint256 parentId,
            uint256 createdAt,
            address creator,
            uint256 likeCount,
            uint256 commentCount,
            uint256 repostCount,
            bool isDeleted,
            bool isUpdated,
            bool allowedComments
        );

    function getFeed(uint256 _startIndex, uint256 _count, address _viewer) external view returns (ContentView[] memory);

    function getCreatorContentCount(address _creator) external view returns (uint256);

    function getContentsByCreator(
        address _creator,
        uint256 _startIndex,
        uint256 _count,
        address _viewer
    ) external view returns (ContentView[] memory);

    function getComments(
        uint256 _parentId,
        uint256 _startIndex,
        uint256 _count,
        address _viewer
    ) external view returns (ContentView[] memory);

    function getReposts(
        uint256 _parentId,
        uint256 _startIndex,
        uint256 _count,
        address _viewer
    ) external view returns (ContentView[] memory);
}