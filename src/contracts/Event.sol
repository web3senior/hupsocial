// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library Event {
    // Poll Lifecycle Events
    /// @dev Emitted when a new poll is successfully created.
    /// @param pollId The unique ID of the newly created poll.
    /// @param creator The address that created the poll.
    /// @param question The question string of the poll.
    event PollCreated(uint256 indexed pollId, address indexed creator, string question);

    /// @dev Emitted when an existing poll's details are updated.
    /// @param pollId The ID of the updated poll.
    /// @param updater The address that performed the update (should be the creator).
    event PollUpdated(uint256 indexed pollId, address indexed updater);

    /// @dev Emitted when the whitelist for a private poll is modified.
    /// @param pollId The ID of the poll whose whitelist was updated.
    /// @param updater The address that performed the update.
    event WhitelistUpdated(uint256 indexed pollId, address indexed updater);

    // User Interaction Events
    /// @dev Emitted when an account successfully casts a vote.
    /// @param pollId The ID of the poll that was voted on.
    /// @param voter The address that cast the vote.
    /// @param optionIndex The index of the option that was chosen.
    event Voted(uint256 indexed pollId, address indexed voter, uint256 optionIndex);
    
    /// @dev Emitted when a new comment is added to a poll.
    /// @param pollId The ID of the poll where the comment was added.
    /// @param commentId The unique ID of the new comment.
    /// @param commenter The address that submitted the comment.
    event CommentAdded(uint256 indexed pollId, uint256 indexed commentId, address indexed commenter);

    /// @dev Emitted when a user likes a poll.
    /// @param pollId The ID of the poll that was liked.
    /// @param liker The address that liked the poll.
    event PollLiked(uint256 indexed pollId, address indexed liker);

    /// @dev Emitted when a user unlikes a poll.
    /// @param pollId The ID of the poll that was unliked.
    /// @param unliker The address that unliked the poll.
    event PollUnliked(uint256 indexed pollId, address indexed unliker);

    // Financial Events
    /// @dev Emitted when the contract owner successfully withdraws ETH.
    /// @param to The address the funds were sent to (the owner).
    /// @param amount The amount of native token (LYX/ETH) withdrawn.
    /// @param timestamp The time of the withdrawal.
    event Withdrawal(address indexed to, uint256 amount, uint256 timestamp);
}
