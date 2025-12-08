// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
// [1] NEW IMPORT: ERC2771Context for Gasless Transactions
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./../Counters.sol"; // Assumed path

// --- Interface for Post.sol ---
// Defines the external functions from the Post contract that this manager needs to call.
interface IPost {
    /// @dev Function required to update the comment count cache on the Post contract
    function updateCommentStats(uint256 _postId) external;
}
// -----------------------------

// --- Events for Comments ---
library CommentEvent {
    // UPDATED: Added 'parentId' to the CommentAdded event signature for threading support.
    event CommentAdded(uint256 indexed postId, uint256 indexed commentId, uint256 indexed parentId, address creator, string content, string metadata);
    event CommentUpdated(uint256 indexed postId, uint256 indexed commentId, address indexed updater, string newContent, string newMetadata); 
    event CommentDeleted(uint256 indexed postId, uint256 indexed commentId, address indexed deleter);
    
    /// @dev Emitted when a user likes a comment.
    event CommentLiked(uint256 indexed postId, uint256 indexed commentId, address indexed liker);
    /// @dev Emitted when a user unlikes a comment.
    event CommentUnliked(uint256 indexed postId, uint256 indexed commentId, address indexed unliker);
}
// -----------------------------

/// @title PostCommentManager
/// @author Aratta Labs
/// @notice Handles all comment-related logic, interacting with the Post contract for caching, now with meta transaction support.
// [2] UPDATED INHERITANCE: Inherit from ERC2771Context
contract PostCommentManager is Ownable, ReentrancyGuard, ERC2771Context {
    using Counters for Counters.Counter;

    /// @dev Global counter for all comments across all posts.
    Counters.Counter public commentGlobalId;
    
    /// @dev The address of the deployed Post.sol contract. Used for cross-contract calls.
    address public immutable postContractAddress;

    /// @dev A mapping from postId to a list of Comment IDs for that post (only top-level comments).
    mapping(uint256 => uint256[]) public postComments;

    /// @dev A mapping from a parent comment ID to a list of its replies.
    mapping(uint256 => uint256[]) public commentReplies; // NEW: For threading
    
    /// @dev A mapping from global comment ID to the Comment data.
    mapping(uint256 => Comment) public comments;
    
    // --- Comment Liking State ---
    /// @dev A mapping to track the number of likes for each comment.
    mapping(uint256 => uint256) public commentLikes;

    /// @dev A mapping to track which addresses have liked a specific comment.
    mapping(uint256 => mapping(address => bool)) public commentLikedBy;
    // ----------------------------
    
    // Structs
    struct Comment {
        uint256 postId;
        uint256 parentId; // NEW: ID of the comment this is replying to (0 if top-level)
        string content;
        string metadata; 
        address creator;
        uint256 createdAt;
        bool isDeleted;
    }

    /// @dev A struct for returning comment data.
    struct CommentWithoutMappings {
        uint256 commentId;
        uint256 postId;
        uint256 parentId; // NEW: ID of the comment this is replying to (0 if top-level)
        string content;
        string metadata; 
        address creator;
        uint256 createdAt;
        bool isDeleted;
        uint256 likeCount; 
        uint256 replyCount; // NEW: Total number of direct replies
        bool hasLiked;
    }

    // Constructor
    /// @param _postContractAddress The address of the main Post contract.
    // [3] UPDATED CONSTRUCTOR: Now accepts the trusted forwarder address.
    constructor(address _postContractAddress, address _trustedForwarder) 
        Ownable(_msgSender()) 
        ERC2771Context(_trustedForwarder) 
    {
        // Note: _msgSender() ensures the original signer (deployer) is set as owner, even if deployment is gasless.
        require(_postContractAddress != address(0), "Invalid post contract address.");
        postContractAddress = _postContractAddress;
    }

    // External Functions

    /// @notice Adds a new comment or reply to a specified post.
    /// @param _postId The ID of the post the comment belongs to.
    /// @param _parentId The ID of the parent comment (0 for a top-level comment).
    /// @param _content The main text content of the comment.
    /// @param _metadata Optional off-chain data (e.g., IPFS hash) for the comment.
    function addComment(uint256 _postId, uint256 _parentId, string calldata _content, string calldata _metadata) external nonReentrant {
        require(_postId > 0, "Invalid post ID.");
        
        // If a parent ID is provided, ensure it exists.
        if (_parentId > 0) {
            require(comments[_parentId].creator != address(0), "Parent comment not found.");
        }
        
        require(bytes(_content).length > 0, "Comment content cannot be empty.");

        commentGlobalId.increment();
        uint256 newCommentId = commentGlobalId.current();

        // 1. Store the new comment data
        comments[newCommentId] = Comment({
            postId: _postId,
            parentId: _parentId, // Storing the parent ID
            content: _content,
            metadata: _metadata, 
            creator: _msgSender(), // _msgSender() correctly resolves the original signer
            createdAt: block.timestamp,
            isDeleted: false
        });

        // 2. Link the comment/reply
        if (_parentId == 0) {
            // Top-level comment: link to the post's top-level list
            postComments[_postId].push(newCommentId);
            
            // 3. CRITICAL: Update the cached stats on the Post contract only for top-level comments.
            IPost postContract = IPost(postContractAddress);
            postContract.updateCommentStats(_postId);
        } else {
            // Reply: link to the parent comment's reply list
            commentReplies[_parentId].push(newCommentId);
        }

        // Emit the event with the new parentId parameter
        emit CommentEvent.CommentAdded(_postId, newCommentId, _parentId, _msgSender(), _content, _metadata);
    }
    
    /// @notice Updates the content and metadata of an existing comment.
    /// @param _commentId The ID of the comment to update.
    /// @param _newContent The new content of the comment.
    /// @param _newMetadata The new metadata for the comment.
    function updateComment(uint256 _commentId, string calldata _newContent, string calldata _newMetadata) external nonReentrant {
        Comment storage comment = comments[_commentId];
        require(comment.creator != address(0), "Comment not found.");
        require(comment.creator == _msgSender(), "Only comment creator can update."); // _msgSender() correctly resolves the original signer
        require(!comment.isDeleted, "Cannot update a deleted comment.");
        require(bytes(_newContent).length > 0, "Comment content cannot be empty.");

        comment.content = _newContent;
        comment.metadata = _newMetadata;
        
        // Emit the update event with the new data
        emit CommentEvent.CommentUpdated(comment.postId, _commentId, _msgSender(), _newContent, _newMetadata);
    }

    /// @notice Flags an existing comment as deleted (soft delete).
    function deleteComment(uint256 _commentId) external {
        Comment storage comment = comments[_commentId];
        require(comment.creator != address(0), "Comment not found.");
        require(comment.creator == _msgSender() || _msgSender() == owner(), "Only comment creator or owner can delete."); // _msgSender() correctly resolves the original signer
        require(!comment.isDeleted, "Comment is already deleted.");

        comment.isDeleted = true;
        
        emit CommentEvent.CommentDeleted(comment.postId, _commentId, _msgSender());
    }

    // --- Comment Liking Functions ---

    /// @notice Allows a user to like a comment.
    function likeComment(uint256 _commentId) external nonReentrant {
        Comment storage comment = comments[_commentId];
        require(comment.creator != address(0), "Comment not found.");
        require(!comment.isDeleted, "Cannot like a deleted comment.");
        require(!commentLikedBy[_commentId][_msgSender()], "Comment already liked."); // _msgSender() correctly resolves the original signer

        commentLikes[_commentId]++;
        commentLikedBy[_commentId][_msgSender()] = true;
        
        emit CommentEvent.CommentLiked(comment.postId, _commentId, _msgSender()); 
    }

    /// @notice Allows a user to unlike a comment.
    function unlikeComment(uint256 _commentId) external nonReentrant {
        Comment storage comment = comments[_commentId];
        require(comment.creator != address(0), "Comment not found.");
        require(!comment.isDeleted, "Cannot unlike a deleted comment.");
        require(commentLikedBy[_commentId][_msgSender()], "Comment has not been liked by this account."); // _msgSender() correctly resolves the original signer

        commentLikes[_commentId]--;
        commentLikedBy[_commentId][_msgSender()] = false;
        
        emit CommentEvent.CommentUnliked(comment.postId, _commentId, _msgSender());
    }

    // --- Owner & EIP-2771 Functions ---
    
    // [4] EIP-2771 HELPER: Allows the owner to change the trusted forwarder address
    /// @notice Sets a new trusted forwarder address, updating EIP-2771 compatibility.
    function setTrustedForwarder(address _trustedForwarder) public onlyOwner {
        _setTrustedForwarder(_trustedForwarder);
    }

    // [5] REQUIRED EIP-2771 OVERRIDE: Declares the trusted forwarder address.
    /// @dev See EIP-2771. Returns true if the address is the trusted forwarder.
    function _isTrustedForwarder(address forwarder) internal view override returns (bool) {
        return forwarder == _trustedForwarder();
    }
    
    // View Functions
    
    /// @notice Gets the number of direct replies for a specific comment.
    function getReplyCount(uint256 _parentId) public view returns (uint256) {
        return commentReplies[_parentId].length;
    }

    /// @notice Retrieves a specific comment by its global ID.
    function getComment(uint256 _commentId, address _addr) external view returns (CommentWithoutMappings memory) {
        Comment memory comment = comments[_commentId];
        require(comment.creator != address(0), "Comment not found.");

        return CommentWithoutMappings({
            commentId: _commentId,
            postId: comment.postId,
            parentId: comment.parentId, // Including parent ID
            content: comment.content,
            metadata: comment.metadata, 
            creator: comment.creator,
            createdAt: comment.createdAt,
            isDeleted: comment.isDeleted,
            likeCount: commentLikes[_commentId],
            replyCount: getReplyCount(_commentId), // Including the reply count
            hasLiked: _addr != address(0) ? hasLikedComment(_commentId, _addr) : false // View functions are safe and do not need _msgSender()
        });
    }

    /// @notice Retrieves a paginated list of top-level comments for a specific post.
    function getCommentsByPostId(uint256 _postId, uint256 _startIndex, uint256 _count, address _addr) 
        external 
        view 
        returns (CommentWithoutMappings[] memory results) 
    {
        uint256[] storage postCommentIds = postComments[_postId];
        uint256 total = postCommentIds.length;
        
        // If the start index is out of bounds, return an empty array.
        if (_startIndex >= total) {
            return new CommentWithoutMappings[](0);
        }

        uint256 endIndex = _startIndex + _count;
        if (endIndex > total) {
            endIndex = total;
        }

        uint256 returnCount = endIndex - _startIndex;
        CommentWithoutMappings[] memory results = new CommentWithoutMappings[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 commentId = postCommentIds[_startIndex + i];
            Comment storage comment = comments[commentId];
            
            results[i] = CommentWithoutMappings({
                commentId: commentId,
                postId: comment.postId,
                parentId: comment.parentId, // Including parent ID
                content: comment.content,
                metadata: comment.metadata, 
                creator: comment.creator,
                createdAt: comment.createdAt,
                isDeleted: comment.isDeleted,
                likeCount: commentLikes[commentId],
                replyCount: getReplyCount(commentId), // Including the reply count
                hasLiked: _addr != address(0) ? hasLikedComment(commentId, _addr) : false
            });
        }
        
        return results;
    }

    /// @notice Retrieves a paginated list of replies for a specific parent comment.
    function getRepliesByCommentId(uint256 _parentId, uint256 _startIndex, uint256 _count, address _addr) 
        external 
        view 
        returns (CommentWithoutMappings[] memory) 
    {
        uint256[] storage repliesIds = commentReplies[_parentId];
        uint256 total = repliesIds.length;
        
        // Allow fetching 0 replies if the parent exists but has no replies
        if (_startIndex >= total) {
            return new CommentWithoutMappings[](0);
        }

        uint256 endIndex = _startIndex + _count;
        if (endIndex > total) {
            endIndex = total;
        }

        uint256 returnCount = endIndex - _startIndex;
        CommentWithoutMappings[] memory results = new CommentWithoutMappings[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 commentId = repliesIds[_startIndex + i];
            Comment storage comment = comments[commentId];
            
            results[i] = CommentWithoutMappings({
                commentId: commentId,
                postId: comment.postId,
                parentId: comment.parentId, // Including parent ID
                content: comment.content,
                metadata: comment.metadata, 
                creator: comment.creator,
                createdAt: comment.createdAt,
                isDeleted: comment.isDeleted,
                likeCount: commentLikes[commentId],
                replyCount: getReplyCount(commentId), // Including the reply count
                hasLiked: _addr != address(0) ? hasLikedComment(commentId, _addr) : false
            });
        }
        return results;
    }

    /// @notice Gets the total number of top-level comments for a post.
    function getPostCommentCount(uint256 _postId) external view returns (uint256) {
        return postComments[_postId].length;
    }

    /// @notice Gets the number of likes for a specific comment.
    function getCommentLikeCount(uint256 _commentId) public view returns (uint256) {
        Comment memory comment = comments[_commentId];
        require(comment.creator != address(0), "Comment not found.");
        return commentLikes[_commentId];
    }
    
    /// @notice Checks if a user has liked a specific comment.
    function hasLikedComment(uint256 _commentId, address _addr) public view returns (bool) {
        Comment memory comment = comments[_commentId];
        require(comment.creator != address(0), "Comment not found.");
        return commentLikedBy[_commentId][_addr];
    }
}