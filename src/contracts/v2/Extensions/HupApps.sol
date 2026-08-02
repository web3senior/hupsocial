// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./IHupApps.sol";

/**
 * @title Hup Apps
 * @author Hup Labs
 * @notice Extension contract powering the Hup mini app registry — developers pay a flat native fee
 *         to list an app, with an optional featured surcharge tier. Listed apps appear in the
 *         public directory; apps a moderator additionally marks embeddable may run inside a post
 *         as a sandboxed frame.
 * @dev Uses IHupApps for shared events, errors, structs, and view structs. Integrates with Hup
 *      Core via IHup for burner session resolution. Supports rotatable ERC2771 trusted forwarders
 *      for meta-transactions, AccessControl for admin/moderator permissions, Pausable for
 *      emergency controls, and ReentrancyGuard for protected fee withdrawal. Payment is
 *      native-only; fees accumulate in the contract until swept by an admin.
 *
 *      Listing is permissionless but embedding is not, because an embedded app can request
 *      signatures from viewers through the host's bridge. `embeddable` is therefore granted only
 *      by a moderator and cleared automatically on every metadata update, so a listing cannot pass
 *      review pointing at one URL and later point somewhere else.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🧩
 */
contract HupApps is IHupApps, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2_048;
    uint256 public constant MAX_APPS_BATCH_READ_COUNT = 50;

    /// @notice The Hup Core contract instance, used to resolve burner sessions. Not immutable
    ///         so an admin can re-point it if Hup Core is redeployed on this chain.
    IHup public hupContract;

    /// @notice Maps app id to its listing
    mapping(uint256 => AppListing) public apps;

    /// @notice The id the next registered app will receive; ids start at 1 so 0 means "not found"
    uint256 public nextAppId = 1;

    mapping(address => bool) public trustedForwarders;

    /// @notice Flat fee (in wei) charged to register an app
    uint256 public listingFee = 0;

    /// @notice Surcharge (in wei) on top of listingFee for the featured tier. Defined as a
    ///         surcharge so upgrading an existing listing always costs exactly this amount.
    uint256 public featuredFee = 0;

    /// @notice The maximum allowed byte length for an app's metadata field
    uint256 public maxMetadataBytes = 256;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    modifier onlyDirectModerator() {
        if (!hasRole(MODERATOR_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the apps registry contract.
     * @param _hupAddress Address of the deployed core Hup contract.
     * @param _trustedForwarder Address of the initial EIP-2771 trusted forwarder (or address(0) to skip).
     * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     */
    constructor(address _hupAddress, address _trustedForwarder, address _admin) ERC2771Context(_trustedForwarder) {
        if (_hupAddress == address(0) || _admin == address(0)) revert InvalidAddress();

        hupContract = IHup(_hupAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        if (_trustedForwarder != address(0)) {
            trustedForwarders[_trustedForwarder] = true;
            emit TrustedForwarderUpdated(_trustedForwarder, true);
        }
    }

    // --- MUTATIVE LOGIC ---

    function registerApp(
        address _owner,
        uint32 _category,
        bool _featured,
        string calldata _metadata
    ) external payable whenNotPaused returns (uint256 appId) {
        _validateMetadata(_metadata);
        if (_category == 0) revert InvalidCategory();

        address developer = _resolveActor(_owner);

        if (msg.value != (_featured ? listingFee + featuredFee : listingFee)) revert InsufficientFee();

        appId = nextAppId++;

        // Registering never grants embedding — that is a separate moderator decision
        apps[appId] = AppListing({
            owner: developer,
            category: _category,
            reviewedAt: 0,
            featured: _featured,
            hidden: false,
            embeddable: false,
            delisted: false,
            metadata: _metadata
        });

        emit AppRegistered(appId, developer, _category, _featured, msg.value, _metadata);
    }

    function updateApp(
        address _owner,
        uint256 _appId,
        uint32 _category,
        string calldata _metadata
    ) external whenNotPaused {
        _validateMetadata(_metadata);
        if (_category == 0) revert InvalidCategory();

        AppListing storage app = _requireOwnedActiveApp(_owner, _appId);

        app.category = _category;
        app.metadata = _metadata;

        // Pointing a listing at new metadata invalidates the review it passed, so embedding is
        // withdrawn until a moderator looks at it again. Indexers mirror this on AppUpdated.
        app.embeddable = false;
        app.reviewedAt = 0;

        emit AppUpdated(_appId, _category, _metadata);
    }

    function delistApp(address _owner, uint256 _appId) external whenNotPaused {
        address developer = _resolveActor(_owner);
        AppListing storage app = apps[_appId];
        if (app.owner == address(0)) revert AppNotFound();
        if (app.owner != developer) revert NotAppOwner();
        if (app.delisted) revert AppInactive();

        app.delisted = true;
        app.embeddable = false;

        emit AppDelisted(_appId);
    }

    function transferApp(address _owner, uint256 _appId, address _newOwner) external whenNotPaused {
        if (_newOwner == address(0)) revert InvalidAddress();

        AppListing storage app = _requireOwnedActiveApp(_owner, _appId);
        address oldOwner = app.owner;

        // The reviewed metadata is unchanged, so the embeddable grant survives the handover
        app.owner = _newOwner;

        emit AppTransferred(_appId, oldOwner, _newOwner);
    }

    function upgradeToFeatured(address _owner, uint256 _appId) external payable whenNotPaused {
        AppListing storage app = _requireOwnedActiveApp(_owner, _appId);
        if (app.featured) revert AlreadyFeatured();

        if (msg.value != featuredFee) revert InsufficientFee();

        app.featured = true;

        emit AppFeatured(_appId, msg.value);
    }

    function setHidden(uint256 _appId, bool _hidden) external onlyDirectModerator {
        AppListing storage app = apps[_appId];
        if (app.owner == address(0)) revert AppNotFound();

        app.hidden = _hidden;

        emit AppHiddenSet(_appId, _hidden, msg.sender);
    }

    function setEmbeddable(uint256 _appId, bool _embeddable) external onlyDirectModerator {
        AppListing storage app = apps[_appId];
        if (app.owner == address(0)) revert AppNotFound();
        // Embedding a delisted or hidden app would resurrect it in the feed, so require it active
        if (_embeddable && (app.delisted || app.hidden)) revert AppInactive();

        app.embeddable = _embeddable;
        app.reviewedAt = _embeddable ? uint64(block.timestamp) : 0;

        emit AppEmbeddableSet(_appId, _embeddable, msg.sender);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getApp(uint256 _appId) external view returns (AppListing memory) {
        return apps[_appId];
    }

    function getApps(uint256 _offset, uint256 _limit) external view returns (AppListing[] memory page, uint256 total) {
        total = nextAppId - 1;

        if (_offset >= total) {
            return (new AppListing[](0), total);
        }

        uint256 limit = (_limit == 0 || _limit > MAX_APPS_BATCH_READ_COUNT) ? MAX_APPS_BATCH_READ_COUNT : _limit;
        uint256 end = _offset + limit;
        if (end > total) end = total;

        uint256 resultLength = end - _offset;
        page = new AppListing[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            // App ids start at 1, so the listing at zero-based index N has id N + 1
            page[i] = apps[_offset + i + 1];
        }
    }

    // --- ADMIN CONFIGURATION ---

    function pause() external onlyDirectAdmin {
        _pause();
    }

    function unpause() external onlyDirectAdmin {
        _unpause();
    }

    function setTrustedForwarder(address _forwarder, bool _trusted) external onlyDirectAdmin {
        if (_forwarder == address(0)) revert InvalidAddress();

        trustedForwarders[_forwarder] = _trusted;

        emit TrustedForwarderUpdated(_forwarder, _trusted);
    }

    function setHupContract(address _hupAddress) external onlyDirectAdmin {
        if (_hupAddress == address(0)) revert InvalidAddress();

        address oldValue = address(hupContract);
        hupContract = IHup(_hupAddress);

        emit HupContractUpdated(oldValue, _hupAddress);
    }

    function setListingFee(uint256 _listingFee) external onlyDirectAdmin {
        uint256 oldValue = listingFee;
        listingFee = _listingFee;

        emit ListingFeeUpdated(oldValue, _listingFee);
    }

    function setFeaturedFee(uint256 _featuredFee) external onlyDirectAdmin {
        uint256 oldValue = featuredFee;
        featuredFee = _featuredFee;

        emit FeaturedFeeUpdated(oldValue, _featuredFee);
    }

    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external onlyDirectAdmin {
        if (_maxMetadataBytes == 0 || _maxMetadataBytes > ABSOLUTE_MAX_METADATA_BYTES) {
            revert InvalidMetadataLimit();
        }

        uint256 oldValue = maxMetadataBytes;
        maxMetadataBytes = _maxMetadataBytes;

        emit MaxMetadataBytesUpdated(oldValue, _maxMetadataBytes);
    }

    function withdrawAll(address payable _receiver) external onlyDirectAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 balance = address(this).balance;
        if (balance == 0) revert TransferFailed();

        (bool success, ) = _receiver.call{value: balance}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(_receiver, balance);
    }

    // --- ROLE MANAGEMENT ---

    function grantRole(bytes32 role, address account) public override {
        if (!hasRole(getRoleAdmin(role), msg.sender)) revert Unauthorized();

        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override {
        if (!hasRole(getRoleAdmin(role), msg.sender)) revert Unauthorized();

        _revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address callerConfirmation) public override {
        if (callerConfirmation != msg.sender) revert Unauthorized();

        _revokeRole(role, callerConfirmation);
    }

    // --- INTERNAL & OVERRIDE HELPERS ---

    /**
     * @dev Reverts unless the metadata CID is present and within the configured byte cap.
     */
    function _validateMetadata(string calldata _metadata) internal view {
        if (bytes(_metadata).length == 0) revert InvalidMetadata();
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }
    }

    /**
     * @dev Resolves the caller, then loads the listing and asserts it exists, is owned by that
     *      caller, and has not been delisted or hidden.
     */
    function _requireOwnedActiveApp(address _owner, uint256 _appId) internal view returns (AppListing storage app) {
        address developer = _resolveActor(_owner);

        app = apps[_appId];
        if (app.owner == address(0)) revert AppNotFound();
        if (app.owner != developer) revert NotAppOwner();
        if (app.delisted || app.hidden) revert AppInactive();
    }

    /**
     * @dev Resolves the primary owner address based on burner session rules.
     */
    function _resolveActor(address _owner) internal view returns (address) {
        address sender = _msgSender();

        if (sender == address(0)) revert InvalidAddress();

        if (_owner == address(0) || _owner == sender) {
            return sender;
        }

        (address burnerKey, uint256 expiresAt) = hupContract.userSessions(_owner);
        if (burnerKey != sender) revert Unauthorized();
        if (block.timestamp >= expiresAt) revert SessionExpired();

        return _owner;
    }

    /**
     * @dev See EIP-2771. Returns true if the address is a trusted forwarder.
     */
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupApps) returns (bool) {
        return trustedForwarders[forwarder];
    }

    /**
     * @dev Returns the original signer of the transaction, supporting meta-transactions.
     */
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    /**
     * @dev Returns the input call data, supporting meta-transactions.
     */
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    /**
     * @dev Returns the context suffix length, supporting meta-transactions.
     */
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }

    receive() external payable {
        emit UnattributedDeposit(msg.sender, msg.value);
    }
}
