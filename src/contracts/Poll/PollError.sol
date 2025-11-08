// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Custom Error Definitions
/// @author Aratta Labs
/// @notice Centralized contract to define all custom errors used throughout the project.
/// @custom:version 2
library PollError {
    
    // --- General Poll Management Errors (Poll.sol) ---

    /// @notice Thrown when the user provides an invalid Poll ID (e.g., 0 or out of range).
    error InvalidPollId(uint256 pollId);

    /// @notice Thrown when an account attempts to perform an action restricted to the poll creator.
    error OnlyPollCreator(address caller);

    /// @notice Thrown when the content string provided for a poll, comment, or metadata is empty.
    error EmptyContent();

    /// @notice Thrown when trying to update a poll after votes have already been cast.
    error CannotUpdateAfterVote();

    // --- Poll Creation & Timing Errors ---

    /// @notice Thrown when the poll start time is too soon or in the past.
    error PollStartTimeInvalid(uint256 startTime);

    /// @notice Thrown when the poll end time is before the start time.
    error PollEndTimeInvalid(uint256 endTime, uint256 startTime);
    
    /// @notice Thrown when a poll is created with fewer than two options.
    error NotEnoughOptions(uint256 count);

    /// @notice Thrown when the votes per account is set to zero.
    error InvalidVotesPerAccount();

    // --- Voting and Restriction Errors ---

    /// @notice Thrown when an account attempts to vote outside the defined start and end times.
    error PollNotActive(uint256 startTime, uint256 endTime);

    /// @notice Thrown when an account attempts to vote after reaching the `votesPerAccount` limit.
    error VotingLimitReached(uint256 votesCasted, uint256 votesAllowed);

    /// @notice Thrown when the option index provided is out of the valid range.
    error InvalidOptionIndex(uint256 optionIndex, uint256 maxIndex);

    /// @notice Thrown when an account attempts to vote on a private poll without being whitelisted.
    error NotWhitelisted(address voter);

    /// @notice Thrown when a vote requires a minimum LYX balance which the voter does not meet.
    error InsufficientLYXBalance(uint256 required, uint256 current);
    
    /// @notice Thrown when a vote requires a minimum token amount which the voter does not meet.
    error InsufficientTokenHolding(uint256 required, uint256 current);

    // --- Liking Errors ---

    /// @notice Thrown when an account attempts to like a poll that is already liked by them.
    error PollAlreadyLiked(address liker, uint256 pollId);

    /// @notice Thrown when an account attempts to unlike a poll that they have not liked.
    error PollNotLiked(address unliker, uint256 pollId);

    // --- Fee and Withdrawal Errors ---

    /// @notice Thrown when a required payment amount is not met for a function call.
    error InsufficientPayment(uint256 valueSent);

    /// @notice Thrown when attempting to withdraw funds, but the contract balance is zero.
    error NoBalanceToWithdraw();

    // --- Comment Manager Interface Errors ---

    /// @notice Thrown when the address provided for the comment manager is invalid (address(0)).
    error InvalidCommentManagerAddress(address addr);

    /// @notice Thrown when the address of the Poll contract is invalid.
    error InvalidPollContractAddress(address addr);
}
