// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./../Counters.sol";
import "./PostEvent.sol";
import "./PostError.sol";
import "./IPostCommentManager.sol"; // Import the updated interface

/// @title Post
/// @author Aratta Labs
/// @notice Core contract for Status/Post creation and liking.
/// @custom:version 1
/// @custom:emoji 📝
/// @custom:security-contact atenyun@gmail.com
contract Post is Ownable(msg.sender), Pausable, ReentrancyGuard {
    // State Variables
    using Counters for Counters.Counter;

    Counters.Counter public postCount;
    uint256 public fee = 0 ether;

    /// @dev The address of the deployed PostCommentManager contract.
    address public commentManagerAddress;

    /// @dev A mapping to store post data using a uint256 ID
    mapping(uint256 => PostData) public posts;

    /// @dev A mapping for generic key-value storage linked to a specific post ID.
    mapping(uint256 => mapping(bytes32 => string)) public blockStorage;

    /// @dev A mapping to track the number of likes for each post.
    mapping(uint256 => uint256) public postLikes;

    /// @dev A mapping to track which addresses have liked a specific post.
    mapping(uint256 => mapping(address => bool)) public postLikedBy;

    /// @dev NEW MAPPING: Stores a list of post IDs created by a specific user.
    mapping(address => uint256[]) public creatorPosts;

    // Structs
    /// @dev A struct to represent a single status post.
    struct PostData {
        /// @dev The post's metadata, which can contain a URI or other off-chain data.
        string metadata;
        /// @dev The main text content of the post.
        string content;
        /// @dev The Unix timestamp when the post was created.
        uint256 createdAt;
        /// @dev The address of the account that created the post.
        address creator;
        /// @dev A boolean flag indicating whether comments are allowed on this post.
        bool allowedComments;
        /// @dev A flag indicating if the post has been soft-deleted.
        bool isDeleted;
        /// @dev A flag indicating if the post's content or metadata has ever been changed after creation.
        bool isUpdated;
        // --- CACHED STATS ---
        /// @dev The total number of comments on this post, cached from the Comment Manager.
        uint256 commentCount;
        // latestCommentIds removed as per user request
        // --------------------
    }

    /// @dev A struct for returning post data without mappings.
    struct PostWithoutMappings {
        uint256 postId;
        string metadata;
        string content;
        uint256 createdAt;
        uint256 likeCount;
        address creator;
        bool allowedComments;
        bool isDeleted;
        bool isUpdated;
        // --- CACHED STATS ---
        uint256 commentCount;
        // latestCommentIds removed as per user request
        // --------------------
    }

    // Modifiers
    ///@dev Throws if called by any account other than the post creator.
    modifier onlyPostCreator(uint256 _postId) {
        require(posts[_postId].creator == _msgSender(), "Only the post creator can update a post.");
        _;
    }

    // Constructor
    constructor() {
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

        // Index the first post by creator
        creatorPosts[_msgSender()].push(postId);
    }

    // External & Public Functions

    // --- FUNCTION FOR CACHE UPDATES ---
    /// @notice Called by the Comment Manager to update the cached stats on this contract.
    /// @dev This function is critical for cheap reading in view functions like getPosts.
    /// @param _postId The ID of the post being commented on.
    function updateCommentStats(uint256 _postId) external {
        PostData storage post = posts[_postId];
        require(!post.isDeleted, "Cannot update stats for a deleted post.");

        // 1. Increment Count
        post.commentCount++;
        
        // Fixed: Removed _newCommentId from event emission
        emit PostEvent.CommentStatsUpdated(_postId, post.commentCount);
    }
    // -------------------------------------

    // Post Management
    /// @notice Creates a new status post.
    function createPost(
        string memory _metadata,
        string memory _content,
        bool _allowedComments
    ) external payable {
        require(msg.value >= fee, "Insufficient payment for post creation.");
        require(bytes(_content).length > 0, "Post content cannot be empty.");

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
        
        // NEW INDEXING: Add post ID to the creator's list
        creatorPosts[_msgSender()].push(postId);

        emit PostEvent.PostCreated(postId, _msgSender(), _metadata, _content);
    }

    /// @notice Updates an existing post's metadata and content.
    /// @dev Can only be called by the post creator.
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

    /// @notice Flags an existing post as deleted (soft delete).
    /// @dev Can only be called by the post creator.
    function deletePost(uint256 _postId) external onlyPostCreator(_postId) {
        PostData storage post = posts[_postId];
        require(!post.isDeleted, "Post is already deleted.");
        post.isDeleted = true;

        emit PostEvent.PostDeleted(_postId, _msgSender());
    }

    // Liking
    /// @notice Allows a user to like a post.
    function likePost(uint256 _postId) external nonReentrant {
        require(_postId > 0 && _postId <= postCount.current(), "Invalid post ID.");
        require(!posts[_postId].isDeleted, "Cannot like a deleted post.");
        require(!postLikedBy[_postId][_msgSender()], "Post already liked.");

        postLikes[_postId]++;
        postLikedBy[_postId][_msgSender()] = true;
        emit PostEvent.PostLiked(_postId, _msgSender());
    }

    /// @notice Allows a user to unlike a post.
    function unlikePost(uint256 _postId) external nonReentrant {
        require(_postId > 0 && _postId <= postCount.current(), "Invalid post ID.");
        require(!posts[_postId].isDeleted, "Cannot unlike a deleted post.");
        require(postLikedBy[_postId][_msgSender()], "Post has not been liked by this account.");

        postLikes[_postId]--;
        postLikedBy[_postId][_msgSender()] = false;
        emit PostEvent.PostUnliked(_postId, _msgSender());
    }

    // Owner Functions

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    /// @notice Sets the address of the dedicated comment manager contract.
    function setCommentManager(address _commentManagerAddress) public onlyOwner {
        require(_commentManagerAddress != address(0), "Invalid address.");
        commentManagerAddress = _commentManagerAddress;
    }

    /// @notice Updates the fee
    function updateFee(uint256 _fee) public onlyOwner {
        fee = _fee;
    }

    /// @notice Transfers the entire contract's ETH balance to the contract owner.
    function withdrawAll() public onlyOwner {
        uint256 amount = address(this).balance;
        require(amount > 0, "No balance");
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Failed");
        emit PostEvent.Withdrawal(owner(), amount, block.timestamp);
    }

    /// @notice Sets a key/value pair in the block storage for a specific post.
    function setKey(uint256 _postId, bytes32 _key, string memory _val) public onlyOwner returns (bool) {
        require(!posts[_postId].isDeleted, "Cannot set key for a deleted post.");
        blockStorage[_postId][_key] = _val;
        return true;
    }

    /// @notice Deletes a key/value pair from the block storage for a specific post.
    function delKey(uint256 _postId, bytes32 _key) public onlyOwner returns (bool) {
        require(!posts[_postId].isDeleted, "Cannot delete key for a deleted post.");
        delete blockStorage[_postId][_key];
        return true;
    }

    // View Functions
    
    /// @notice Retrieves a specific post by index.
    function getPostByIndex(uint256 _index) public view returns (PostWithoutMappings memory) {
        require(_index > 0, "Index must be greater than 0.");
        require(_index <= postCount.current(), "Exceeds total post count.");

        PostData storage post = posts[_index];
        require(!post.isDeleted, "Post not found or has been deleted."); // Explicitly block access to deleted post data

        return PostWithoutMappings({
            postId: _index,
            metadata: post.metadata,
            content: post.content,
            createdAt: post.createdAt,
            likeCount: getPostLikeCount(_index),
            creator: post.creator,
            allowedComments: post.allowedComments,
            isDeleted: post.isDeleted,
            isUpdated: post.isUpdated,
            commentCount: post.commentCount // Caching
        });
    }

    /// @notice Retrieves a paginated list of posts created by a specific address.
    /// @dev This function is safe for users with a large number of posts by utilizing pagination.
    function getPostsByCreator(address _creator, uint256 _startIndex, uint256 _count) 
        external 
        view 
        returns (PostWithoutMappings[] memory) 
    {
        uint256[] storage postIds = creatorPosts[_creator];
        uint256 total = postIds.length;
        
        // Allow fetching from index 0, as array indexing starts at 0.
        require(_startIndex < total, "Start index out of bounds.");

        uint256 endIndex = _startIndex + _count;
        if (endIndex > total) {
            endIndex = total;
        }

        uint256 returnCount = endIndex - _startIndex;
        PostWithoutMappings[] memory postsArray = new PostWithoutMappings[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 postId = postIds[_startIndex + i];
            // Re-use the existing internal getter function for single posts
            postsArray[i] = getPostByIndex(postId); 
        }
        return postsArray;
    }

    /// @notice Retrieves a paginated list of posts.
    /// @dev NOTE: This function does not filter out deleted posts to save gas. Filtering should be done client-side.
    function getPosts(uint256 _startIndex, uint256 _count) external view returns (PostWithoutMappings[] memory) {
        require(_startIndex > 0, "Start index must be greater than 0.");
        // Check if the range ends within the bounds of existing post IDs
        require(_startIndex + _count <= postCount.current() + 1, "Exceeds total post count.");

        PostWithoutMappings[] memory postsArray = new PostWithoutMappings[](_count);

        for (uint256 i = 0; i < _count; i++) {
            uint256 postId = _startIndex + i;
            PostData storage post = posts[postId];
            postsArray[i] = PostWithoutMappings({
                postId: postId,
                metadata: post.metadata,
                content: post.content,
                createdAt: post.createdAt,
                likeCount: getPostLikeCount(postId),
                creator: post.creator,
                allowedComments: post.allowedComments,
                isDeleted: post.isDeleted,
                isUpdated: post.isUpdated,
                commentCount: post.commentCount // Caching
            });
        }
        return postsArray;
    }

    /// @notice Gets the number of likes for a specific post.
    function getPostLikeCount(uint256 _postId) public view returns (uint256) {
        require(_postId > 0 && _postId <= postCount.current(), "Invalid post ID.");
        require(!posts[_postId].isDeleted, "Post not found or has been deleted.");
        return postLikes[_postId];
    }

    /// @notice Checks if a user has liked a specific post.
    function hasLiked(uint256 _postId, address _addr) public view returns (bool) {
        require(_postId > 0 && _postId <= postCount.current(), "Invalid post ID.");
        require(!posts[_postId].isDeleted, "Post not found or has been deleted.");
        return postLikedBy[_postId][_addr];
    }

    /// @notice Gets the value of a key from the block storage for a specific post.
    function getKey(uint256 _postId, bytes32 _key) public view returns (string memory) {
        require(!posts[_postId].isDeleted, "Post not found or has been deleted.");
        return blockStorage[_postId][_key];
    }

    // Internal Functions
    function _processFee() internal {
        if (fee > 0) {
            // FIX: Changed Errors.InsufficientPayment to the imported PostError.InsufficientPayment
            if (msg.value < fee) revert PostError.InsufficientPayment(msg.value);
            (bool success, ) = payable(owner()).call{value: msg.value}("");
            require(success, "Failed");
        }
    }
}
