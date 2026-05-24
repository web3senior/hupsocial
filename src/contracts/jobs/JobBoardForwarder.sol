// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title JobBoardForwarder
 * @author Hup Labs
 * @notice ERC2771 meta-transaction forwarder for Hup Job Board interactions.
 * @dev Uses OpenZeppelin's ERC2771Forwarder to verify signed requests and forward calls to trusted
 *      recipient contracts that recover the original sender through ERC2771Context. The constructor
 *      name is used as the EIP-712 signing domain name, so clients must sign requests with the same domain.
 * @custom:version 1.0.0
 * @custom:chain multi-chain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 📨
 */
contract JobBoardForwarder is ERC2771Forwarder {
    /**
     * @notice Initializes the EIP-712 signing domain for forwarded job board requests.
     * @param _name Signing domain name, for example "JobBoardForwarder".
     */
    constructor(string memory _name) ERC2771Forwarder(_name) {}
}