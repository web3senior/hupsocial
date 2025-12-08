// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PollPal
 * @dev A smart contract for creating and managing decentralized polls on the LUKSO network.
 */
contract PollPal is Ownable {

    // A mapping to store poll data
    mapping(uint256 => Poll) public polls;
    // A counter for the total number of polls
    uint256 public pollCount;
    // The address of the PollPal owner's Universal Profile (LSP0 ERC725 Account)
    address public pollPalManager;

    // A struct to represent a single poll
    struct Poll {
        string question;
        string[] options;
        uint256 startTime;
        uint256 endTime;
        uint256 votesPerAccount;
        mapping(address => uint256) votesCasted;
        mapping(uint256 => uint256) votes;
        bool active;
    }

    // Events for logging key actions
    event PollCreated(uint256 indexed pollId, string question, address indexed creator);
    event Voted(uint256 indexed pollId, address indexed voter, uint256 optionIndex);

    /**
     * @dev Constructor to initialize the contract with the manager's Universal Profile address.
     * @param _pollPalManager The address of the PollPal manager's Universal Profile.
     */
    constructor(address _pollPalManager) Ownable(msg.sender) {
        pollPalManager = _pollPalManager;
    }

    /**
     * @dev Creates a new poll.
     * @param _question The poll question.
     * @param _options The poll options.
     * @param _startTime The poll start time (Unix timestamp).
     * @param _endTime The poll end time (Unix timestamp).
     * @param _votesPerAccount The maximum number of votes each account can cast.
     */
    function createPoll(
        string memory _question,
        string[] memory _options,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _votesPerAccount
    ) external {
        require(msg.sender == pollPalManager, "Only the poll manager can create a poll");
        require(_startTime > block.timestamp + 3 minutes, "Start time must be at least 3 minutes in the future.");
        require(_endTime > _startTime, "End time must be after start time.");
        require(_options.length > 1, "A poll must have at least two options.");
        
        pollCount++;
        Poll storage newPoll = polls[pollCount];
        newPoll.question = _question;
        newPoll.options = _options;
        newPoll.startTime = _startTime;
        newPoll.endTime = _endTime;
        newPoll.votesPerAccount = _votesPerAccount;
        newPoll.active = true;

        emit PollCreated(pollCount, _question, msg.sender);
    }

    /**
     * @dev Casts a vote for a specific poll option.
     * @param _pollId The ID of the poll.
     * @param _optionIndex The index of the chosen option.
     */
    function vote(uint256 _pollId, uint256 _optionIndex) external {
        Poll storage poll = polls[_pollId];
        require(poll.active, "Poll is not active.");
        require(block.timestamp >= poll.startTime && block.timestamp <= poll.endTime, "Poll is not in a voting period.");
        require(poll.votesCasted[msg.sender] < poll.votesPerAccount, "You have reached your voting limit for this poll.");
        require(_optionIndex < poll.options.length, "Invalid option index.");

        poll.votes[_optionIndex]++;
        poll.votesCasted[msg.sender]++;

        emit Voted(_pollId, msg.sender, _optionIndex);
    }

    /**
     * @dev A function to end a poll.
     * @param _pollId The ID of the poll to end.
     */
    function endPoll(uint256 _pollId) external onlyOwner {
        Poll storage poll = polls[_pollId];
        require(poll.active, "Poll is already inactive.");
        poll.active = false;
    }

    /**
     * @dev A function to get the number of votes for a specific option.
     * @param _pollId The ID of the poll.
     * @param _optionIndex The index of the option.
     * @return The number of votes.
     */
    function getVoteCount(uint256 _pollId, uint256 _optionIndex) external view returns (uint256) {
        Poll storage poll = polls[_pollId];
        require(_optionIndex < poll.options.length, "Invalid option index.");
        return poll.votes[_optionIndex];
    }
}