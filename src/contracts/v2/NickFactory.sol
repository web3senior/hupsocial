// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface INickFactory {
    // The standard Nick's Factory deployment function
    // It expects the salt followed immediately by the bytecode
    function deploy(bytes32 salt, bytes calldata bytecode) external returns (address);
}