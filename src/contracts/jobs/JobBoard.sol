// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./IBusinessRegistry.sol";
import "./IJobBoard.sol";

/**
 * @title Hup Job Board
 * @author Hup Labs
 * @notice Paid on-chain job listings for Hup businesses with optional featured placement.
 * @dev Stores compact job metadata references on-chain and checks BusinessRegistry permissions before
 *      creating or managing listings. Full job and business details should be resolved off-chain from metadata.
 * @custom:version 1.0.0
 * @custom:chain multi-chain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💼
 */
contract JobBoard is IJobBoard, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2048;
    uint64 public constant ABSOLUTE_MAX_LISTING_DURATION_DAYS = 365;

    IBusinessRegistry private _businessRegistry;

    uint256 public override listingFee;
    uint256 public override featuredFee;
    uint64 public override minListingDurationDays = 1;
    uint64 public override maxListingDurationDays = 90;
    uint256 public override maxMetadataBytes = 256;
    uint256 public override nextJobId = 1;

    mapping(uint256 => Job) private jobs;
    mapping(address => uint256[]) private employerJobIds;
    mapping(uint256 => uint256[]) private businessJobIds;

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, _msgSender())) revert NotAdmin();
        _;
    }

    modifier existingJob(uint256 jobId) {
        if (jobs[jobId].id == 0) revert JobNotFound();
        _;
    }

    modifier onlyJobController(uint256 jobId) {
        if (!_canManageJob(jobId, _msgSender())) revert NotJobController();
        _;
    }

    constructor(
        address trustedForwarder,
        address admin,
        address registry,
        uint256 initialListingFee,
        uint256 initialFeaturedFee
    ) ERC2771Context(trustedForwarder) {
        if (admin == address(0) || registry == address(0)) revert InvalidAddress();

        _businessRegistry = IBusinessRegistry(registry);
        listingFee = initialListingFee;
        featuredFee = initialFeaturedFee;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);

        emit BusinessRegistryUpdated(address(0), registry);
        emit FeesUpdated(initialListingFee, initialFeaturedFee);
    }

    function businessRegistry() external view override returns (address) {
        return address(_businessRegistry);
    }

    function postJob(
        uint256 businessId,
        string calldata metadata,
        uint64 durationDays,
        bool featured
    ) external payable override whenNotPaused nonReentrant returns (uint256 jobId) {
        address sender = _msgSender();

        if (!_businessRegistry.canManageBusiness(businessId, sender)) revert InvalidBusiness();

        _validateMetadata(metadata);
        _validateDuration(durationDays);

        uint256 requiredPayment = listingFee + (featured ? featuredFee : 0);
        if (msg.value != requiredPayment) revert InvalidPayment();

        jobId = nextJobId++;

        uint64 createdAt = uint64(block.timestamp);
        uint64 expiresAt = uint64(block.timestamp + uint256(durationDays) * 1 days);

        jobs[jobId] = Job({
            id: jobId,
            businessId: businessId,
            employer: sender,
            metadata: metadata,
            createdAt: createdAt,
            expiresAt: expiresAt,
            featured: featured,
            active: true
        });

        employerJobIds[sender].push(jobId);
        businessJobIds[businessId].push(jobId);

        emit JobPosted(jobId, businessId, sender, metadata, featured, expiresAt);
    }

    function updateJob(
        uint256 jobId,
        string calldata metadata
    ) external override existingJob(jobId) onlyJobController(jobId) whenNotPaused {
        Job storage job = jobs[jobId];

        if (!_isActive(job)) revert JobExpired();

        _validateMetadata(metadata);

        job.metadata = metadata;

        emit JobUpdated(jobId, metadata);
    }

    function closeJob(uint256 jobId) external override existingJob(jobId) onlyJobController(jobId) whenNotPaused {
        Job storage job = jobs[jobId];

        if (!job.active) revert JobExpired();

        job.active = false;

        emit JobClosed(jobId);
    }

    function featureJob(
        uint256 jobId
    ) external payable override existingJob(jobId) onlyJobController(jobId) whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];

        if (!_isActive(job)) revert JobExpired();
        if (job.featured) revert AlreadyFeatured();
        if (msg.value != featuredFee) revert InvalidPayment();

        job.featured = true;

        emit JobFeatured(jobId);
    }

    function getJob(uint256 jobId) external view override existingJob(jobId) returns (Job memory) {
        return jobs[jobId];
    }

    function isJobActive(uint256 jobId) external view override existingJob(jobId) returns (bool) {
        return _isActive(jobs[jobId]);
    }

    function getEmployerJobIds(address employer) external view override returns (uint256[] memory) {
        return employerJobIds[employer];
    }

    function getBusinessJobIds(uint256 businessId) external view override returns (uint256[] memory) {
        return businessJobIds[businessId];
    }

    function getJobs(uint256 startIndex, uint256 count) external view override returns (Job[] memory) {
        uint256 total = nextJobId - 1;

        if (total == 0 || startIndex >= total || count == 0) {
            return new Job[](0);
        }

        uint256 remaining = total - startIndex;
        uint256 returnCount = count > remaining ? remaining : count;
        Job[] memory result = new Job[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 jobId = total - (startIndex + i);
            result[i] = jobs[jobId];
        }

        return result;
    }

    function getBusinessJobs(
        uint256 businessId,
        uint256 startIndex,
        uint256 count
    ) external view override returns (Job[] memory) {
        uint256[] storage ids = businessJobIds[businessId];
        uint256 total = ids.length;

        if (total == 0 || startIndex >= total || count == 0) {
            return new Job[](0);
        }

        uint256 remaining = total - startIndex;
        uint256 returnCount = count > remaining ? remaining : count;
        Job[] memory result = new Job[](returnCount);

        for (uint256 i = 0; i < returnCount; i++) {
            uint256 id = ids[total - 1 - (startIndex + i)];
            result[i] = jobs[id];
        }

        return result;
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function setBusinessRegistry(address newRegistry) external onlyAdmin {
        if (newRegistry == address(0)) revert InvalidAddress();

        address oldRegistry = address(_businessRegistry);
        _businessRegistry = IBusinessRegistry(newRegistry);

        emit BusinessRegistryUpdated(oldRegistry, newRegistry);
    }

    function setFees(uint256 newListingFee, uint256 newFeaturedFee) external onlyAdmin {
        listingFee = newListingFee;
        featuredFee = newFeaturedFee;

        emit FeesUpdated(newListingFee, newFeaturedFee);
    }

    function setListingDuration(uint64 minDays, uint64 maxDays) external onlyAdmin {
        if (minDays == 0 || maxDays < minDays || maxDays > ABSOLUTE_MAX_LISTING_DURATION_DAYS) {
            revert InvalidDuration();
        }

        minListingDurationDays = minDays;
        maxListingDurationDays = maxDays;

        emit ListingDurationUpdated(minDays, maxDays);
    }

    function setMaxMetadataBytes(uint256 newMaxMetadataBytes) external onlyAdmin {
        if (newMaxMetadataBytes == 0 || newMaxMetadataBytes > ABSOLUTE_MAX_METADATA_BYTES) {
            revert InvalidMetadata();
        }

        uint256 oldValue = maxMetadataBytes;
        maxMetadataBytes = newMaxMetadataBytes;

        emit MaxMetadataBytesUpdated(oldValue, newMaxMetadataBytes);
    }

    function withdraw(address payable recipient) external onlyAdmin nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();

        uint256 balance = address(this).balance;
        if (balance == 0) revert TransferFailed();

        (bool success, ) = recipient.call{value: balance}("");
        if (!success) revert TransferFailed();

        emit Withdrawn(recipient, balance);
    }

    function _canManageJob(uint256 jobId, address account) internal view returns (bool) {
        Job storage job = jobs[jobId];

        return hasRole(ADMIN_ROLE, account) || _businessRegistry.canManageBusiness(job.businessId, account);
    }

    function _validateMetadata(string calldata metadata) internal view {
        uint256 metadataLength = bytes(metadata).length;

        if (metadataLength == 0) revert InvalidMetadata();
        if (metadataLength > maxMetadataBytes) {
            revert MetadataTooLarge(metadataLength, maxMetadataBytes);
        }
    }

    function _validateDuration(uint64 durationDays) internal view {
        if (durationDays < minListingDurationDays || durationDays > maxListingDurationDays) {
            revert InvalidDuration();
        }
    }

    function _isActive(Job storage job) internal view returns (bool) {
        return job.active && block.timestamp < job.expiresAt;
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

    receive() external payable {}
}