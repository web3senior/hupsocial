// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./IBusinessRegistry.sol";

/**
 * @title Hup Business Registry
 * @author Hup Labs
 * @notice Onchain business profiles for Hup companies, teams, and organizations.
 * @dev Stores compact business metadata references on-chain and exposes reusable business permission
 *      checks for contracts such as JobBoard. Full business details should be resolved off-chain from metadata.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🏢
 */
contract BusinessRegistry is IBusinessRegistry, Pausable, AccessControl, ERC2771Context {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2048;

    uint256 public override maxMetadataBytes = 256;
    uint256 public override nextBusinessId = 1;

    mapping(uint256 => Business) private businesses;
    mapping(uint256 => mapping(address => bool)) private businessAdmins;
    mapping(address => uint256[]) private ownerBusinessIds;

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, _msgSender())) revert NotAdmin();
        _;
    }

    modifier existingBusiness(uint256 businessId) {
        if (businesses[businessId].id == 0) revert BusinessNotFound();
        _;
    }

    modifier onlyBusinessOwner(uint256 businessId) {
        if (businesses[businessId].owner != _msgSender()) revert NotBusinessOwner();
        _;
    }

    modifier onlyBusinessController(uint256 businessId) {
        if (!_canManageBusiness(businessId, _msgSender())) revert NotBusinessController();
        _;
    }

    constructor(address trustedForwarder, address admin) ERC2771Context(trustedForwarder) {
        if (admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function createBusiness(
        string calldata metadata
    ) external override whenNotPaused returns (uint256 businessId) {
        _validateMetadata(metadata);

        businessId = nextBusinessId++;
        address owner = _msgSender();

        businesses[businessId] = Business({
            id: businessId,
            owner: owner,
            metadata: metadata,
            createdAt: uint64(block.timestamp),
            active: true
        });

        ownerBusinessIds[owner].push(businessId);

        emit BusinessCreated(businessId, owner, metadata);
    }

    function updateBusiness(
        uint256 businessId,
        string calldata metadata
    ) external override existingBusiness(businessId) onlyBusinessController(businessId) whenNotPaused {
        _validateMetadata(metadata);

        businesses[businessId].metadata = metadata;

        emit BusinessUpdated(businessId, metadata);
    }

    function setBusinessAdmin(
        uint256 businessId,
        address account,
        bool approved
    ) external override existingBusiness(businessId) onlyBusinessOwner(businessId) whenNotPaused {
        if (account == address(0)) revert InvalidAddress();

        businessAdmins[businessId][account] = approved;

        emit BusinessAdminUpdated(businessId, account, approved);
    }

    function transferBusinessOwnership(
        uint256 businessId,
        address newOwner
    ) external override existingBusiness(businessId) onlyBusinessOwner(businessId) whenNotPaused {
        if (newOwner == address(0)) revert InvalidAddress();

        Business storage business = businesses[businessId];
        address oldOwner = business.owner;

        business.owner = newOwner;
        _removeOwnerBusinessId(oldOwner, businessId);
        ownerBusinessIds[newOwner].push(businessId);

        emit BusinessOwnershipTransferred(businessId, oldOwner, newOwner);
    }

    function deactivateBusiness(
        uint256 businessId
    ) external override existingBusiness(businessId) onlyBusinessController(businessId) whenNotPaused {
        businesses[businessId].active = false;

        emit BusinessDeactivated(businessId);
    }

    function reactivateBusiness(
        uint256 businessId
    ) external override existingBusiness(businessId) onlyBusinessController(businessId) whenNotPaused {
        businesses[businessId].active = true;

        emit BusinessReactivated(businessId);
    }

    function getBusiness(uint256 businessId) external view override existingBusiness(businessId) returns (Business memory) {
        return businesses[businessId];
    }

    function getOwnerBusinessIds(address owner) external view override returns (uint256[] memory) {
        return ownerBusinessIds[owner];
    }

    function businessExists(uint256 businessId) external view override returns (bool) {
        return businesses[businessId].id != 0;
    }

    function isBusinessActive(uint256 businessId) external view override existingBusiness(businessId) returns (bool) {
        return businesses[businessId].active;
    }

    function isBusinessAdmin(uint256 businessId, address account) external view override returns (bool) {
        return businessAdmins[businessId][account];
    }

    function canManageBusiness(uint256 businessId, address account) external view override returns (bool) {
        return _canManageBusiness(businessId, account);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function setMaxMetadataBytes(uint256 newMaxMetadataBytes) external onlyAdmin {
        if (newMaxMetadataBytes == 0 || newMaxMetadataBytes > ABSOLUTE_MAX_METADATA_BYTES) {
            revert InvalidMetadata();
        }

        uint256 oldValue = maxMetadataBytes;
        maxMetadataBytes = newMaxMetadataBytes;

        emit MaxMetadataBytesUpdated(oldValue, newMaxMetadataBytes);
    }

    function _canManageBusiness(uint256 businessId, address account) internal view returns (bool) {
        Business storage business = businesses[businessId];

        if (business.id == 0 || !business.active || account == address(0)) return false;

        return business.owner == account || businessAdmins[businessId][account] || hasRole(ADMIN_ROLE, account);
    }

    function _validateMetadata(string calldata metadata) internal view {
        uint256 metadataLength = bytes(metadata).length;

        if (metadataLength == 0) revert InvalidMetadata();
        if (metadataLength > maxMetadataBytes) {
            revert MetadataTooLarge(metadataLength, maxMetadataBytes);
        }
    }

    function _removeOwnerBusinessId(address owner, uint256 businessId) internal {
        uint256[] storage ids = ownerBusinessIds[owner];
        uint256 length = ids.length;

        for (uint256 i = 0; i < length; i++) {
            if (ids[i] == businessId) {
                ids[i] = ids[length - 1];
                ids.pop();
                return;
            }
        }
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}