// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev Emitted when ETH is transferred from the contract's balance.
/// @param recipient The address that receives the funds.
/// @param amount The amount of ETH (in wei) that was withdrawn.
/// @param timestamp The block timestamp at which the withdrawal occurred.
event Withdrawal(address indexed recipient, uint256 amount, uint256 timestamp);
event RespondAdded(bytes32 indexed pollId, uint256 totalResponse, address indexed sender);
event FeeUpdated(bytes32 indexed id, bytes32 brandId, address sender);
event Voted(uint256 indexed pollId, address indexed voter, uint256 optionIndex);
event PollUpdated(uint256 indexed pollId,  address indexed creator);
event CommentAdded(uint256 indexed pollId, address indexed commenter, string comment);
event PollLiked(uint256 indexed pollId, address indexed liker);
event PollCreated(uint256 indexed pollId, address indexed creator, string question);
event WhitelistUpdated(uint256 indexed pollId, address indexed manager);