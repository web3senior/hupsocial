// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Note
/// @author Aratta Labs
/// @notice A decentralized status/note manager where each user stores a single, publicly viewable status with an optional expiration period.
/// @dev Implements Ownable for administration and Pausable for emergency shutdown. Uses a mapping to store one NoteData struct per address.
/// @custom:version 1.2
/// @custom:emoji 📝
/// @custom:security-contact atenyun@gmail.com
contract Note is Ownable(msg.sender), Pausable {
    // --- State Variables ---

    /// @notice The maximum allowed byte length for a user's status message. Set by the contract owner.
    uint256 public maxLength;

    /// @dev Defines the structure for a user's single, current note/status.
    struct NoteData {
        /// @notice The main text content of the note/status.
        string note;
        /// @notice A category or type identifier for the note (e.g., 'Status', 'Memo').
        string noteType;
        /// @notice The timestamp (in seconds) after which the note is considered "expired" or 0 if permanent.
        uint256 expirationTimestamp;
        /// @notice The time the note was last created or updated.
        uint256 timestamp;
    }

    /// @notice Stores the current, active NoteData struct for each unique user address.
    /// @dev This public mapping allows any external caller (including the frontend) to retrieve any user's note data directly using their address.
    mapping(address => NoteData) public notes;

    // --- Events ---

    /// @notice Emitted when a user successfully creates or updates their note.
    /// @param user The address of the user who updated the note.
    /// @param note The new content of the note.
    /// @param noteType The type or category of the note.
    /// @param periodHours The duration in hours provided by the user.
    /// @param timestamp The time the update occurred (block.timestamp).
    event NoteCreated(address indexed user, string note, string noteType, uint256 periodHours, uint256 timestamp);

    /// @notice Emitted when a user successfully clears their current note.
    /// @param user The address of the user who deleted the note.
    /// @param timestamp The time the deletion occurred (block.timestamp).
    event NoteDeleted(address indexed user, uint256 timestamp);

    /**
     * @notice Initializes the contract and sets the maximum allowed length for user status messages.
     * @dev The contract deploys with the caller as the initial owner and sets the initial content length limit.
     * @param _maxLength The initial maximum byte length for status content.
     */
    constructor(uint256 _maxLength) {
        maxLength = _maxLength;
    }

    // --- Administrative Functions ---

    /**
     * @notice Pauses the contract, preventing users from creating or deleting notes.
     * @dev Only the contract owner can call this function. Calls the Pausable internal `_pause()`.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract, allowing users to resume note creation and deletion.
     * @dev Only the contract owner can call this function. Calls the Pausable internal `_unpause()`.
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @notice Updates the maximum allowed byte length for a status message.
     * @dev This prevents users from posting excessively long data on-chain. Only callable by the owner.
     * @param _maxLength The new maximum byte length limit for the note content.
     */
    function updateMaxLength(uint256 _maxLength) public onlyOwner {
        maxLength = _maxLength;
    }

    // --- Core User Functions ---

    /**
     * @notice Creates or updates the calling user's single status/note.
     * @dev Sets an optional expiration timestamp based on the provided duration in hours. Requires the note content to be non-empty and under the configured maxLength. This function is restricted by the Pausable modifier `whenNotPaused`.
     * @param _note The new text content for the note. Cannot be empty.
     * @param _noteType The category or type of the note (e.g., "status", "mood").
     * @param _periodHours The duration in **hours** for which the note should remain active. Use 0 for a permanent status.
     */
    function updateNote(string memory _note, string memory _noteType, uint256 _periodHours) public whenNotPaused {
        // Require that the note content is not empty.
        require(bytes(_note).length > 0, "Note content cannot be empty.");
        // Ensure the note does not exceed the maximum allowed length.
        require(bytes(_note).length <= maxLength, "Note exceeds maximum allowed length.");

        uint256 expirationTimestamp;
        // Calculate the actual expiration timestamp if a duration is provided.
        if (_periodHours == 0) {
            expirationTimestamp = 0; // 0 indicates the note is permanent.
        } else {
            // Converts input hours to seconds and adds to the current timestamp.
            expirationTimestamp = block.timestamp + (_periodHours * 1 hours);
        }

        // Store the new NoteData, overwriting the previous one.
        notes[msg.sender] = NoteData(_note, _noteType, expirationTimestamp, block.timestamp);

        // Emit an event to log the creation, which is crucial for off-chain indexing.
        emit NoteCreated(msg.sender, _note, _noteType, _periodHours, block.timestamp);
    }

    /**
     * @notice Clears the content of the calling user's current note (soft delete).
     * @dev Performs a soft delete by setting the `note` field to an empty string (""). Since on-chain data cannot truly be deleted, this signals off-chain applications to stop displaying the status. This function is restricted by the Pausable modifier `whenNotPaused`.
     */
    function deleteNote() public whenNotPaused {
        // Only modify the content field, effectively 'deleting' the note visually.
        notes[msg.sender].note = "";
        emit NoteDeleted(msg.sender, block.timestamp);
    }
}
