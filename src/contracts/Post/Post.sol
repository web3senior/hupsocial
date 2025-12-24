// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./../Counters.sol";
import "./PostEvent.sol";
import "./PostError.sol";
import "./IPostCommentManager.sol";

/// @title Post
/// @author Aratta Labs
/// @notice Core contract for Status/Post creation, liking, and unliking, supporting gasless Meta Transactions and batch operations.
/// @custom:version 1.4
/// @custom:emoji 📝
contract Post is Ownable, Pausable, ReentrancyGuard, ERC2771Context {
    using Counters for Counters.Counter;

    // State Variables
    Counters.Counter public postCount;
    uint256 public fee = 0 ether;
    address public commentManagerAddress;

    mapping(uint256 => PostData) public posts;
    mapping(uint256 => mapping(bytes32 => string)) public blockStorage;
    mapping(uint256 => uint256) public postLikes;
    mapping(uint256 => mapping(address => bool)) public postLikedBy;
    mapping(address => uint256[]) public creatorPosts;

    struct PostData {
        string metadata;
        string content;
        uint256 createdAt;
        uint256 commentCount;
        address creator;
        bool allowedComments;
        bool isDeleted;
        bool isUpdated;
    }

    struct PostWithoutMappings {
        uint256 postId;
        string metadata;
        string content;
        uint256 createdAt;
        uint256 likeCount;
        uint256 commentCount;
        address creator;
        bool allowedComments;
        bool isDeleted;
        bool isUpdated;
        bool hasLiked;
    }

    modifier onlyPostCreator(uint256 _postId) {
        require(posts[_postId].creator == _msgSender(), "Only the post creator can update a post.");
        _;
    }

    constructor(address _trustedForwarder) Ownable(_msgSender()) ERC2771Context(_trustedForwarder) {
        postCount.increment();
        uint256 postId = postCount.current();
        PostData storage newPost = posts[postId];

        newPost.metadata = "";
        newPost.content = unicode"Welcome! This is the first post on the new system.";
        newPost.createdAt = block.timestamp;
        newPost.creator = _msgSender();
        newPost.allowedComments = true;
        newPost.isDeleted = false;
        newPost.isUpdated = false;
        newPost.commentCount = 0;

        creatorPosts[_msgSender()].push(postId);
    }

    // --- LIKING & UNLIKING LOGIC ---

    /// @notice Allows a user to like one or more posts in a single transaction.
    /// @param _postIds An array of post IDs to like.
    function batchLikePosts(uint256[] calldata _postIds) external nonReentrant whenNotPaused {
        uint256 length = _postIds.length;
        require(length > 0, "No post IDs provided.");

        for (uint256 i = 0; i < length; i++) {
            uint256 pid = _postIds[i];

            // Validation to prevent batch-reverts for invalid states
            if (pid > 0 && pid <= postCount.current() && !posts[pid].isDeleted && !postLikedBy[pid][_msgSender()]) {
                postLikes[pid]++;
                postLikedBy[pid][_msgSender()] = true;
                emit PostEvent.PostLiked(pid, _msgSender(), posts[pid].creator);
            }
        }
    }

    /// @notice Allows a user to unlike one or more posts in a single transaction.
    /// @param _postIds An array of post IDs to unlike.
    function batchUnlikePosts(uint256[] calldata _postIds) external nonReentrant whenNotPaused {
        uint256 length = _postIds.length;
        require(length > 0, "No post IDs provided.");

        for (uint256 i = 0; i < length; i++) {
            uint256 pid = _postIds[i];

            // Only decrement if the post exists, isn't deleted, and was actually liked by the sender
            if (pid > 0 && pid <= postCount.current() && !posts[pid].isDeleted && postLikedBy[pid][_msgSender()]) {
                postLikes[pid]--;
                postLikedBy[pid][_msgSender()] = false;
                emit PostEvent.PostUnliked(pid, _msgSender(), posts[pid].creator);
            }
        }
    }

    // --- POST MANAGEMENT ---

    function createPost(
        string memory _metadata,
        string memory _content,
        bool _allowedComments
    ) external payable whenNotPaused {
        _processFee();
        require(bytes(_metadata).length > 0 || bytes(_content).length > 0, "Post content empty.");

        postCount.increment();
        uint256 postId = postCount.current();
        PostData storage newPost = posts[postId];

        newPost.metadata = _metadata;
        newPost.content = _content;
        newPost.createdAt = block.timestamp;
        newPost.creator = _msgSender();
        newPost.allowedComments = _allowedComments;
        newPost.isDeleted = false;
        newPost.isUpdated = false;
        newPost.commentCount = 0;

        creatorPosts[_msgSender()].push(postId);
        emit PostEvent.PostCreated(postId, _msgSender(), _metadata, _content);
    }

    function updatePost(
        uint256 _postId,
        string memory _metadata,
        string memory _content,
        bool _allowedComments
    ) external onlyPostCreator(_postId) returns (bool) {
        PostData storage updatedPost = posts[_postId];
        require(!updatedPost.isDeleted, "Cannot update a deleted post.");
        require(bytes(_content).length > 0, "Post content cannot be empty.");

        updatedPost.metadata = _metadata;
        updatedPost.content = _content;
        updatedPost.allowedComments = _allowedComments;
        updatedPost.isUpdated = true;

        emit PostEvent.PostUpdated(_postId, _msgSender(), _metadata, _content);
        return true;
    }

    function deletePost(uint256 _postId) external onlyPostCreator(_postId) {
        PostData storage post = posts[_postId];
        require(!post.isDeleted, "Post is already deleted.");
        post.isDeleted = true;
        emit PostEvent.PostDeleted(_postId, _msgSender());
    }

    // --- SYSTEM & CACHING ---

    function updateCommentStats(uint256 _postId) external {
        require(_msgSender() == commentManagerAddress, "Only the Comment Manager can update stats.");
        PostData storage post = posts[_postId];
        require(!post.isDeleted, "Cannot update stats for a deleted post.");
        post.commentCount++;
        emit PostEvent.CommentStatsUpdated(_postId, post.commentCount);
    }

    function togglePause() external onlyOwner {
        paused() ? _unpause() : _pause();
    }

    function setCommentManager(address _commentManagerAddress) public onlyOwner {
        require(_commentManagerAddress != address(0), "Invalid address.");
        commentManagerAddress = _commentManagerAddress;
    }

    function updateFee(uint256 _fee) public onlyOwner {
        fee = _fee;
    }

    function withdrawAll() public onlyOwner {
        uint256 amount = address(this).balance;
        require(amount > 0, "No balance");
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Failed");
        emit PostEvent.Withdrawal(owner(), amount, block.timestamp);
    }

    function setKey(uint256 _postId, bytes32 _key, string memory _val) public onlyOwner returns (bool) {
        require(!posts[_postId].isDeleted, "Deleted post.");
        blockStorage[_postId][_key] = _val;
        return true;
    }

    function delKey(uint256 _postId, bytes32 _key) public onlyOwner returns (bool) {
        require(!posts[_postId].isDeleted, "Deleted post.");
        delete blockStorage[_postId][_key];
        return true;
    }

    // --- VIEW FUNCTIONS ---

    function getCreatorPostCount(address _creator) external view returns (uint256) {
        return creatorPosts[_creator].length;
    }

    function getPostByIndex(uint256 _index, address _addr) public view returns (PostWithoutMappings memory) {
        require(_index > 0 && _index <= postCount.current(), "Invalid index.");
        PostData storage post = posts[_index];
        require(!post.isDeleted, "Post deleted.");

        return
            PostWithoutMappings({
                postId: _index,
                metadata: post.metadata,
                content: post.content,
                createdAt: post.createdAt,
                likeCount: postLikes[_index],
                creator: post.creator,
                allowedComments: post.allowedComments,
                isDeleted: post.isDeleted,
                isUpdated: post.isUpdated,
                commentCount: post.commentCount,
                hasLiked: _addr != address(0) ? postLikedBy[_index][_addr] : false
            });
    }

    function getPostsByCreator(
        address _creator,
        uint256 _startIndex,
        uint256 _count,
        address _viewer
    ) external view returns (PostWithoutMappings[] memory) {
        uint256[] storage postIds = creatorPosts[_creator];
        uint256 total = postIds.length;
        if (total == 0 || _startIndex >= total) return new PostWithoutMappings[](0);

        uint256 endIndex = _startIndex + _count;
        if (endIndex > total) endIndex = total;

        uint256 returnCount = endIndex - _startIndex;
        PostWithoutMappings[] memory postsArray = new PostWithoutMappings[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 postId = postIds[total - 1 - (_startIndex + i)];
            postsArray[i] = getPostByIndex(postId, _viewer);
        }
        return postsArray;
    }

    function getPosts(
        uint256 _startIndex,
        uint256 _count,
        address _addr
    ) external view returns (PostWithoutMappings[] memory) {
        require(_startIndex > 0, "Start index > 0");
        uint256 totalPosts = postCount.current();
        if (_startIndex > totalPosts) return new PostWithoutMappings[](0);

        uint256 returnCount = _count;
        if (_startIndex + _count > totalPosts + 1) returnCount = totalPosts - _startIndex + 1;

        PostWithoutMappings[] memory postsArray = new PostWithoutMappings[](returnCount);
        for (uint256 i = 0; i < returnCount; i++) {
            uint256 postId = totalPosts - (_startIndex - 1) - i;
            PostData storage post = posts[postId];
            postsArray[i] = PostWithoutMappings({
                postId: postId,
                metadata: post.metadata,
                content: post.content,
                createdAt: post.createdAt,
                likeCount: postLikes[postId],
                creator: post.creator,
                allowedComments: post.allowedComments,
                isDeleted: post.isDeleted,
                isUpdated: post.isUpdated,
                commentCount: post.commentCount,
                hasLiked: _addr != address(0) ? postLikedBy[postId][_addr] : false
            });
        }
        return postsArray;
    }

    function getPostLikeCount(uint256 _postId) public view returns (uint256) {
        require(!posts[_postId].isDeleted, "Deleted.");
        return postLikes[_postId];
    }

    function hasLiked(uint256 _postId, address _addr) public view returns (bool) {
        require(!posts[_postId].isDeleted, "Deleted.");
        return postLikedBy[_postId][_addr];
    }

    function getKey(uint256 _postId, bytes32 _key) public view returns (string memory) {
        require(!posts[_postId].isDeleted, "Deleted.");
        return blockStorage[_postId][_key];
    }

    function _processFee() internal {
        if (fee > 0) {
            if (msg.value < fee) revert PostError.InsufficientPayment(msg.value);
            (bool success, ) = payable(owner()).call{value: msg.value}("");
            require(success, "Fee failed.");
        }
    }

    // Context overrides
    function _msgData() internal view virtual override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }
    function _msgSender() internal view virtual override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }
    function _contextSuffixLength() internal view virtual override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
