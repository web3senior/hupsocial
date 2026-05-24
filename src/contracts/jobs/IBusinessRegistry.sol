// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IBusinessRegistry
 * @author Hup Labs
 * @notice Shared interface for Hup business profiles used by job listings and future business features.
 * @dev Defines business structs, events, errors, and permission checks consumed by Hup-compatible contracts.
 * @custom:version 1.0.0
 * @custom:chain multi-chain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🏢
 */
interface IBusinessRegistry {
    struct Business {
        uint256 id;
        address owner;
        string metadata;
        uint64 createdAt;
        bool active;
    }

    event BusinessCreated(uint256 indexed businessId, address indexed owner, string metadata);
    event BusinessUpdated(uint256 indexed businessId, string metadata);
    event BusinessAdminUpdated(uint256 indexed businessId, address indexed account, bool approved);
    event BusinessOwnershipTransferred(uint256 indexed businessId, address indexed oldOwner, address indexed newOwner);
    event BusinessDeactivated(uint256 indexed businessId);
    event BusinessReactivated(uint256 indexed businessId);
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);

    error NotAdmin();
    error NotBusinessController();
    error NotBusinessOwner();
    error BusinessNotFound();
    error InvalidAddress();
    error InvalidMetadata();
    error MetadataTooLarge(uint256 length, uint256 maxLength);

    function maxMetadataBytes() external view returns (uint256);
    function nextBusinessId() external view returns (uint256);

    function createBusiness(string calldata metadata) external returns (uint256 businessId);
    function updateBusiness(uint256 businessId, string calldata metadata) external;
    function setBusinessAdmin(uint256 businessId, address account, bool approved) external;
    function transferBusinessOwnership(uint256 businessId, address newOwner) external;
    function deactivateBusiness(uint256 businessId) external;
    function reactivateBusiness(uint256 businessId) external;

    function getBusiness(uint256 businessId) external view returns (Business memory);
    function getOwnerBusinessIds(address owner) external view returns (uint256[] memory);
    function businessExists(uint256 businessId) external view returns (bool);
    function isBusinessActive(uint256 businessId) external view returns (bool);
    function isBusinessAdmin(uint256 businessId, address account) external view returns (bool);
    function canManageBusiness(uint256 businessId, address account) external view returns (bool);
}