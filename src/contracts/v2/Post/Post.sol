// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/**
 * @title HupUnified
 * @author Aratta Labs (Amir)
 * @notice Unified social protocol where fees are held in the contract for bulk withdrawal.
 */
contract HupUnified is Ownable, Pausable, ReentrancyGuard, ERC2771Context {
    // --- TYPES & STRUCTS ---

    enum ContentType {
        Post,
        Comment,
        Repost
    }

    struct ContentData {
        ContentType cType;
        string metadata;
        string content;
        uint256 parentId;
        uint256 createdAt;
        address creator;
        uint256 likeCount;
        uint256 commentCount;
        bool isDeleted;
        bool isUpdated;
        bool allowedComments;
    }

    struct ContentView {
        uint256 id;
        ContentType cType;
        string metadata;
        string content;
        uint256 parentId;
        uint256 createdAt;
        address creator;
        uint256 likeCount;
        uint256 commentCount;
        bool isDeleted;
        bool isUpdated;
        bool allowedComments;
        bool hasLiked;
    }

    // --- STATE VARIABLES ---

    uint256 public contentCount;
    uint256 public fee = 0 ether;

    mapping(uint256 => ContentData) public allContent;
    mapping(uint256 => mapping(address => bool)) public contentLikedBy;
    mapping(address => uint256[]) public creatorContent;
    mapping(uint256 => uint256[]) private _children;

    // --- EVENTS ---

    event ContentCreated(uint256 indexed id, address indexed creator, ContentType indexed cType, uint256 parentId);
    event ContentUpdated(uint256 indexed id, string metadata, string content);
    event ContentDeleted(uint256 indexed id, address indexed deleter);
    event ContentLiked(uint256 indexed id, address indexed liker);
    event ContentUnliked(uint256 indexed id, address indexed unliker);
    event Withdrawal(address indexed recipient, uint256 amount);

    // --- ERRORS ---

    error Unauthorized(address caller);
    error ContentNotFound(uint256 id);
    error ContentDeletedError(uint256 id);
    error InsufficientFee(uint256 sent);
    error InteractionNotAllowed();
    error TransferFailed();

    // --- CONSTRUCTOR ---

    constructor(address _trustedForwarder) Ownable(_msgSender()) ERC2771Context(_trustedForwarder) {
        _createInternal(ContentType.Post, "", "Welcome to Hup!", 0, true);
    }

    // --- CORE LOGIC ---

    /**
     * @notice Create a Post, Comment, or Repost.
     * @dev Fees are now collected by the contract and stored in its balance.
     */
    function create(
        ContentType _type,
        string calldata _metadata,
        string calldata _content,
        uint256 _parentId,
        bool _allowedComments
    ) external payable whenNotPaused nonReentrant returns (uint256) {
        // Validation: Check if the sent value meets the required fee
        if (fee > 0) {
            if (msg.value < fee) revert InsufficientFee(msg.value);
            // Funds automatically stay in the contract balance (address(this).balance)
        }

        if (_type != ContentType.Post) {
            ContentData storage parent = allContent[_parentId];
            if (parent.creator == address(0)) revert ContentNotFound(_parentId);
            if (parent.isDeleted) revert ContentDeletedError(_parentId);
            if (_type == ContentType.Comment && !parent.allowedComments) revert InteractionNotAllowed();
        }

        return _createInternal(_type, _metadata, _content, _parentId, _allowedComments);
    }

    function _createInternal(ContentType _type, string memory _metadata, string memory _content, uint256 _parentId, bool _allowedComments) internal returns (uint256) {
        //TODO
        //if (_type == ContentType.Comment && !parent.allowedComments) revert InteractionNotAllowed();

        contentCount++;
        uint256 id = contentCount;

        allContent[id] = ContentData({
            cType: _type,
            metadata: _metadata,
            content: _content,
            parentId: _parentId,
            createdAt: block.timestamp,
            creator: _msgSender(),
            likeCount: 0,
            commentCount: 0,
            isDeleted: false,
            isUpdated: false,
            allowedComments: _allowedComments
        });

        creatorContent[_msgSender()].push(id);

        if (_parentId != 0) {
            _children[_parentId].push(id);
            allContent[_parentId].commentCount++;
        }

        emit ContentCreated(id, _msgSender(), _type, _parentId);
        return id;
    }

    // --- VIEW FUNCTIONS ---

    function getFeed(uint256 _startIndex, uint256 _count, address _viewer) external view returns (ContentView[] memory) {
        uint256 total = contentCount;
        if (_startIndex > total || total == 0 || _startIndex == 0) return new ContentView[](0);

        uint256 limit = (_startIndex + _count > total + 1) ? total - _startIndex + 1 : _count;
        ContentView[] memory batch = new ContentView[](limit);

        for (uint256 i = 0; i < limit; i++) {
            uint256 currentId = total - (_startIndex - 1) - i;
            batch[i] = _formatView(currentId, _viewer);
        }
        return batch;
    }

    function _formatView(uint256 _id, address _viewer) internal view returns (ContentView memory) {
        ContentData storage c = allContent[_id];
        return
            ContentView({
                id: _id,
                cType: c.cType,
                metadata: c.metadata,
                content: c.content,
                parentId: c.parentId,
                createdAt: c.createdAt,
                creator: c.creator,
                likeCount: c.likeCount,
                commentCount: c.commentCount,
                isDeleted: c.isDeleted,
                isUpdated: c.isUpdated,
                allowedComments: c.allowedComments,
                hasLiked: _viewer != address(0) ? contentLikedBy[_id][_viewer] : false
            });
    }

    // --- ADMIN & WITHDRAWAL ---

    function setFee(uint256 _fee) external onlyOwner {
        fee = _fee;
    }

    /**
     * @notice Withdraws the accumulated fees to the owner's address.
     * @dev Uses .call for compatibility with LUKSO Universal Profiles.
     */
    function withdrawAll() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert TransferFailed(); // Or a custom "No Balance" error

        (bool success, ) = payable(owner()).call{value: balance}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(owner(), balance);
    }

    // Required overrides for ERC2771Context
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }

    // Allow the contract to receive native tokens directly if needed
    receive() external payable {}
}
