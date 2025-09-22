// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Events
/// @author Aratta Labs
/// @notice Defines all events emitted by the Poll contract for on-chain logging.
contract Event {
    // Poll Lifecycle Events
    /// @dev Emitted when a new poll is created.
    /// @param pollId The ID of the newly created poll.
    /// @param creator The address that created the poll.
    /// @param question The question of the poll.
    event PollCreated(uint256 indexed pollId, address indexed creator, string question);

    /// @dev Emitted when a poll is updated.
    /// @param pollId The ID of the poll that was updated.
    /// @param updater The address of the account that updated the poll.
    event PollUpdated(uint256 indexed pollId, address indexed updater);

    /// @dev Emitted when the whitelist of a poll is updated.
    /// @param pollId The ID of the poll whose whitelist was updated.
    /// @param manager The address that updated the whitelist.
    event WhitelistUpdated(uint256 indexed pollId, address indexed manager);

    // User Interaction Events
    /// @dev Emitted when a user successfully casts a vote in a poll.
    /// @param pollId The ID of the poll.
    /// @param voter The address of the voter.
    /// @param optionIndex The index of the option that was voted for.
    event Voted(uint256 indexed pollId, address indexed voter, uint256 optionIndex);

    /// @dev Emitted when a user likes a poll.
    /// @param pollId The ID of the poll that was liked.
    /// @param liker The address that liked the poll.
    event PollLiked(uint256 indexed pollId, address indexed liker);

    /// @dev Emitted when a user unlikes a poll.
    /// @param pollId The ID of the poll that was unliked.
    /// @param unliker The address that unliked the poll.
    event PollUnliked(uint256 indexed pollId, address indexed unliker);

    /// @dev Emitted when a new comment is added to a poll.
    /// @param pollId The ID of the poll that the comment belongs to.
    /// @param commenter The address of the commenter.
    /// @param comment The content of the comment.
    event CommentAdded(uint256 indexed pollId, address indexed commenter, string comment);

    // Financial Events
    /// @dev Emitted when ETH is transferred from the contract's balance.
    /// @param recipient The address that receives the funds.
    /// @param amount The amount of ETH (in wei) that was withdrawn.
    /// @param timestamp The block timestamp at which the withdrawal occurred.
    event Withdrawal(address indexed recipient, uint256 amount, uint256 timestamp);
}
