// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ILSP7DigitalAsset as ILSP7} from "@lukso/lsp7-contracts/contracts/ILSP7DigitalAsset.sol";
import {ILSP8IdentifiableDigitalAsset as ILSP8} from "@lukso/lsp8-contracts/contracts/ILSP8IdentifiableDigitalAsset.sol";
import {ILSP26FollowerSystem as IFollowerSystem} from "@lukso/lsp26-contracts/contracts/ILSP26FollowerSystem.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./Counters.sol";
import "./Event.sol";
import "./Error.sol";

/// @title Poll
/// @author Aratta Labs
/// @notice Poll contract
/// @dev You will find the deployed contract addresses in the repo
/// @custom:version 1
/// @custom:emoji 📊
/// @custom:security-contact atenyun@gmail.com
contract Poll is Ownable(msg.sender), Pausable, ReentrancyGuard {
    // State Variables
    using Counters for Counters.Counter;

    Counters.Counter public pollCount;
    uint256 public fee = 0 ether;

    /// @dev A mapping to track the number of votes cast by each address per poll.
    mapping(uint256 => mapping(address => uint256)) public pollVotesCasted;

    /// @dev A mapping to track which option a specific voter chose for a given poll.
    mapping(uint256 => mapping(address => uint256)) public voterChoices;

    /// @dev A mapping to store poll data using a uint256 ID
    mapping(uint256 => PollData) public polls;

    mapping(uint256 => mapping(bytes32 => string)) public blockStorage;

    /// @dev A mapping to track the number of likes for each poll.
    mapping(uint256 => uint256) public pollLikes;

    /// @dev A mapping to track which addresses have liked a specific poll.
    mapping(uint256 => mapping(address => bool)) public pollLikedBy;

    // Structs
    /// @dev A struct to represent a single poll, including all relevant data.
    struct PollData {
        /// @dev The poll's metadata, which can contain a URI or other off-chain data.
        string metadata;
        /// @dev The question of the poll.
        string question;
        /// @dev An array of string options for the poll.
        string[] options;
        /// @dev The Unix timestamp when the poll starts.
        uint256 startTime;
        /// @dev The Unix timestamp when the poll ends.
        uint256 endTime;
        /// @dev The Unix timestamp when the poll was created.
        uint256 createdAt;
        /// @dev The maximum number of votes each account is allowed to cast.
        uint256 votesPerAccount;
        /// @dev The minimum token amount required to be a holder and vote.
        uint256 holderAmount;
        // 0 => public(anyone), 1 => private(whitelisted), 2 => onlyLYX(native token), 3 => onlyLSP7Holders, 4 => onlyLSP8Holders
        uint8 pollType;
        /// @dev A mapping to track which addresses are whitelisted to vote.
        mapping(address => bool) whitelist;
        /// @dev A mapping to store the total vote count for each option index.
        mapping(uint256 => uint256) votes;
        /// @dev The address of the account that created the poll.
        address creator;
        /// @dev The address of the LSP7 token required to vote, if `onlyHolder` is true.
        address token;
        /// @dev A boolean flag indicating whether comments are allowed on this poll.
        bool allowedComments;
    }

    /// @dev A struct for returning poll data without mappings.
    struct PollWithoutMappings {
        uint256 pollId;
        string metadata;
        string question;
        string[] options;
        uint256 startTime;
        uint256 endTime;
        uint256 createdAt;
        uint256 votesPerAccount;
        uint256 holderAmount;
        address creator;
        address token;
        uint8 pollType;
        bool allowedComments;
    }

    // Modifiers
    ///@dev Throws if called by any account other than the manager.
    modifier onlyManager(uint256 _pollId) {
        require(polls[_pollId].creator == _msgSender(), "Only the poll creator can update a poll.");
        _;
    }

    ///@dev Throws if called by an account not on the whitelist.
    modifier onlyWhitelisted(uint256 _pollId) {
        require(polls[_pollId].whitelist[_msgSender()], "Not whitelisted.");
        _;
    }

    /// @dev A modifier to check the common conditions for voting on a poll.
    modifier checkPollConditions(uint256 _pollId, uint256 _optionIndex) {
        PollData storage poll = polls[_pollId];
        require(block.timestamp >= poll.startTime && block.timestamp <= poll.endTime, "Poll is not in a voting period.");
        require(pollVotesCasted[_pollId][_msgSender()] < poll.votesPerAccount, "You have reached your voting limit for this poll.");
        require(_optionIndex < poll.options.length, "Invalid option index.");
        require(poll.options.length > 0, "Voting is not allowed on simple content.");
        _;
    }

    // Constructor
    constructor() {
        pollCount.increment();
        PollData storage newpoll = polls[pollCount.current()];
        newpoll.metadata = "";
        newpoll.question = unicode"Lorem Ipsum is simply dummy text";
        newpoll.options = ["Option 1", "Option 2", "Option 3"];
        newpoll.startTime = block.timestamp + 2 minutes;
        newpoll.endTime = block.timestamp + 1 days;
        newpoll.createdAt = block.timestamp;
        newpoll.votesPerAccount = 1;
        newpoll.creator = _msgSender();
        newpoll.token = address(0xddaAd340b0f1Ef65169Ae5E41A8b10776a75482d);
        newpoll.holderAmount = 1 ether;
        newpoll.allowedComments = true;
        newpoll.pollType = 0;
    }

    // External & Public Functions

    // Poll Management
    /// @notice Creates a new poll.
    function createPoll(
        string memory _metadata,
        string memory _question,
        string[] memory _options,
        uint256 _startTime,
        uint256 _endTime,
        address[] memory _whitelist,
        uint256 _votesPerAccount,
        uint8 _pollType,
        address _token,
        uint256 _holderAmount,
        bool _allowedComments
    ) external payable {
        require(msg.value >= fee, "Insufficient payment for poll creation.");
        if (_options.length > 0) {
            require(_startTime > block.timestamp + 3 minutes, "Start time must be at least 3 minutes in the future.");
            require(_endTime > _startTime, "End time must be after start time.");
            require(_options.length > 1, "A poll must have at least two options.");
            require(_votesPerAccount > 0, "A poll must have at least one vote per account.");
        }

        pollCount.increment();
        uint256 pollId = pollCount.current();
        PollData storage newPoll = polls[pollId];

        newPoll.metadata = _metadata;
        newPoll.question = _question;
        newPoll.options = _options;
        newPoll.startTime = _startTime;
        newPoll.endTime = _endTime;
        newPoll.createdAt = block.timestamp;
        if (_pollType == 1) {
            for (uint256 i = 0; i < _whitelist.length; i++) {
                newPoll.whitelist[_whitelist[i]] = true;
            }
        }
        newPoll.votesPerAccount = _votesPerAccount;
        newPoll.creator = _msgSender();
        newPoll.pollType = _pollType;
        newPoll.token = _token;
        newPoll.holderAmount = _holderAmount;
        newPoll.allowedComments = _allowedComments;

        emit Event.PollCreated(pollId, _msgSender(), _question);
    }

    /// @notice Updates an existing poll.
    /// @dev Can only be called by the poll creator. No edits are allowed after the first vote.
    function updatePoll(
        uint256 _pollId,
        string memory _metadata,
        string memory _question,
        string[] memory _options,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _votesPerAccount,
        uint8 _pollType,
        address _token,
        uint256 _holderAmount,
        bool _allowedComments
    ) external onlyManager(_pollId) returns (bool) {
        PollData storage updatedPoll = polls[_pollId];
        for (uint256 i = 0; i < _options.length; i++) {
            if (updatedPoll.votes[i] > 0) {
                revert("Cannot update poll after votes have been cast.");
            }
        }
        require(_endTime > _startTime, "End time must be after start time.");
        require(_options.length > 1, "A poll must have at least two options.");
        require(_votesPerAccount > 0, "A poll must have at least one vote per account.");

        updatedPoll.metadata = _metadata;
        updatedPoll.question = _question;
        updatedPoll.options = _options;
        updatedPoll.startTime = _startTime;
        updatedPoll.endTime = _endTime;
        updatedPoll.votesPerAccount = _votesPerAccount;
        updatedPoll.creator = _msgSender();
        updatedPoll.pollType = _pollType;
        updatedPoll.token = _token;
        updatedPoll.holderAmount = _holderAmount;
        updatedPoll.allowedComments = _allowedComments;

        emit Event.PollUpdated(_pollId, _msgSender());
        return true;
    }

    /// @notice Updates the whitelist for a specific poll by adding or removing addresses.
    /// @dev Can only be called by the poll creator.
    function updateWhitelist(uint256 _pollId, address[] memory _add, address[] memory _remove) external onlyManager(_pollId) {
        PollData storage poll = polls[_pollId];
        for (uint256 i = 0; i < _add.length; i++) {
            poll.whitelist[_add[i]] = true;
        }
        for (uint256 i = 0; i < _remove.length; i++) {
            delete poll.whitelist[_remove[i]];
        }
        emit Event.WhitelistUpdated(_pollId, _msgSender());
    }

    // Voting & Liking
    /// @notice Casts a vote for a specific poll option.
    function vote(uint256 _pollId, uint256 _optionIndex) external nonReentrant checkPollConditions(_pollId, _optionIndex) {
        PollData storage poll = polls[_pollId];
        if (poll.pollType == 1 && !poll.whitelist[_msgSender()]) {
            revert("Not whitelisted.");
        } else if (poll.pollType == 2) {
            if (address(_msgSender()).balance < poll.holderAmount) {
                revert("Insufficient LYX balance to vote.");
            }
        } else if (poll.pollType == 3) {
            uint256 balanceOf = ILSP7(poll.token).balanceOf(_msgSender());
            if (balanceOf < poll.holderAmount) {
                revert("Not a token holder or insufficient token amount.");
            }
        } else if (poll.pollType == 4) {
            uint256 balanceOf = ILSP8(poll.token).balanceOf(_msgSender());
            if (balanceOf < poll.holderAmount) {
                revert("Not a token holder or insufficient token amount.");
            }
        }

        poll.votes[_optionIndex]++;
        pollVotesCasted[_pollId][_msgSender()]++;
        voterChoices[_pollId][_msgSender()] = _optionIndex + 1;
        emit Event.Voted(_pollId, _msgSender(), _optionIndex);
    }

    /// @notice Allows a user to like a poll.
    function likePoll(uint256 _pollId) external nonReentrant {
        require(_pollId > 0 && _pollId <= pollCount.current(), "Invalid poll ID.");
        require(!pollLikedBy[_pollId][_msgSender()], "Poll already liked.");
        
        pollLikes[_pollId]++;
        pollLikedBy[_pollId][_msgSender()] = true;
        emit Event.PollLiked(_pollId, _msgSender());
    }

    /// @notice Allows a user to unlike a poll.
    function unlikePoll(uint256 _pollId) external nonReentrant {
        require(_pollId > 0 && _pollId <= pollCount.current(), "Invalid poll ID.");
        require(pollLikedBy[_pollId][_msgSender()], "Poll has not been liked by this account.");

        pollLikes[_pollId]--;
        pollLikedBy[_pollId][_msgSender()] = false;
        emit Event.PollUnliked(_pollId, _msgSender());
    }

    // Owner Functions
 
    function pause() public onlyOwner {
        _pause();
    }

  
    function unpause() public onlyOwner {
        _unpause();
    }

    /// @notice Updates the fee
    function updateFee(uint256 _fee) public onlyOwner {
        fee = _fee;
    }

    /// @notice Transfers the entire contract's ETH balance to the contract owner.
    function withdrawAll() public onlyOwner {
        uint256 amount = address(this).balance;
        require(amount > 0, "No balance");
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Failed");
        emit Event.Withdrawal(owner(), amount, block.timestamp);
    }

    /// @notice Withdraws a specific amount of an LSP7 token to a recipient.
    function withdrawToken(address _LSP7Token, address _to, uint256 _amount, bool _force, bytes memory _data) public onlyOwner {
        ILSP7(_LSP7Token).transfer(address(this), _to, _amount, _force, _data);
    }

    /// @notice Sets a key/value pair in the block storage for a specific poll.
    function setKey(uint256 _pollId, bytes32 _key, string memory _val) public onlyOwner returns (bool) {
        blockStorage[_pollId][_key] = _val;
        return true;
    }

    /// @notice Deletes a key/value pair from the block storage for a specific poll.
    function delKey(uint256 _pollId, bytes32 _key) public onlyOwner returns (bool) {
        delete blockStorage[_pollId][_key];
        return true;
    }

    // View Functions
    /// @notice Retrieves a paginated list of polls.
    function getPolls(uint256 _startIndex, uint256 _count) external view returns (PollWithoutMappings[] memory) {
        require(_startIndex > 0, "Start index must be greater than 0.");
        require(_startIndex + _count <= pollCount.current() + 1, "Exceeds total poll count.");

        PollWithoutMappings[] memory pollsArray = new PollWithoutMappings[](_count);

        for (uint256 i = 0; i < _count; i++) {
            uint256 pollId = _startIndex + i;
            PollData storage poll = polls[pollId];
            pollsArray[i] = PollWithoutMappings({
                pollId: pollId,
                metadata: poll.metadata,
                question: poll.question,
                options: poll.options,
                startTime: poll.startTime,
                endTime: poll.endTime,
                createdAt: poll.createdAt,
                votesPerAccount: poll.votesPerAccount,
                holderAmount: poll.holderAmount,
                creator: poll.creator,
                token: poll.token,
                allowedComments: poll.allowedComments,
                pollType: poll.pollType
            });
        }
        return pollsArray;
    }

    /// @notice A function to get the number of votes for a specific option.
    function getVoteCount(uint256 _pollId, uint256 _optionIndex) external view returns (uint256) {
        PollData storage poll = polls[_pollId];
        require(_optionIndex < poll.options.length, "Invalid option index.");
        return poll.votes[_optionIndex];
    }

    /// @notice A function to get all vote counts for all options in a poll.
    function getVoteCountsForPoll(uint256 _pollId) external view returns (uint256[] memory) {
        PollData storage poll = polls[_pollId];
        uint256[] memory counts = new uint256[](poll.options.length);
        for (uint256 i = 0; i < poll.options.length; i++) {
            counts[i] = poll.votes[i];
        }
        return counts;
    }

    /// @notice Returns the vote choice of a specific voter for a given poll.
    function getVoterChoice(uint256 _pollId, address _voter) external view returns (uint256) {
        return voterChoices[_pollId][_voter];
        // uint256 choice = voterChoices[_pollId][_voter];
        // if (choice > 0) {
        //     return choice - 1;
        // }
        // return 0;
    }

    /// @notice Gets the number of likes for a specific poll.
    function getPollLikeCount(uint256 _pollId) public view returns (uint256) {
        require(_pollId > 0 && _pollId <= pollCount.current(), "Invalid poll ID.");
        return pollLikes[_pollId];
    }

    /// @notice Checks if a user has liked a specific poll.
    function hasLiked(uint256 _pollId, address _user) public view returns (bool) {
        require(_pollId > 0 && _pollId <= pollCount.current(), "Invalid poll ID.");
        return pollLikedBy[_pollId][_user];
    }

    /// @notice Gets the value of a key from the block storage for a specific poll.
    function getKey(uint256 _pollId, bytes32 _key) public view returns (string memory) {
        return blockStorage[_pollId][_key];
    }

    // Internal Functions
    function _processFee() internal {
        if (fee > 0) {
            if (msg.value < fee) revert Errors.InsufficientPayment(msg.value);
            (bool success, ) = owner().call{value: msg.value}("");
            require(success, "Failed");
        }
    }
}
