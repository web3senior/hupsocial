// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IPollCommentManager
/// @notice Interface for the PollCommentManager contract, which handles comments for Polls.
interface IPollCommentManager {

    // Struct Definitions
    /// @notice A struct representing a single comment.
    struct Comment {
        uint256 commentId;
        address creator;
        string content;
        uint256 createdAt;
    }

    // External Functions (Write)

    /// @notice Allows a user to add a comment to a poll.
    function addComment(uint256 _pollId, string calldata _content) external;

    // View Functions (Read)

    /// @notice Retrieves all comments for a specific poll. (Expensive, use with caution)
    function getCommentsByPollId(uint256 _pollId) external view returns (Comment[] memory);

    /// @notice Retrieves a single comment by its array index within the poll's comment array.
    function getCommentByIndex(uint256 _pollId, uint256 _index) external view returns (Comment memory);

    /// @notice Retrieves a paginated list of comments for a specific poll.
    function getComments(
        uint256 _pollId,
        uint256 _startIndex,
        uint256 _count
    ) external view returns (Comment[] memory);

    /// @notice Retrieves all comments made by a specific user on a given poll.
    function getUserComments(uint256 _pollId, address _user) external view returns (Comment[] memory);
}
