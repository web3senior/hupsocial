// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Event Definitions
/// @author Aratta Labs
/// @notice Centralized contract to define all events emitted by the core Poll and Comment Manager contracts.
/// @custom:version 1
library Event {
    // --- Poll.sol Events ---

    /// @notice Emitted when a new poll is successfully created.
    event PollCreated(
        uint256 indexed pollId,
        address indexed creator,
        string question
    );

    /// @notice Emitted when an existing poll's content or parameters are updated.
    event PollUpdated(
        uint256 indexed pollId,
        address indexed manager
    );

    /// @notice Emitted when a user successfully casts a vote on a poll.
    event Voted(
        uint256 indexed pollId,
        address indexed voter,
        uint256 optionIndex
    );
    
    /// @notice Emitted when the whitelist for a private poll is updated.
    event WhitelistUpdated(
        uint256 indexed pollId,
        address indexed updater
    );

    /// @notice Emitted when a user successfully likes a poll.
    event PollLiked(
        uint256 indexed pollId,
        address indexed liker
    );

    /// @notice Emitted when a user successfully unlikes a poll.
    event PollUnliked(
        uint256 indexed pollId,
        address indexed unliker
    );

    /// @notice Emitted when the contract owner withdraws native currency.
    event Withdrawal(
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );

    // --- PollCommentManager.sol Events ---

    /// @notice Emitted when a new comment is added to a poll.
    event CommentAdded(
        uint256 indexed pollId,
        uint256 indexed commentId,
        address indexed creator
    );
}
