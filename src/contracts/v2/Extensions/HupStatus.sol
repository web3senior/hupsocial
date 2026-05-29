// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./IHupStatus.sol";

/**
 * @title Hup Status
 * @author Hup Labs
 * @notice Minimal onchain status protocol for managing user statuses with optional expiration.
 * @dev Uses IHupStatus for shared events, errors, structs, and state getters. Supports rotatable ERC2771 trusted
 *      forwarders for meta-transactions, Ownable for admin permissions, and Pausable for emergency
 *      controls. Rich discovery, search, feeds, bookmarks, views, and global post routing are expected
 *      to be handled offchain by indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💬
 */
contract HupStatus is IHupStatus, Ownable, Pausable, ERC2771Context {
    // --- STATE VARIABLES ---

    /// @notice The maximum allowed byte length for a user's status message. Set by the contract owner.
    uint256 public override maxLength;

    /// @notice Stores the current, active StatusData struct for each unique user address.
    /// @dev This public mapping allows any external caller (including the frontend) to retrieve any user's status data directly using their address.
    mapping(address => StatusData) public override statuses;

    /// @dev Internal tracker for the mutable trusted forwarder address.
    address private _trustedForwarder;

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the contract and sets the maximum allowed length for user status messages.
     * @dev The contract deploys with the caller as the initial owner and sets the initial content length limit.
     * @param _maxLength The initial maximum byte length for status content.
     * @param _trustedForwarderAddress The address of the EIP-2771 compatible meta transaction relayer.
     */
    constructor(uint256 _maxLength, address _trustedForwarderAddress) 
        Ownable(_msgSender()) // Use _msgSender() to ensure correct owner is set even in gasless deployment
        ERC2771Context(_trustedForwarderAddress) 
    {
        maxLength = _maxLength;
        _trustedForwarder = _trustedForwarderAddress;
    }

    // --- CORE MUTATIVE LOGIC ---

    /**
     * @notice Creates or updates the calling user's single status message.
     * @dev Sets an optional expiration timestamp based on the provided duration in hours. Requires the content to be non-empty and under the configured maxLength. This function is restricted by the Pausable modifier `whenNotPaused`.
     * @param _statusContent The new text content for the status. Cannot be empty.
     * @param _statusType The category or type of the status (e.g., "status", "mood").
     * @param _metadata Optional string for structured data (e.g., a link to an IPFS JSON file).
     * @param _periodHours The duration in **hours** for which the status should remain active. Use 0 for a permanent status.
     */
    function updateStatus(
        string calldata _statusContent,
        string calldata _statusType,
        string calldata _metadata,
        uint256 _periodHours
    ) external override whenNotPaused {
        uint256 contentLen = bytes(_statusContent).length;
        if (contentLen == 0) revert StatusContentEmpty();
        if (contentLen > maxLength) revert StatusLengthExceeded(contentLen, maxLength);

        uint256 expirationTimestamp;
        // Calculate the actual expiration timestamp if a duration is provided.
        if (_periodHours == 0) {
            expirationTimestamp = 0; // 0 indicates the status is permanent.
        } else {
            // Converts input hours to seconds and adds to the current timestamp.
            expirationTimestamp = block.timestamp + (_periodHours * 1 hours);
        }
        
        // Use _msgSender() to get the original signer's address, supporting meta transactions.
        address user = _msgSender();

        // Store the new StatusData, overwriting the previous one.
        statuses[user] = StatusData({
            content: _statusContent,
            contentType: _statusType,
            metadata: _metadata,
            expirationTimestamp: expirationTimestamp,
            timestamp: block.timestamp
        });

        // Emit an event to log the update, which is crucial for off-chain indexing.
        emit StatusUpdated(user, _statusContent, _statusType, _metadata, _periodHours, block.timestamp);
    }

    /**
     * @notice Clears the content of the calling user's current status (soft delete).
     * @dev Performs a soft delete by setting the `content` field to an empty string (""). This signals off-chain applications to stop displaying the status. This function is restricted by the Pausable modifier `whenNotPaused`.
     */
    function clearStatus() external override whenNotPaused {
        // Use _msgSender() to get the original signer's address, supporting meta transactions.
        address user = _msgSender();
        
        // Only modify the content field, effectively 'deleting' the status visually.
        statuses[user].content = "";
        emit StatusCleared(user, block.timestamp);
    }

    // --- ADMIN CONFIGURATION ---

    /**
     * @notice Pauses the contract, preventing users from creating or clearing statuses.
     * @dev Only the contract owner can call this function. Calls the Pausable internal `_pause()`.
     */
    function pause() external override onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract, allowing users to resume status creation and clearing.
     * @dev Only the contract owner can call this function. Calls the Pausable internal `_unpause()`.
     */
    function unpause() external override onlyOwner {
        _unpause();
    }

    /**
     * @notice Updates the maximum allowed byte length for a status message.
     * @dev This prevents users from posting excessively long data on-chain. Only callable by the owner.
     * @param _maxLength The new maximum byte length limit for the status content.
     */
    function updateMaxLength(uint256 _maxLength) external override onlyOwner {
        uint256 oldValue = maxLength;
        maxLength = _maxLength;
        emit MaxLengthUpdated(oldValue, _maxLength);
    }
    
    /**
     * @notice Sets a new trusted forwarder address, updating EIP-2771 compatibility.
     * @dev Only callable by the owner.
     * @param _newTrustedForwarder The new trusted forwarder address.
     */
    function setTrustedForwarder(address _newTrustedForwarder) external override onlyOwner {
        if (_newTrustedForwarder == address(0)) revert InvalidAddress();
        _trustedForwarder = _newTrustedForwarder;
        emit TrustedForwarderUpdated(_newTrustedForwarder);
    }

    // --- OWNERSHIP ACTIONS ---

    /**
     * @notice Allows the current owner to transfer control of the contract to a newOwner.
     * @dev Resolves conflict between Ownable and IHupStatus interfaces.
     */
    function transferOwnership(address newOwner) public override(Ownable, IHupStatus) onlyOwner {
        Ownable.transferOwnership(newOwner);
    }

    /**
     * @notice Leaves the contract without an owner. Once the contract is renounced,
     *         there is no way to regain ownership.
     * @dev Resolves conflict between Ownable and IHupStatus interfaces.
     */
    function renounceOwnership() public override(Ownable, IHupStatus) onlyOwner {
        Ownable.renounceOwnership();
    }

    // --- INTERNAL & OVERRIDE HELPERS ---

    /**
     * @dev See EIP-2771. Returns true if the address is the trusted forwarder.
     */
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupStatus) returns (bool) {
        return forwarder == _trustedForwarder;
    }

    /**
     * @dev Returns the owner address. Inherited from Ownable.
     */
    function owner() public view override(Ownable, IHupStatus) returns (address) {
        return Ownable.owner();
    }

    /**
     * @dev Returns true if the contract is paused. Inherited from Pausable.
     */
    function paused() public view override(Pausable, IHupStatus) returns (bool) {
        return Pausable.paused();
    }

    /**
     * @dev Returns the original signer of the transaction, supporting meta-transactions.
     */
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    /**
     * @dev Returns the input call data, supporting meta-transactions.
     */
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    /**
     * @dev Returns the context suffix length, supporting meta-transactions.
     */
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}