// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupApps
 * @author Hup Labs
 * @notice Shared interface for the Hup Apps protocol — a paid mini app registry. Registered apps
 *         appear in the public directory, and those a moderator marks embeddable may additionally
 *         run inside a post as a sandboxed frame.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used by
 *      HupApps-compatible contracts, clients, and offchain indexers. The metadata field is an IPFS
 *      CID pointing to a JSON document with the shape
 *      { name, description, url, icon, tags, links, repo, aspectRatio } where `url` is the frame
 *      URL loaded when the app is embedded, `icon` is an image CID, `aspectRatio` is a "W:H" hint
 *      for the embed container (e.g. "1:1"), and `links` mirrors the directory's link list.
 *
 *      Listing is permissionless — the fee is the spam filter. Embedding is not: because an
 *      embedded app runs in a frame that can request signatures through the host bridge, the
 *      `embeddable` flag is moderator-granted and is revoked automatically whenever the owner
 *      points the listing at new metadata. Indexers MUST treat any AppUpdated as clearing
 *      embeddable, otherwise an owner could pass review with a benign URL and swap it afterwards.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🧩
 */
interface IHupApps {
    // --- SHARED STRUCTS ---

    /// @dev Defines the structure for a single app listing. Only fields the contract or indexer
    ///      must trust and filter on live onchain — display data lives in the metadata JSON on
    ///      IPFS. Field order packs owner/category/reviewedAt into one slot and the flags into
    ///      the next.
    struct AppListing {
        address owner; // Address of the listing owner, transferable
        uint32 category; // Directory category id, mirrors the offchain apps_category table
        uint64 reviewedAt; // Unix UTC seconds of the last embeddable grant; 0 when never reviewed
        bool featured; // True when the paid featured tier is active (pinned/highlighted)
        bool hidden; // Moderator flag — indexers and clients suppress the listing, no refund
        bool embeddable; // Moderator flag — gates in-post rendering, cleared on every update
        bool delisted; // Owner-set — the listing stays onchain as a historical record
        string metadata; // IPFS CID of the app JSON (length-capped)
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when an owner pays the listing fee and registers a new app.
    /// @dev `feePaid` is the total native amount paid (listingFee, plus featuredFee when
    ///      `featured` is true) so indexers can attribute revenue without replaying fee config.
    event AppRegistered(uint256 indexed appId, address indexed owner, uint32 category, bool featured, uint256 feePaid, string metadata);

    /// @notice Emitted when an owner updates an app's category or metadata.
    /// @dev Always clears `embeddable` — see the interface @dev for why indexers must honour this.
    event AppUpdated(uint256 indexed appId, uint32 category, string metadata);

    /// @notice Emitted when an owner delists an app. No refund is issued.
    event AppDelisted(uint256 indexed appId);

    /// @notice Emitted when an owner pays the featured surcharge to upgrade a listing.
    event AppFeatured(uint256 indexed appId, uint256 feePaid);

    /// @notice Emitted when an owner hands a listing to a new owner.
    event AppTransferred(uint256 indexed appId, address indexed oldOwner, address indexed newOwner);

    /// @notice Emitted when a moderator hides or unhides a listing. No refund is issued.
    event AppHiddenSet(uint256 indexed appId, bool hidden, address indexed moderator);

    /// @notice Emitted when a moderator grants or revokes in-post embedding for a listing.
    event AppEmbeddableSet(uint256 indexed appId, bool embeddable, address indexed moderator);

    /// @notice Emitted when the Hup Core contract reference is updated.
    event HupContractUpdated(address oldValue, address newValue);

    /// @notice Emitted when the flat listing fee is updated.
    event ListingFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the featured surcharge is updated.
    event FeaturedFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the maximum app metadata byte length is updated.
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when a trusted forwarder's status is updated.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    /// @notice Emitted when accumulated fees are withdrawn by an admin.
    event Withdrawal(address indexed recipient, uint256 amount);

    /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
    event UnattributedDeposit(address indexed from, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidCategory();
    error InsufficientFee();
    error InvalidMetadata();
    error MetadataTooLarge(uint256 length, uint256 maxLength);
    error InvalidMetadataLimit();
    error AppNotFound();
    error NotAppOwner();
    error AlreadyFeatured();
    /// @notice The app was delisted by its owner or hidden by a moderator.
    error AppInactive();
    error TransferFailed();
    error Unauthorized();
    error SessionExpired();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function hupContract() external view returns (IHup);
    function apps(uint256 appId)
        external
        view
        returns (
            address owner,
            uint32 category,
            uint64 reviewedAt,
            bool featured,
            bool hidden,
            bool embeddable,
            bool delisted,
            string memory metadata
        );
    function nextAppId() external view returns (uint256);
    function ADMIN_ROLE() external view returns (bytes32);
    function MODERATOR_ROLE() external view returns (bytes32);
    function trustedForwarders(address forwarder) external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);
    function listingFee() external view returns (uint256);
    function featuredFee() external view returns (uint256);
    function maxMetadataBytes() external view returns (uint256);
    function ABSOLUTE_MAX_METADATA_BYTES() external view returns (uint256);
    function MAX_APPS_BATCH_READ_COUNT() external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Registers a new app in the directory for an exact native fee.
     * @dev msg.value must exactly equal listingFee, plus featuredFee when `_featured` is true.
     *      Anyone can register — the fee is the spam filter; moderators can hide abusive listings.
     *      A new listing is never embeddable; that requires a separate moderator grant.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _category Directory category id, mirroring the offchain category table.
     * @param _featured True to also pay the featured surcharge and pin/highlight the listing.
     * @param _metadata IPFS CID of the app JSON. See the interface @dev for the expected shape.
     * @return appId The id assigned to the new app.
     */
    function registerApp(
        address _owner,
        uint32 _category,
        bool _featured,
        string calldata _metadata
    ) external payable returns (uint256 appId);

    /**
     * @notice Updates an app's category and/or metadata. Free of charge.
     * @dev Only the owner can execute this. Always clears `embeddable`, so an app that changes
     *      where it points must be re-reviewed before it can run inside posts again.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _appId The id of the app to update.
     * @param _category The new directory category id.
     * @param _metadata The updated IPFS CID of the app JSON.
     */
    function updateApp(
        address _owner,
        uint256 _appId,
        uint32 _category,
        string calldata _metadata
    ) external;

    /**
     * @notice Delists an app. The listing stays onchain as a historical record; no refund.
     * @dev Only the owner can execute this.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _appId The id of the app to delist.
     */
    function delistApp(address _owner, uint256 _appId) external;

    /**
     * @notice Hands a listing to a new owner. Free of charge.
     * @dev Only the current owner can execute this. The listing keeps its embeddable grant —
     *      the reviewed metadata has not changed, only who may edit it.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _appId The id of the app to transfer.
     * @param _newOwner The address receiving the listing.
     */
    function transferApp(address _owner, uint256 _appId, address _newOwner) external;

    /**
     * @notice Upgrades an existing listing to the featured tier for the exact featured surcharge.
     * @dev Only the owner can execute this. msg.value must exactly equal featuredFee — the
     *      surcharge is defined on top of listingFee, so a later upgrade always costs exactly
     *      what registering featured upfront would have added.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _appId The id of the app to feature.
     */
    function upgradeToFeatured(address _owner, uint256 _appId) external payable;

    /**
     * @notice Hides or unhides a listing. Hidden listings are suppressed by indexers and clients;
     *         no refund is issued.
     * @dev Callable by MODERATOR_ROLE or ADMIN_ROLE (direct caller only, no meta-transactions).
     * @param _appId The id of the app.
     * @param _hidden True to hide, false to restore.
     */
    function setHidden(uint256 _appId, bool _hidden) external;

    /**
     * @notice Grants or revokes the right for an app to run inside posts.
     * @dev Callable by MODERATOR_ROLE or ADMIN_ROLE (direct caller only, no meta-transactions).
     *      Granting stamps `reviewedAt` so clients can tell how stale a review is. This is the
     *      only path to embeddable — registering never sets it, and updating always clears it.
     * @param _appId The id of the app.
     * @param _embeddable True to allow in-post embedding, false to revoke.
     */
    function setEmbeddable(uint256 _appId, bool _embeddable) external;

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Retrieves a single app listing.
     * @param _appId The id of the app.
     */
    function getApp(uint256 _appId) external view returns (AppListing memory);

    /**
     * @notice Returns a page of app listings, oldest-first over the id sequence, alongside the
     *         total number of apps ever registered. Capped at MAX_APPS_BATCH_READ_COUNT per call.
     * @dev Debug/backfill convenience — clients read the offchain index, not this.
     * @param _offset Zero-based index of the first app to return (app id = offset + 1).
     * @param _limit Maximum apps to return (clamped to MAX_APPS_BATCH_READ_COUNT; 0 uses the max).
     * @return page The app listings in this page.
     * @return total Total number of apps ever registered.
     */
    function getApps(uint256 _offset, uint256 _limit) external view returns (AppListing[] memory page, uint256 total);

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
