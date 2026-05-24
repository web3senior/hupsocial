// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title HupForwarder
 * @author Hup Labs
 * @notice Meta-transaction forwarder for Hup contracts with target-scoped nonces and expiring requests.
 * @dev Verifies typed forward requests, tracks nonces per signer and target contract, and forwards
 *      calls to trusted recipient contracts that read the original sender through ERC2771Context.
 * @custom:version 1.0.0
 * @custom:chain multi-chain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 📨
 */
contract HupForwarder is ERC2771Forwarder {
    /**
     * @notice Initializes the EIP-712 signing domain configuration name tracker.
     * @param _name The signing domain string identity (e.g., "HupForwarder").
     */
    constructor(string memory _name) ERC2771Forwarder(_name) {}
}