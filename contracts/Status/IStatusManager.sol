// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title IStatusManager
 * @notice The interface for the StatusManager contract, defining its public and external functions,
 * structs, and events for inter-contract communication and off-chain interaction.
 */
interface IStatusManager {
    // --- Structs (Must be defined exactly as in the contract) ---

    /// @dev Defines the structure for a user's single, current status.
    struct StatusData {
        string content;
        string contentType;
        string metadata;
        uint256 expirationTimestamp;
        uint256 timestamp;
    }

    // --- Events (Must be defined exactly as in the contract, including indexed parameters) ---

    /// @notice Emitted when a user successfully creates or updates their status.
    event StatusUpdated(
        address indexed user,
        string content,
        string indexed statusType,
        string metadata,
        uint256 periodHours,
        uint256 timestamp
    );

    /// @notice Emitted when a user successfully clears their current status.
    event StatusCleared(address indexed user, uint256 timestamp);

    // --- Public State Variable Getters ---

    /// @notice Returns the contract owner. Inherited from Ownable.
    function owner() external view returns (address);

    /// @notice Returns true if the contract is paused. Inherited from Pausable.
    function paused() external view returns (bool);

    /// @notice The maximum allowed byte length for a user's status message.
    function maxLength() external view returns (uint256);

    /// @notice Stores the current, active StatusData struct for each unique user address.
    /// @dev The interface function for the public mapping `statuses`.
    function statuses(address)
        external
        view
        returns (
            string memory content,
            string memory contentType,
            string memory metadata,
            uint256 expirationTimestamp,
            uint256 timestamp
        );

    // --- Administrative Functions (Owner) ---

    /// @notice Pauses the contract, preventing users from creating or clearing statuses.
    function pause() external;

    /// @notice Unpauses the contract, allowing users to resume status creation and clearing.
    function unpause() external;

    /// @notice Updates the maximum allowed byte length for a status message.
    function updateMaxLength(uint256 _maxLength) external;

    // --- Core User Functions ---

    /**
     * @notice Creates or updates the calling user's single status message.
     * @param _statusContent The new text content for the status. Cannot be empty.
     * @param _statusType The category or type of the status.
     * @param _metadata Optional string for structured data.
     * @param _periodHours The duration in **hours** for which the status should remain active. Use 0 for a permanent status.
     */
    function updateStatus(
        string memory _statusContent,
        string memory _statusType,
        string memory _metadata,
        uint256 _periodHours
    ) external;

    /// @notice Clears the content of the calling user's current status (soft delete).
    function clearStatus() external;

    // --- Inherited Ownable Functions ---

    /// @notice Allows the current owner to transfer control of the contract to a newOwner.
    function transferOwnership(address newOwner) external;
    
    /// @notice Leaves the contract without an owner. Once the contract is renounced,
    ///         there is no way to regain ownership.
    function renounceOwnership() external;
}