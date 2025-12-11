// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./../Counters.sol";
import "./IPollCommentManager.sol";

/// @title PollCommentManager
/// @author Aratta Labs
/// @notice Dedicated contract for storing and managing comments for the Poll contracts.
/// @custom:version 1
/// @custom:emoji 💬
contract PollCommentManager is Ownable(msg.sender), ReentrancyGuard, IPollCommentManager {
        
    /// @notice Emitted when a new comment is added to a post.
    event CommentAdded(
        uint256 indexed pollId,
        uint256 indexed commentId,
        address indexed creator
    );

    using Counters for Counters.Counter;

    /// @dev Address of the main Poll contract. Used for reference/security checks.
    address public immutable pollContractAddress;

    /// @dev Counter for unique comment IDs across all polls.
    Counters.Counter internal commentCount;

    /// @dev Mapping from pollId to an array of Comment structs.
    mapping(uint256 => Comment[]) public pollComments;

    // Constructor
    /// @param _pollContractAddress The address of the deployed Poll contract.
    constructor(address _pollContractAddress) {
        require(_pollContractAddress != address(0), "Poll address cannot be zero.");
        pollContractAddress = _pollContractAddress;
    }

    // External Functions

    /// @notice Allows a user to add a comment to a poll.
    /// @dev This function currently assumes the poll exists and checks for allowedComments
    /// should ideally be done by cross-contract call to Poll.sol in a production environment,
    /// but is simplified here to avoid external contract interaction overhead.
    function addComment(uint256 _pollId, string calldata _content) external nonReentrant {
        // Since this contract is separate, we trust the caller passes a valid poll ID.

        require(bytes(_content).length > 0, "Comment content cannot be empty.");

        commentCount.increment();
        uint256 newCommentId = commentCount.current();

        pollComments[_pollId].push(
            Comment({
                commentId: newCommentId,
                creator: _msgSender(),
                content: _content,
                createdAt: block.timestamp
            })
        );

        emit CommentAdded(_pollId, newCommentId, _msgSender());
    }

    // View Functions

    /// @notice Retrieves all comments for a specific poll. (Caution: Expensive for large arrays)
    /// @param _pollId The ID of the poll to retrieve comments for.
    function getCommentsByPollId(uint256 _pollId) external view returns (Comment[] memory) {
        // We do not check pollCount here, as the Poll contract stores the count,
        // and calling external view functions costs more gas.
        return pollComments[_pollId];
    }

    /// @notice Retrieves a single comment by its array index within the poll's comment array.
    /// @param _pollId The ID of the poll.
    /// @param _index The 0-based index of the comment in the poll's comment array.
    function getCommentByIndex(uint256 _pollId, uint256 _index) external view returns (Comment memory) {
        require(_index < pollComments[_pollId].length, "Invalid comment index.");
        return pollComments[_pollId][_index];
    }

    /// @notice Retrieves a paginated list of comments for a specific poll.
    /// @param _pollId The ID of the poll.
    /// @param _startIndex The 0-based index to start reading from.
    /// @param _count The maximum number of comments to return.
    function getComments(
        uint256 _pollId,
        uint256 _startIndex,
        uint256 _count
    ) external view returns (Comment[] memory) {
        Comment[] storage comments = pollComments[_pollId];
        uint256 totalLength = comments.length;

        // Validation: If the start index is beyond the total length, return an empty array.
        if (_startIndex >= totalLength) {
            return new Comment[](0);
        }

        // Calculate the end index, clamping it to the array's total length.
        uint256 endIndex = _startIndex + _count;
        if (endIndex > totalLength) {
            endIndex = totalLength;
        }

        // Calculate the actual number of comments to retrieve.
        uint256 actualCount = endIndex - _startIndex;
        Comment[] memory result = new Comment[](actualCount);

        // Populate the result array.
        for (uint256 i = 0; i < actualCount; i++) {
            result[i] = comments[_startIndex + i];
        }

        return result;
    }

    /// @notice Retrieves all comments made by a specific user on a given poll.
    /// @param _pollId The ID of the poll to check comments for.
    /// @param _user The address of the user whose comments are being retrieved.
    function getUserComments(uint256 _pollId, address _user) external view returns (Comment[] memory) {
        Comment[] memory allComments = pollComments[_pollId];
        uint256 commentCountForUser = 0;
        
        // First pass: Count how many comments the user has made to size the final array
        for (uint256 i = 0; i < allComments.length; i++) {
            if (allComments[i].creator == _user) {
                commentCountForUser++;
            }
        }

        // Second pass: Create the array and populate it only with the user's comments
        Comment[] memory userComments = new Comment[](commentCountForUser);
        uint256 currentIndex = 0;

        for (uint256 i = 0; i < allComments.length; i++) {
            if (allComments[i].creator == _user) {
                userComments[currentIndex] = allComments[i];
                currentIndex++;
            }
        }

        return userComments;
    }
}
