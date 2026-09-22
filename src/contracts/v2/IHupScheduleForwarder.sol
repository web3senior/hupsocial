// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IHupScheduleForwarder
 * @author Hup Labs
 * @notice Shared interface for the Hup Schedule Forwarder.
 * @dev Defines the signed request, events and custom errors used by HupScheduleForwarder, its
 *      relayer, clients and offchain indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji ⏰
 */
interface IHupScheduleForwarder {
    // --- SHARED STRUCTS ---

    /// @dev A call signed now and executable from `notBefore` until `deadline`. The nonce is any
    ///      unused number the signer picks, not a sequence position.
    struct ScheduledRequest {
        address from;
        address to;
        uint256 gas;
        uint256 nonce;
        uint48 notBefore;
        uint48 deadline;
        bytes data;
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when a scheduled request has been executed on its target.
    event ScheduledRequestExecuted(address indexed from, uint256 indexed nonce, address indexed to);

    /// @notice Emitted when a signer voids one of their own nonces before it was executed.
    event NonceCancelled(address indexed from, uint256 indexed nonce);

    // --- SHARED ERRORS ---

    error UntrustfulTarget(address target);
    error TooEarly(uint48 notBefore);
    error Expired(uint48 deadline);
    error NonceUsed(address from, uint256 nonce);
    error InvalidSignature(address from);

    // --- STATE GETTERS ---

    function nonceUsed(address from, uint256 nonce) external view returns (bool);

    // --- FUNCTIONS ---

    function version() external pure returns (string memory);

    function execute(ScheduledRequest calldata request, bytes calldata signature) external;

    function cancel(uint256 nonce) external;

    function verify(ScheduledRequest calldata request, bytes calldata signature) external view returns (bool);

    function hashRequest(ScheduledRequest calldata request) external view returns (bytes32);
}
