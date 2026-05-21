// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title HupForwarder
 * @author Amir Rahimi
 * @notice Secure v5 meta-transaction forwarder featuring target-isolated nonces and deadlines.
 */
contract HupForwarder is ERC2771Forwarder {
    /**
     * @notice Initializes the EIP-712 signing domain configuration name tracker.
     * @param _name The signing domain string identity (e.g., "HupForwarder").
     */
    constructor(string memory _name) ERC2771Forwarder(_name) {}
}