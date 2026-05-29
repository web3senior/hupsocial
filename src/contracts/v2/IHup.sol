// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IHup
 * @author Hup Labs
 * @notice Shared interface for the Hup core social protocol.
 * @dev Defines the protocol's public enums, structs, events, custom errors, and public interface used
 *      by Hup-compatible contracts, clients, and off-chain indexers.
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

    event ContentCreated(uint256 indexed id, address indexed creator, ContentType indexed cType, uint256 parentId, string metadata, bool allowedComments, uint256 createdAt);
    event ContentUpdated(uint256 indexed id, address indexed creator, string metadata, bool allowedComments);
    event ContentDeleted(uint256 indexed id, address indexed deleter, ContentType indexed cType, uint256 parentId);
    event ContentLiked(uint256 indexed id, address indexed liker, address indexed creator);
    event ContentUnliked(uint256 indexed id, address indexed unliker, address indexed creator);
    event SessionAuthorized(address indexed primaryWallet, address indexed burnerKey, uint256 expiresAt);
    event SessionRevoked(address indexed primaryWallet, address indexed burnerKey);
    event Withdrawal(address indexed recipient, uint256 amount);
    event FeeUpdated(uint256 oldValue, uint256 newValue);
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);
    event UnattributedDeposit(address indexed from, uint256 amount);

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
    error RepostMetadataNotAllowed();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function ADMIN_ROLE() external view returns (bytes32);
    function ABSOLUTE_MAX_METADATA_BYTES() external view returns (uint256);
    function MAX_BATCH_LIKE_COUNT() external view returns (uint256);
    function MAX_BATCH_READ_COUNT() external view returns (uint256);
    function contentCount() external view returns (uint256);
    function fee() external view returns (uint256);
    function maxMetadataBytes() external view returns (uint256);
    function trustedForwarders(address forwarder) external view returns (bool);
    function contentLikedBy(uint256 id, address user) external view returns (bool);
    function contentRepostedBy(uint256 id, address user) external view returns (bool);
    function creatorContent(address creator, uint256 index) external view returns (uint256);
    function userSessions(address owner) external view returns (address burnerKey, uint256 expiresAt);
    function isTrustedForwarder(address forwarder) external view returns (bool);

    // --- SESSION MANAGEMENT ---

    function authorizeSession(address _burnerKey, uint256 _duration) external;
    function revokeSession() external;

    // --- CORE MUTATIVE LOGIC ---

    function create(address _owner, ContentType _type, string calldata _metadata, uint256 _parentId, bool _allowedComments) external payable returns (uint256);

    function update(address _owner, uint256 _id, string calldata _metadata, bool _allowedComments) external returns (bool);

    function deleteContent(address _owner, uint256 _id) external;

    // --- LIKE INTERACTIONS ---

    function like(address _owner, uint256 _id) external;

    /**
     * @notice Likes multiple content items in one transaction.
     * @dev Reverts if `_ids.length` is zero or greater than `MAX_BATCH_LIKE_COUNT`.
     */
    function batchLike(address _owner, uint256[] calldata _ids) external;

    function unlike(address _owner, uint256 _id) external;

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Returns content by ID using the same struct shape as feed responses.
     * @dev Deleted content is returned as a tombstone with empty metadata and `isDeleted == true`.
     */
    function getContent(uint256 _id, address _viewer) external view returns (ContentView memory);

    function getContents(uint256[] calldata _ids, address _viewer) external view returns (ContentView[] memory result);

    /**
     * @notice Returns reverse-chronological activity feed entries using offset pagination.
     * @dev Includes posts, comments, and reposts. Prefer `getFeedBefore` for stable pagination.
     */
    function getFeed(uint256 _startIndex, uint256 _count, address _viewer) external view returns (ContentView[] memory);

    /**
     * @notice Returns reverse-chronological activity feed entries using a stable content ID cursor.
     * @dev Includes posts, comments, and reposts. Use `_cursorId == 0` for the first page.
     */
    function getFeedBefore(uint256 _cursorId, uint256 _count, address _viewer) external view returns (ContentView[] memory batch, uint256 nextCursor);

    /**
     * @notice Returns reverse-chronological top-level posts using a stable content ID cursor.
     * @dev Excludes comments and reposts. Use `_cursorId == 0` for the first page.
     */
    function getPostsFeedBefore(uint256 _cursorId, uint256 _count, address _viewer) external view returns (ContentView[] memory batch, uint256 nextCursor);

    function getCreatorContentCount(address _creator) external view returns (uint256);

    /**
     * @notice Returns reverse-chronological content by creator using offset pagination.
     * @dev Includes posts, comments, and reposts. Prefer `getContentsByCreatorBefore` for stable pagination.
     */
    function getContentsByCreator(address _creator, uint256 _startIndex, uint256 _count, address _viewer) external view returns (ContentView[] memory);

    /**
     * @notice Returns reverse-chronological content by creator using a stable content ID cursor.
     * @dev Includes posts, comments, and reposts. Use `_cursorId == 0` for the first page.
     */
    function getContentsByCreatorBefore(
        address _creator,
        uint256 _cursorId,
        uint256 _count,
        address _viewer
    ) external view returns (ContentView[] memory result, uint256 nextCursor);

    function getComments(uint256 _parentId, uint256 _startIndex, uint256 _count, address _viewer) external view returns (ContentView[] memory);

    function getReposts(uint256 _parentId, uint256 _startIndex, uint256 _count, address _viewer) external view returns (ContentView[] memory);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setFee(uint256 _fee) external;

    /**
     * @notice Updates the maximum allowed metadata byte length.
     * @dev Applies only to future create/update calls. Existing content is not modified.
     */
    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external;

    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    function withdrawAll(address payable _receiver) external;
}
