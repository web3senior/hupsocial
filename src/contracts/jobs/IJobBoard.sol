// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IJobBoard
 * @author Hup Labs
 * @notice Shared interface for Hup's on-chain job listing board.
 * @dev Defines job structs, events, errors, and public read/write functions for job board compatible contracts.
 * @custom:version 1.0.0
 * @custom:chain multi-chain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💼
 */
interface IJobBoard {
    struct Job {
        uint256 id;
        uint256 businessId;
        address employer;
        string metadata;
        uint64 createdAt;
        uint64 expiresAt;
        bool featured;
        bool active;
    }

    event JobPosted(
        uint256 indexed jobId,
        uint256 indexed businessId,
        address indexed employer,
        string metadata,
        bool featured,
        uint64 expiresAt
    );
    event JobUpdated(uint256 indexed jobId, string metadata);
    event JobClosed(uint256 indexed jobId);
    event JobFeatured(uint256 indexed jobId);
    event BusinessRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event FeesUpdated(uint256 listingFee, uint256 featuredFee);
    event ListingDurationUpdated(uint64 minDays, uint64 maxDays);
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);
    event Withdrawn(address indexed recipient, uint256 amount);

    error NotAdmin();
    error NotJobController();
    error JobNotFound();
    error JobExpired();
    error InvalidAddress();
    error InvalidBusiness();
    error InvalidPayment();
    error InvalidDuration();
    error InvalidMetadata();
    error MetadataTooLarge(uint256 length, uint256 maxLength);
    error AlreadyFeatured();
    error TransferFailed();

    function businessRegistry() external view returns (address);
    function listingFee() external view returns (uint256);
    function featuredFee() external view returns (uint256);
    function minListingDurationDays() external view returns (uint64);
    function maxListingDurationDays() external view returns (uint64);
    function maxMetadataBytes() external view returns (uint256);
    function nextJobId() external view returns (uint256);

    function postJob(
        uint256 businessId,
        string calldata metadata,
        uint64 durationDays,
        bool featured
    ) external payable returns (uint256 jobId);

    function updateJob(uint256 jobId, string calldata metadata) external;
    function closeJob(uint256 jobId) external;
    function featureJob(uint256 jobId) external payable;

    function getJob(uint256 jobId) external view returns (Job memory);
    function isJobActive(uint256 jobId) external view returns (bool);
    function getEmployerJobIds(address employer) external view returns (uint256[] memory);
    function getBusinessJobIds(uint256 businessId) external view returns (uint256[] memory);
    function getJobs(uint256 startIndex, uint256 count) external view returns (Job[] memory);
    function getBusinessJobs(uint256 businessId, uint256 startIndex, uint256 count) external view returns (Job[] memory);
}