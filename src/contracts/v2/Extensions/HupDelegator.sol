// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./../IHup.sol";

/**
 * @title HupDelegator
 * @author MCH01 Labs (Amir)
 * @notice Extension contract enabling popup-free interactions via authorized embedded session keys.
 */
contract HupDelegator is ReentrancyGuard, Pausable {

    // --- STRUCTS ---

    struct SessionConfig {
        uint256 expiry;       // Block timestamp when this embedded key loses access
        bool isActive;        // Manual toggle to revoke access instantly
    }

    // --- STATE VARIABLES ---

    IHup public immutable hupCore;

    /// @notice Maps primary user wallet => embedded session key wallet => configuration rules
    mapping(address => mapping(address => SessionConfig)) public sessions;

    // --- EVENTS ---

    event SessionAuthorized(address indexed primaryWallet, address indexed sessionKey, uint256 expiry);
    event SessionRevoked(address indexed primaryWallet, address indexed sessionKey);

    // --- CONSTRUCTOR ---

    constructor(address _hupCoreAddress) {
        require(_hupCoreAddress != address(0), "Invalid core address");
        hupCore = IHup(_hupCoreAddress);
    }

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Authorizes a local embedded session key to post or interact on behalf of the transaction sender.
     * @param _sessionKey The public key address generated locally in the user's browser.
     * @param _duration Valid window of time in seconds (e.g., 86400 for 24 hours).
     */
    function authorizeSession(address _sessionKey, uint256 _duration) external whenNotPaused {
        require(_sessionKey != address(0), "Invalid session key");
        
        uint256 expiryTime = block.timestamp + _duration;
        sessions[msg.sender][_sessionKey] = SessionConfig({
            expiry: expiryTime,
            isActive: true
        });

        emit SessionAuthorized(msg.sender, _sessionKey, expiryTime);
    }

    /**
     * @notice Instantly revokes an embedded session key's permissions.
     */
    function revokeSession(address _sessionKey) external {
        sessions[msg.sender][_sessionKey].isActive = false;
        emit SessionRevoked(msg.sender, _sessionKey);
    }

    /**
     * @notice Executes a profile action on Hup on behalf of a primary wallet using an authorized embedded key.
     * @dev Your core Hup contract cannot use _msgSender() here natively because the call comes from this contract, 
     * meaning you will need to add a small delegation-aware execution path to Hup or route through a custom executor.
     */
    function executeAsDelegate(
        address _primaryWallet,
        IHup.ContentType _type,
        string calldata _metadata,
        uint256 _parentId,
        bool _allowedComments
    ) external whenNotPaused nonReentrant returns (uint256) {
        SessionConfig memory config = sessions[_primaryWallet][msg.sender];
        
        // Enforce structural time boundaries and operational active checks
        if (!config.isActive) revert("Session is inactive or revoked");
        if (block.timestamp > config.expiry) revert("Session has expired");

        // Execute transaction action to core infrastructure...
        // Note: To map ownership cleanly to the _primaryWallet instead of this delegator contract, 
        // your main Hup contract needs to allow authorized extensions to specify the creator address.
    }
}