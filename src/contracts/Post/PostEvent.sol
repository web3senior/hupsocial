// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title PostEvent
/// @notice A library containing all events emitted by the Post contract.
library PostEvent {
    // --- Post Life Cycle Events ---
    event PostCreated(
        uint256 indexed postId,
        address indexed creator,
        string metadata,
        string content
    );
    /// @dev Emitted when a post's content, metadata, or allowedComments status is changed.
    event PostUpdated(
        uint256 indexed postId,
        address indexed updater,
        string newMetadata, // Added to provide the updated metadata
        string newContent // Added to provide the updated content
    );
    event PostDeleted(
        uint256 indexed postId,
        address indexed deleter
    );
    
    // --- Interaction Events ---
    event PostLiked(
        uint256 indexed postId,
        address indexed liker
    );
    event PostUnliked(
        uint256 indexed postId,
        address indexed unliker
    );

    // --- Caching/Manager Events ---
    /// @dev Emitted by Post.sol when the Comment Manager successfully updates the post's cached stats.
    event CommentStatsUpdated(
        uint256 indexed postId,
        uint256 newCommentCount // latestCommentId removed
    );

    // --- Contract Admin Events ---
    event Withdrawal(
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );
}
