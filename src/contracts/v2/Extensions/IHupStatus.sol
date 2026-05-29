// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IHupStatus
 * @author Hup Labs
 * @notice Shared interface for the Hup Status Manager protocol.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used
 *      by HupStatus-compatible contracts, clients, and offchain indexers.
 * @custom:version 1.1.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 📜
 */
interface IHupStatus {
    // --- SHARED STRUCTS ---

    /// @dev Defines the structure for a user's single, current status.
    struct StatusData {
        string content;
        string contentType;
        string metadata;
        uint256 expirationTimestamp;
        uint256 timestamp;
    }

    // --- SHARED EVENTS ---

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

    /// @notice Emitted when the maximum status length limit is updated.
    event MaxLengthUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the trusted forwarder address is updated.
    event TrustedForwarderUpdated(address indexed forwarder);

    // --- SHARED ERRORS ---

    error Unauthorized();
    error StatusContentEmpty();
    error StatusLengthExceeded(uint256 length, uint256 maxLength);
    error InvalidAddress();

    // --- STATE GETTERS ---

    function maxLength() external view returns (uint256);
    function statuses(address user)
        external
        view
        returns (
            string memory content,
            string memory contentType,
            string memory metadata,
            uint256 expirationTimestamp,
            uint256 timestamp
        );
    function owner() external view returns (address);
    function paused() external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);

    // --- CORE MUTATIVE LOGIC ---

    /**
     * @notice Creates or updates the calling user's single status message.
     * @param _statusContent The new text content for the status. Cannot be empty.
     * @param _statusType The category or type of the status.
     * @param _metadata Optional string for structured data.
     * @param _periodHours The duration in **hours** for which the status should remain active. Use 0 for a permanent status.
     */
    function updateStatus(
        string calldata _statusContent,
        string calldata _statusType,
        string calldata _metadata,
        uint256 _periodHours
    ) external;

    /// @notice Clears the content of the calling user's current status (soft delete).
    function clearStatus() external;

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function updateMaxLength(uint256 _maxLength) external;
    function setTrustedForwarder(address _trustedForwarder) external;

    // --- OWNERSHIP ACTIONS ---

    function transferOwnership(address newOwner) external;
    function renounceOwnership() external;
}