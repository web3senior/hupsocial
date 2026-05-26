// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title HupForwarder
 * @author Hup Labs
 * @notice ERC2771 meta-transaction forwarder for Hup protocol interactions.
 * @dev Uses OpenZeppelin's ERC2771Forwarder to verify signed requests with signer nonces,
 *      deadlines, target addresses, call data, and EIP-712 domain separation. Trusted Hup
 *      contracts recover the original signer through ERC2771Context.
 * @custom:version 1.0.0
 * @custom:chain multichain
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