// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./IHup.sol";

/**
 * @title Hup Core Protocol
 * @author Hup Labs
 * @notice Minimal on-chain social protocol for posts, comments, reposts, likes, and session-based actions.
 * @dev Uses IHup for shared events, errors, enums, and view structs. Supports rotatable ERC2771 trusted
 *      forwarders for meta-transactions, AccessControl for admin permissions, Pausable for emergency
 *      controls, and ReentrancyGuard for protected payable flows. Rich discovery, search, feeds,
 *      bookmarks, views, and global post routing are expected to be handled off-chain by indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💬
 */
contract Hup is IHup, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    struct ContentData {
        string metadata;
        uint256 parentId;
        uint256 createdAt;
        uint256 likeCount;
        uint256 commentCount;
        uint256 repostCount;
        address creator;
        ContentType cType;
        bool isDeleted;
        bool isUpdated;
        bool allowedComments;
    }

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2048;
    uint256 public constant MAX_BATCH_LIKE_COUNT = 50;
    uint256 public constant MAX_BATCH_READ_COUNT = 100;

    uint256 public contentCount;
    uint256 public fee = 0 ether;
    uint256 public maxMetadataBytes = 256;

    mapping(address => bool) public trustedForwarders;
    mapping(uint256 => ContentData) private allContent;
    mapping(uint256 => mapping(address => bool)) public contentLikedBy;
    mapping(uint256 => mapping(address => bool)) public contentRepostedBy;
    mapping(address => uint256[]) public creatorContent;
    mapping(address => Session) public userSessions;
    uint256[] private _postIds;
    mapping(uint256 => uint256[]) private _comments;
    mapping(uint256 => uint256[]) private _reposts;

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    constructor(address _trustedForwarder, address _admin) ERC2771Context(_trustedForwarder) {
        if (_admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        if (_trustedForwarder != address(0)) {
            trustedForwarders[_trustedForwarder] = true;
            emit TrustedForwarderUpdated(_trustedForwarder, true);
        }
    }

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function authorizeSession(address _burnerKey, uint256 _duration) external whenNotPaused {
        if (_burnerKey == address(0)) revert InvalidAddress();
        if (_duration == 0) revert InvalidDuration();

        uint256 expiry = block.timestamp + _duration;
        userSessions[_msgSender()] = Session({burnerKey: _burnerKey, expiresAt: expiry});

        emit SessionAuthorized(_msgSender(), _burnerKey, expiry);
    }

    function revokeSession() external {
        address currentBurner = userSessions[_msgSender()].burnerKey;
        delete userSessions[_msgSender()];

        emit SessionRevoked(_msgSender(), currentBurner);
    }

    function create(
        address _owner,
        ContentType _type,
        string calldata _metadata,
        uint256 _parentId,
        bool _allowedComments
    ) external payable whenNotPaused nonReentrant returns (uint256) {
        address actor = _resolveActor(_owner);
        uint256 metadataLength = bytes(_metadata).length;

        if (fee > 0 && msg.value < fee) revert InsufficientFee();
        if (_type != ContentType.Repost && metadataLength == 0) revert InputEmpty();
        if (metadataLength > maxMetadataBytes) {
            revert MetadataTooLarge(metadataLength, maxMetadataBytes);
        }

        if (_type == ContentType.Post) {
            if (_parentId != 0) revert InvalidIndex();
        } else {
            ContentData storage parent = allContent[_parentId];
            if (parent.creator == address(0)) revert ContentNotFound();
            if (parent.isDeleted) revert ContentDeletedError();

            if (_type == ContentType.Comment && !parent.allowedComments) {
                revert InteractionNotAllowed();
            }

            if (_type == ContentType.Repost && contentRepostedBy[_parentId][actor]) {
                revert InteractionNotAllowed();
            }
        }

        return _createInternal(actor, _type, _metadata, _parentId, _allowedComments);
    }

    function update(address _owner, uint256 _id, string calldata _metadata, bool _allowedComments) external whenNotPaused returns (bool) {
        address actor = _resolveActor(_owner);
        ContentData storage item = allContent[_id];

        if (item.creator == address(0)) revert ContentNotFound();
        if (item.creator != actor) revert Unauthorized();
        if (item.isDeleted) revert ContentDeletedError();
        if (item.cType == ContentType.Repost) revert InteractionNotAllowed();

        uint256 metadataLength = bytes(_metadata).length;
        if (metadataLength == 0) revert InputEmpty();
        if (metadataLength > maxMetadataBytes) {
            revert MetadataTooLarge(metadataLength, maxMetadataBytes);
        }

        item.metadata = _metadata;
        item.allowedComments = _allowedComments;
        item.isUpdated = true;

        emit ContentUpdated(_id, actor, _metadata);
        return true;
    }

    function deleteContent(address _owner, uint256 _id) external whenNotPaused {
        address actor = _resolveActor(_owner);
        ContentData storage item = allContent[_id];

        if (item.creator == address(0)) revert ContentNotFound();
        if (item.creator != actor) revert Unauthorized();
        if (item.isDeleted) revert ContentDeletedError();

        uint256 parentId = item.parentId;
        ContentType cType = item.cType;

        item.metadata = "";
        item.isDeleted = true;

        if (parentId != 0) {
            if (cType == ContentType.Comment && allContent[parentId].commentCount > 0) {
                allContent[parentId].commentCount--;
            }

            if (cType == ContentType.Repost && allContent[parentId].repostCount > 0) {
                allContent[parentId].repostCount--;
                contentRepostedBy[parentId][actor] = false;
            }
        }

        emit ContentDeleted(_id, actor);
    }

    function like(address _owner, uint256 _id) external whenNotPaused {
        address actor = _resolveActor(_owner);
        _like(actor, _id);
    }

    /**
     * @notice Likes multiple content items in one transaction.
     * @dev Reverts if `_ids.length` is zero or greater than `MAX_BATCH_LIKE_COUNT`.
     */
    function batchLike(address _owner, uint256[] calldata _ids) external whenNotPaused {
        address actor = _resolveActor(_owner);
        uint256 length = _ids.length;

        if (length == 0 || length > MAX_BATCH_LIKE_COUNT) revert InvalidIndex();

        for (uint256 i = 0; i < length; i++) {
            _like(actor, _ids[i]);
        }
    }

    function unlike(address _owner, uint256 _id) external whenNotPaused {
        address actor = _resolveActor(_owner);
        _unlike(actor, _id);
    }

    function getContent(uint256 _id, address _viewer) external view override returns (ContentView memory) {
        if (_id == 0 || _id > contentCount) revert InvalidIndex();

        return _formatView(_id, _viewer);
    }

    function getContents(uint256[] calldata _ids, address _viewer) external view override returns (ContentView[] memory result) {
        uint256 length = _ids.length;

        if (length == 0 || length > MAX_BATCH_READ_COUNT) revert InvalidIndex();

        result = new ContentView[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 id = _ids[i];

            if (id == 0 || id > contentCount) revert InvalidIndex();

            result[i] = _formatView(id, _viewer);
        }
    }

    function getFeed(uint256 _startIndex, uint256 _count, address _viewer) external view override returns (ContentView[] memory) {
        uint256 total = contentCount;
        if (total == 0 || _startIndex >= total || _count == 0) return new ContentView[](0);

        uint256 remaining = total - _startIndex;
        uint256 returnCount = _count > remaining ? remaining : _count;
        ContentView[] memory batch = new ContentView[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 currentId = total - (_startIndex + i);
            batch[i] = _formatView(currentId, _viewer);
        }

        return batch;
    }

    function getFeedBefore(uint256 _cursorId, uint256 _count, address _viewer) external view override returns (ContentView[] memory batch, uint256 nextCursor) {
        uint256 total = contentCount;

        if (total == 0 || _count == 0) {
            return (new ContentView[](0), 0);
        }

        uint256 cursor = _cursorId == 0 || _cursorId > total ? total : _cursorId - 1;

        if (cursor == 0) {
            return (new ContentView[](0), 0);
        }

        uint256 returnCount = _count > cursor ? cursor : _count;
        batch = new ContentView[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 currentId = cursor - i;
            batch[i] = _formatView(currentId, _viewer);
        }

        nextCursor = batch[returnCount - 1].id;
    }

    function getPostsFeedBefore(uint256 _cursorId, uint256 _count, address _viewer) external view override returns (ContentView[] memory batch, uint256 nextCursor) {
        uint256 cursor = _cursorId == 0 ? _postIds.length : _lowerBound(_postIds, _cursorId);

        if (cursor == 0 || _count == 0) {
            return (new ContentView[](0), 0);
        }

        uint256 returnCount = _count > cursor ? cursor : _count;
        batch = new ContentView[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 id = _postIds[cursor - 1 - i];
            batch[i] = _formatView(id, _viewer);
        }

        nextCursor = batch[returnCount - 1].id;
    }

    function getCreatorContentCount(address _creator) external view override returns (uint256) {
        return creatorContent[_creator].length;
    }

    function getContentsByCreator(address _creator, uint256 _startIndex, uint256 _count, address _viewer) external view override returns (ContentView[] memory) {
        uint256[] storage ids = creatorContent[_creator];
        uint256 total = ids.length;

        if (total == 0 || _startIndex >= total || _count == 0) return new ContentView[](0);

        uint256 remaining = total - _startIndex;
        uint256 returnCount = _count > remaining ? remaining : _count;
        ContentView[] memory result = new ContentView[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 id = ids[total - 1 - (_startIndex + i)];
            result[i] = _formatView(id, _viewer);
        }

        return result;
    }

    function getContentsByCreatorBefore(
        address _creator,
        uint256 _cursorId,
        uint256 _count,
        address _viewer
    ) external view override returns (ContentView[] memory result, uint256 nextCursor) {
        uint256[] storage ids = creatorContent[_creator];
        uint256 cursor = _cursorId == 0 ? ids.length : _lowerBound(ids, _cursorId);

        if (cursor == 0 || _count == 0) {
            return (new ContentView[](0), 0);
        }

        uint256 returnCount = _count > cursor ? cursor : _count;
        result = new ContentView[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 id = ids[cursor - 1 - i];
            result[i] = _formatView(id, _viewer);
        }

        nextCursor = result[returnCount - 1].id;
    }

    function getComments(uint256 _parentId, uint256 _startIndex, uint256 _count, address _viewer) external view override returns (ContentView[] memory) {
        uint256[] storage commentIds = _comments[_parentId];
        uint256 total = commentIds.length;

        if (total == 0 || _startIndex >= total || _count == 0) return new ContentView[](0);

        uint256 remaining = total - _startIndex;
        uint256 returnCount = _count > remaining ? remaining : _count;
        ContentView[] memory result = new ContentView[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 commentId = commentIds[_startIndex + i];
            result[i] = _formatView(commentId, _viewer);
        }

        return result;
    }

    function getReposts(uint256 _parentId, uint256 _startIndex, uint256 _count, address _viewer) external view override returns (ContentView[] memory) {
        uint256[] storage repostIds = _reposts[_parentId];
        uint256 total = repostIds.length;

        if (total == 0 || _startIndex >= total || _count == 0) return new ContentView[](0);

        uint256 remaining = total - _startIndex;
        uint256 returnCount = _count > remaining ? remaining : _count;
        ContentView[] memory result = new ContentView[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 repostId = repostIds[_startIndex + i];
            result[i] = _formatView(repostId, _viewer);
        }

        return result;
    }

    function pause() external onlyDirectAdmin {
        _pause();
    }

    function unpause() external onlyDirectAdmin {
        _unpause();
    }

    function setFee(uint256 _fee) external onlyDirectAdmin {
        uint256 oldValue = fee;
        fee = _fee;

        emit FeeUpdated(oldValue, _fee);
    }

    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external onlyDirectAdmin {
        if (_maxMetadataBytes == 0 || _maxMetadataBytes > ABSOLUTE_MAX_METADATA_BYTES) {
            revert InvalidMetadataLimit();
        }

        uint256 oldValue = maxMetadataBytes;
        maxMetadataBytes = _maxMetadataBytes;

        emit MaxMetadataBytesUpdated(oldValue, _maxMetadataBytes);
    }

    function setTrustedForwarder(address _forwarder, bool _trusted) external onlyDirectAdmin {
        if (_forwarder == address(0)) revert InvalidAddress();

        trustedForwarders[_forwarder] = _trusted;

        emit TrustedForwarderUpdated(_forwarder, _trusted);
    }

    function withdrawAll(address payable _receiver) external onlyDirectAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 balance = address(this).balance;
        if (balance == 0) revert TransferFailed();

        (bool success, ) = _receiver.call{value: balance}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(_receiver, balance);
    }

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

    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHup) returns (bool) {
        return trustedForwarders[forwarder];
    }

    function _like(address actor, uint256 id) internal {
        if (id == 0 || id > contentCount) revert InvalidIndex();

        ContentData storage item = allContent[id];

        if (item.isDeleted) revert ContentDeletedError();
        if (contentLikedBy[id][actor]) revert InteractionNotAllowed();

        item.likeCount++;
        contentLikedBy[id][actor] = true;

        emit ContentLiked(id, actor, item.creator);
    }

    function _unlike(address actor, uint256 id) internal {
        if (id == 0 || id > contentCount) revert InvalidIndex();

        ContentData storage item = allContent[id];

        if (item.isDeleted) revert ContentDeletedError();
        if (!contentLikedBy[id][actor]) revert InteractionNotAllowed();

        item.likeCount--;
        contentLikedBy[id][actor] = false;

        emit ContentUnliked(id, actor, item.creator);
    }

    function _resolveActor(address _owner) internal view returns (address) {
        if (_owner == address(0) || _owner == _msgSender()) return _msgSender();

        Session memory session = userSessions[_owner];
        if (session.burnerKey != _msgSender()) revert Unauthorized();
        if (block.timestamp >= session.expiresAt) revert SessionExpired();

        return _owner;
    }

    function _createInternal(address _author, ContentType _type, string memory _metadata, uint256 _parentId, bool _allowedComments) internal returns (uint256) {
        contentCount++;
        uint256 id = contentCount;

        allContent[id] = ContentData({
            metadata: _metadata,
            parentId: _parentId,
            createdAt: block.timestamp,
            likeCount: 0,
            commentCount: 0,
            repostCount: 0,
            creator: _author,
            cType: _type,
            isDeleted: false,
            isUpdated: false,
            allowedComments: _allowedComments
        });

        creatorContent[_author].push(id);

        if (_type == ContentType.Post) {
            _postIds.push(id);
        }

        if (_parentId != 0) {
            if (_type == ContentType.Comment) {
                _comments[_parentId].push(id);
                allContent[_parentId].commentCount++;
            }

            if (_type == ContentType.Repost) {
                _reposts[_parentId].push(id);
                allContent[_parentId].repostCount++;
                contentRepostedBy[_parentId][_author] = true;
            }
        }

        emit ContentCreated(id, _author, _type, _parentId);
        return id;
    }

    function _formatView(uint256 _id, address _viewer) internal view returns (ContentView memory) {
        ContentData storage c = allContent[_id];

        return
            ContentView({
                id: _id,
                cType: c.cType,
                metadata: c.isDeleted ? "" : c.metadata,
                parentId: c.parentId,
                createdAt: c.createdAt,
                creator: c.creator,
                likeCount: c.likeCount,
                commentCount: c.commentCount,
                repostCount: c.repostCount,
                isDeleted: c.isDeleted,
                isUpdated: c.isUpdated,
                allowedComments: c.allowedComments,
                hasLiked: _viewer != address(0) ? contentLikedBy[_id][_viewer] : false
            });
    }

    function _lowerBound(uint256[] storage ids, uint256 value) internal view returns (uint256) {
        uint256 low = 0;
        uint256 high = ids.length;

        while (low < high) {
            uint256 mid = (low + high) / 2;

            if (ids[mid] < value) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        return low;
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }

    receive() external payable {
        emit UnattributedDeposit(msg.sender, msg.value);
    }
}
