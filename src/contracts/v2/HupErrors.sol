// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Custom Error Definitions
/// @author Aratta Labs
/// @notice Centralized contract to define all custom errors used throughout the project.
/// @custom:version 1
library PostError {
    
    // --- Post Management Errors (Post.sol) ---

    /// @notice Thrown when the user provides an invalid Post ID (e.g., 0 or out of range).
    error InvalidPostId(uint256 postId);

    /// @notice Thrown when an account attempts to perform an action restricted to the post creator.
    error OnlyPostCreator(address caller);

    /// @notice Thrown when the content string provided for a post or comment is empty.
    error EmptyContent();

    // --- Liking Errors (Post.sol) ---

    /// @notice Thrown when an account attempts to like a post that is already liked by them.
    error PostAlreadyLiked(address liker, uint256 postId);

    /// @notice Thrown when an account attempts to unlike a post that they have not liked.
    error PostNotLiked(address unliker, uint256 postId);

    // --- Fee and Withdrawal Errors (Post.sol) ---

    /// @notice Thrown when a required payment amount is not met.
    error InsufficientPayment(uint256 valueSent);

    /// @notice Thrown when attempting to withdraw funds, but the contract balance is zero.
    error NoBalanceToWithdraw();

    // --- Comment Management Errors (PostCommentManager.sol) ---

    /// @notice Thrown when the address provided for the comment manager is invalid (address(0)).
    error InvalidCommentManagerAddress(address addr);

    /// @notice Thrown when the address of the Post contract is invalid.
    error InvalidPostContractAddress(address addr);
}
