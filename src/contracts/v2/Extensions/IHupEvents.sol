// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupEvents
 * @author Hup Labs
 * @notice Shared interface for the Hup Events protocol — a paid public events directory.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used
 *      by HupEvents-compatible contracts, clients, and offchain indexers. The metadata field is
 *      an IPFS CID pointing to a JSON document with the shape
 *      { title, description, organizerName, venue, city, timezone, url, image } where `timezone`
 *      is an optional IANA name (e.g. "Europe/Paris") and `url` is the external registration link.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 📅
 */
interface IHupEvents {
    // --- SHARED STRUCTS ---

    /// @dev Defines the structure for a single event listing. Only fields the contract or
    ///      indexer must trust and filter on live onchain — display data lives in the metadata
    ///      JSON on IPFS.
    struct EventListing {
        address organizer; // Address of the listing organizer, set once at listing
        uint64 startTime; // Event start, unix UTC seconds
        uint64 endTime; // Event end, unix UTC seconds, always >= startTime
        bool featured; // True when the paid featured tier is active (pinned/highlighted)
        bool hidden; // Moderator flag — indexers and clients suppress the listing, no refund
        bool canceled; // Organizer-set — the listing stays onchain as a historical record
        string metadata; // IPFS CID of the event JSON (length-capped)
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when an organizer pays the listing fee and lists a new event.
    /// @dev `feePaid` is the total native amount paid (listingFee, plus featuredFee when
    ///      `featured` is true) so indexers can attribute revenue without replaying fee config.
    event EventListed(uint256 indexed eventId, address indexed organizer, uint64 startTime, uint64 endTime, bool featured, uint256 feePaid, string metadata);

    /// @notice Emitted when an organizer updates an event's times or metadata.
    event EventUpdated(uint256 indexed eventId, uint64 startTime, uint64 endTime, string metadata);

    /// @notice Emitted when an organizer cancels an event. No refund is issued.
    event EventCanceled(uint256 indexed eventId);

    /// @notice Emitted when an organizer pays the featured surcharge to upgrade a listing.
    event EventFeatured(uint256 indexed eventId, uint256 feePaid);

    /// @notice Emitted when a moderator hides or unhides a listing. No refund is issued.
    event EventHiddenSet(uint256 indexed eventId, bool hidden, address indexed moderator);

    /// @notice Emitted when the Hup Core contract reference is updated.
    event HupContractUpdated(address oldValue, address newValue);

    /// @notice Emitted when the flat listing fee is updated.
    event ListingFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the featured surcharge is updated.
    event FeaturedFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the maximum event metadata byte length is updated.
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when a trusted forwarder's status is updated.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    /// @notice Emitted when accumulated fees are withdrawn by an admin.
    event Withdrawal(address indexed recipient, uint256 amount);

    /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
    event UnattributedDeposit(address indexed from, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidTimes();
    error InsufficientFee();
    error InvalidMetadata();
    error MetadataTooLarge(uint256 length, uint256 maxLength);
    error InvalidMetadataLimit();
    error EventNotFound();
    error NotOrganizer();
    error AlreadyFeatured();
    /// @notice The event was canceled by its organizer or hidden by a moderator.
    error EventInactive();
    error TransferFailed();
    error Unauthorized();
    error SessionExpired();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function hupContract() external view returns (IHup);
    function events(uint256 eventId)
        external
        view
        returns (
            address organizer,
            uint64 startTime,
            uint64 endTime,
            bool featured,
            bool hidden,
            bool canceled,
            string memory metadata
        );
    function nextEventId() external view returns (uint256);
    function ADMIN_ROLE() external view returns (bytes32);
    function MODERATOR_ROLE() external view returns (bytes32);
    function trustedForwarders(address forwarder) external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);
    function listingFee() external view returns (uint256);
    function featuredFee() external view returns (uint256);
    function maxMetadataBytes() external view returns (uint256);
    function ABSOLUTE_MAX_METADATA_BYTES() external view returns (uint256);
    function MAX_EVENTS_BATCH_READ_COUNT() external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Lists a new event in the directory for an exact native fee.
     * @dev msg.value must exactly equal listingFee, plus featuredFee when `_featured` is true.
     *      Anyone can list — the fee is the spam filter; moderators can hide abusive listings.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _startTime Event start, unix UTC seconds.
     * @param _endTime Event end, unix UTC seconds — must be >= `_startTime` and in the future.
     * @param _featured True to also pay the featured surcharge and pin/highlight the listing.
     * @param _metadata IPFS CID of the event JSON. See the interface @dev for the expected shape.
     * @return eventId The id assigned to the new event.
     */
    function listEvent(
        address _owner,
        uint64 _startTime,
        uint64 _endTime,
        bool _featured,
        string calldata _metadata
    ) external payable returns (uint256 eventId);

    /**
     * @notice Updates an event's times and/or metadata. Free of charge.
     * @dev Only the organizer can execute this. Times are only validated relative to each other
     *      (not against block.timestamp) so organizers can still fix metadata on past events.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _eventId The id of the event to update.
     * @param _startTime The new start time, unix UTC seconds.
     * @param _endTime The new end time, unix UTC seconds — must be >= `_startTime`.
     * @param _metadata The updated IPFS CID of the event JSON.
     */
    function updateEvent(
        address _owner,
        uint256 _eventId,
        uint64 _startTime,
        uint64 _endTime,
        string calldata _metadata
    ) external;

    /**
     * @notice Cancels an event. The listing stays onchain as a historical record; no refund.
     * @dev Only the organizer can execute this.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _eventId The id of the event to cancel.
     */
    function cancelEvent(address _owner, uint256 _eventId) external;

    /**
     * @notice Upgrades an existing listing to the featured tier for the exact featured surcharge.
     * @dev Only the organizer can execute this. msg.value must exactly equal featuredFee — the
     *      surcharge is defined on top of listingFee, so a later upgrade always costs exactly
     *      what listing featured upfront would have added.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _eventId The id of the event to feature.
     */
    function upgradeToFeatured(address _owner, uint256 _eventId) external payable;

    /**
     * @notice Hides or unhides a listing. Hidden listings are suppressed by indexers and
     *         clients; no refund is issued.
     * @dev Callable by MODERATOR_ROLE or ADMIN_ROLE (direct caller only, no meta-transactions).
     * @param _eventId The id of the event.
     * @param _hidden True to hide, false to restore.
     */
    function setHidden(uint256 _eventId, bool _hidden) external;

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Retrieves a single event listing.
     * @param _eventId The id of the event.
     */
    function getEvent(uint256 _eventId) external view returns (EventListing memory);

    /**
     * @notice Returns a page of event listings, oldest-first over the id sequence, alongside the
     *         total number of events ever listed. Capped at MAX_EVENTS_BATCH_READ_COUNT per call.
     * @dev Debug/backfill convenience — clients read the offchain index, not this.
     * @param _offset Zero-based index of the first event to return (event id = offset + 1).
     * @param _limit Maximum events to return (clamped to MAX_EVENTS_BATCH_READ_COUNT; 0 uses the max).
     * @return page The event listings in this page.
     * @return total Total number of events ever listed.
     */
    function getEvents(uint256 _offset, uint256 _limit) external view returns (EventListing[] memory page, uint256 total);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setHupContract(address _hupAddress) external;
    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    function setListingFee(uint256 _listingFee) external;
    function setFeaturedFee(uint256 _featuredFee) external;
    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external;
    function withdrawAll(address payable _receiver) external;
}
