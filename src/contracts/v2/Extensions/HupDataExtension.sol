// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol"; // Import the separate interface file cleanly

/**
 * @title HupDataExtension
 * @notice Allows post creators to attach arbitrary metadata or custom features to their posts later.
 */
contract HupDataExtension {
    IHup public immutable hupContract;

    // Mapping from postId to custom cryptographic keys to string values
    mapping(uint256 => mapping(bytes32 => string)) public extensionStorage;

    event ExtensionDataSet(uint256 indexed postId, bytes32 indexed key, string value);

    constructor(address _hupAddress) {
        hupContract = IHup(_hupAddress);
    }

    /**
     * @notice Allows only the original content creator to attach data fields.
     */
    function setExtensionKey(uint256 _postId, bytes32 _key, string calldata _val) external {
        // Fetch structural information from the main core protocol deployment via the interface
        (, , , , , address creator, , , bool isDeleted, ,) = hupContract.allContent(_postId);
        
        // Enforce state validations and permission constraints
        if (isDeleted) revert("Core content has been deleted");
        if (creator != msg.sender) revert("Only the original creator can add extensions");

        extensionStorage[_postId][_key] = _val;
        emit ExtensionDataSet(_postId, _key, _val);
    }
}