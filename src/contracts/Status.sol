// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title StatusManager
/// @author Aratta Labs
/// @notice A decentralized status manager where each user stores a single, publicly viewable status with an optional expiration period.
/// @dev Implements Ownable for administration and Pausable for emergency shutdown. Uses a mapping to store one StatusData struct per address.
/// @custom:version 1.2
/// @custom:emoji 📝
/// @custom:security-contact atenyun@gmail.com
contract StatusManager is Ownable(msg.sender), Pausable {
    // --- State Variables ---

    /// @notice The maximum allowed byte length for a user's status message. Set by the contract owner.
    uint256 public maxLength;

    /// @dev Defines the structure for a user's single, current status.
    struct StatusData {
        /// @notice The main text content of the status message.
        string content;
        /// @notice A category or type identifier for the status (e.g., 'Mood', 'Building').
        string contentType;
        /// @notice Optional string for storing external metadata, such as a URI to a JSON file or IPFS hash.
        string metadata;
        /// @notice The timestamp (in seconds) after which the status is considered "expired" or 0 if permanent.
        uint256 expirationTimestamp;
        /// @notice The time the status was last created or updated.
        uint256 timestamp;
    }

    /// @notice Stores the current, active StatusData struct for each unique user address.
    /// @dev This public mapping allows any external caller (including the frontend) to retrieve any user's status data directly using their address.
    mapping(address => StatusData) public statuses;

    // --- Events ---

    /// @notice Emitted when a user successfully creates or updates their status.
    /// @param user The address of the user who updated the status.
    /// @param content The new text content of the status.
    /// @param statusType The type or category of the status.
    /// @param metadata The optional metadata string associated with the status.
    /// @param periodHours The duration in hours provided by the user.
    /// @param timestamp The time the update occurred (block.timestamp).
    event StatusUpdated(address indexed user, string content, string statusType, string metadata, uint256 periodHours, uint256 timestamp);

    /// @notice Emitted when a user successfully clears their current status.
    /// @param user The address of the user who deleted the status.
    /// @param timestamp The time the deletion occurred (block.timestamp).
    event StatusCleared(address indexed user, uint256 timestamp);

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
     * @notice Pauses the contract, preventing users from creating or clearing statuses.
     * @dev Only the contract owner can call this function. Calls the Pausable internal `_pause()`.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract, allowing users to resume status creation and clearing.
     * @dev Only the contract owner can call this function. Calls the Pausable internal `_unpause()`.
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @notice Updates the maximum allowed byte length for a status message.
     * @dev This prevents users from posting excessively long data on-chain. Only callable by the owner.
     * @param _maxLength The new maximum byte length limit for the status content.
     */
    function updateMaxLength(uint256 _maxLength) public onlyOwner {
        maxLength = _maxLength;
    }

    // --- Core User Functions ---

    /**
     * @notice Creates or updates the calling user's single status message.
     * @dev Sets an optional expiration timestamp based on the provided duration in hours. Requires the content to be non-empty and under the configured maxLength. This function is restricted by the Pausable modifier `whenNotPaused`.
     * @param _statusContent The new text content for the status. Cannot be empty.
     * @param _statusType The category or type of the status (e.g., "status", "mood").
     * @param _metadata Optional string for structured data (e.g., a link to an IPFS JSON file).
     * @param _periodHours The duration in **hours** for which the status should remain active. Use 0 for a permanent status.
     */
    function updateStatus(string memory _statusContent, string memory _statusType, string memory _metadata, uint256 _periodHours) public whenNotPaused {
        // Require that the status content is not empty.
        require(bytes(_statusContent).length > 0, "Status content cannot be empty.");
        // Ensure the status does not exceed the maximum allowed length.
        require(bytes(_statusContent).length <= maxLength, "Status exceeds maximum allowed length.");

        uint256 expirationTimestamp;
        // Calculate the actual expiration timestamp if a duration is provided.
        if (_periodHours == 0) {
            expirationTimestamp = 0; // 0 indicates the status is permanent.
        } else {
            // Converts input hours to seconds and adds to the current timestamp.
            expirationTimestamp = block.timestamp + (_periodHours * 1 hours);
        }

        // Store the new StatusData, overwriting the previous one.
        statuses[msg.sender] = StatusData(_statusContent, _statusType, _metadata, expirationTimestamp, block.timestamp);

        // Emit an event to log the update, which is crucial for off-chain indexing.
        emit StatusUpdated(msg.sender, _statusContent, _statusType, _metadata, _periodHours, block.timestamp);
    }

    /**
     * @notice Clears the content of the calling user's current status (soft delete).
     * @dev Performs a soft delete by setting the `content` field to an empty string (""). This signals off-chain applications to stop displaying the status. This function is restricted by the Pausable modifier `whenNotPaused`.
     */
    function clearStatus() public whenNotPaused {
        // Only modify the content field, effectively 'deleting' the status visually.
        statuses[msg.sender].content = "";
        emit StatusCleared(msg.sender, block.timestamp);
    }
}
