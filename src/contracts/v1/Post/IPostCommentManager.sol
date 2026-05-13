// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IPostCommentManager
/// @author Aratta Labs
/// @notice Interface for the PostCommentManager contract.
interface IPostCommentManager {
    
    // Structs must be defined in the interface if used in return types or parameters
    
    /// @dev A struct for returning comment data, reflecting the contract's data structure,
    /// including threading and like counts.
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
    }
    
    // --- Write Functions ---

    /// @notice Adds a new comment or reply to a specified post.
    function addComment(uint256 _postId, uint256 _parentId, string calldata _content, string calldata _metadata) external;

    /// @notice Updates the content and metadata of an existing comment.
    function updateComment(uint256 _commentId, string calldata _newContent, string calldata _newMetadata) external;

    /// @notice Flags an existing comment as deleted (soft delete).
    function deleteComment(uint256 _commentId) external; // FIXED: Changed uint255 to uint256

    /// @notice Allows a user to like a comment.
    function likeComment(uint256 _commentId) external;

    /// @notice Allows a user to unlike a comment.
    function unlikeComment(uint256 _commentId) external;

    // --- View Functions ---

    /// @notice Retrieves a specific comment by its global ID.
    function getComment(uint256 _commentId) external view returns (CommentWithoutMappings memory);

    /// @notice Retrieves a paginated list of top-level comments for a specific post.
    function getCommentsByPostId(uint256 _postId, uint256 _startIndex, uint256 _count) external view returns (CommentWithoutMappings[] memory);

    /// @notice Retrieves a paginated list of replies for a specific parent comment.
    function getRepliesByCommentId(uint256 _parentId, uint256 _startIndex, uint256 _count) external view returns (CommentWithoutMappings[] memory);
    
    /// @notice Gets the total number of top-level comments for a post.
    function getPostCommentCount(uint256 _postId) external view returns (uint256);
    
    /// @notice Gets the total number of direct replies for a specific comment.
    function getReplyCount(uint256 _parentId) external view returns (uint256);
    
    /// @notice Gets the number of likes for a specific comment.
    function getCommentLikeCount(uint256 _commentId) external view returns (uint256);
    
    /// @notice Checks if a user has liked a specific comment.
    function hasLikedComment(uint256 _commentId, address _addr) external view returns (bool);
}
