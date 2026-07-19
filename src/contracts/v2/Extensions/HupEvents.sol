// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./IHupEvents.sol";

/**
 * @title Hup Events
 * @author Hup Labs
 * @notice Extension contract powering a paid public events directory on Hup — organizers pay a
 *         flat native fee to list an event, with an optional featured surcharge tier.
 * @dev Uses IHupEvents for shared events, errors, structs, and view structs. Integrates with
 *      Hup Core via IHup for burner session resolution. Supports rotatable ERC2771 trusted
 *      forwarders for meta-transactions, AccessControl for admin/moderator permissions, Pausable
 *      for emergency controls, and ReentrancyGuard for protected fee withdrawal. Payment is
 *      native-only; fees accumulate in the contract until swept by an admin.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 📅
 */
contract HupEvents is IHupEvents, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2_048;
    uint256 public constant MAX_EVENTS_BATCH_READ_COUNT = 50;

    /// @notice The Hup Core contract instance, used to resolve burner sessions. Not immutable
    ///         so an admin can re-point it if Hup Core is redeployed on this chain.
    IHup public hupContract;

    /// @notice Maps event id to its listing
    mapping(uint256 => EventListing) public events;

    /// @notice The id the next listed event will receive; ids start at 1 so 0 means "not found"
    uint256 public nextEventId = 1;

    mapping(address => bool) public trustedForwarders;

    /// @notice Flat fee (in wei) charged to list an event
    uint256 public listingFee = 0;

    /// @notice Surcharge (in wei) on top of listingFee for the featured tier. Defined as a
    ///         surcharge so upgrading an existing listing always costs exactly this amount.
    uint256 public featuredFee = 0;

    /// @notice The maximum allowed byte length for an event's metadata field
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
     * @notice Initializes the events contract.
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

    function listEvent(
        address _owner,
        uint64 _startTime,
        uint64 _endTime,
        bool _featured,
        string calldata _metadata
    ) external payable whenNotPaused returns (uint256 eventId) {
        if (bytes(_metadata).length == 0) revert InvalidMetadata();
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }
        if (_startTime == 0 || _endTime < _startTime || _endTime <= block.timestamp) revert InvalidTimes();

        address organizer = _resolveActor(_owner);

        if (msg.value != (_featured ? listingFee + featuredFee : listingFee)) revert InsufficientFee();

        eventId = nextEventId++;

        events[eventId] = EventListing({
            organizer: organizer,
            startTime: _startTime,
            endTime: _endTime,
            featured: _featured,
            hidden: false,
            canceled: false,
            metadata: _metadata
        });

        emit EventListed(eventId, organizer, _startTime, _endTime, _featured, msg.value, _metadata);
    }

    function updateEvent(
        address _owner,
        uint256 _eventId,
        uint64 _startTime,
        uint64 _endTime,
        string calldata _metadata
    ) external whenNotPaused {
        if (bytes(_metadata).length == 0) revert InvalidMetadata();
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }
        // Times only validated relative to each other so metadata on past events stays fixable
        if (_startTime == 0 || _endTime < _startTime) revert InvalidTimes();

        address organizer = _resolveActor(_owner);
        EventListing storage evt = events[_eventId];
        if (evt.organizer == address(0)) revert EventNotFound();
        if (evt.organizer != organizer) revert NotOrganizer();
        if (evt.canceled || evt.hidden) revert EventInactive();

        evt.startTime = _startTime;
        evt.endTime = _endTime;
        evt.metadata = _metadata;

        emit EventUpdated(_eventId, _startTime, _endTime, _metadata);
    }

    function cancelEvent(address _owner, uint256 _eventId) external whenNotPaused {
        address organizer = _resolveActor(_owner);
        EventListing storage evt = events[_eventId];
        if (evt.organizer == address(0)) revert EventNotFound();
        if (evt.organizer != organizer) revert NotOrganizer();
        if (evt.canceled) revert EventInactive();

        evt.canceled = true;

        emit EventCanceled(_eventId);
    }

    function upgradeToFeatured(address _owner, uint256 _eventId) external payable whenNotPaused {
        address organizer = _resolveActor(_owner);
        EventListing storage evt = events[_eventId];
        if (evt.organizer == address(0)) revert EventNotFound();
        if (evt.organizer != organizer) revert NotOrganizer();
        if (evt.canceled || evt.hidden) revert EventInactive();
        if (evt.featured) revert AlreadyFeatured();

        if (msg.value != featuredFee) revert InsufficientFee();

        evt.featured = true;

        emit EventFeatured(_eventId, msg.value);
    }

    function setHidden(uint256 _eventId, bool _hidden) external onlyDirectModerator {
        EventListing storage evt = events[_eventId];
        if (evt.organizer == address(0)) revert EventNotFound();

        evt.hidden = _hidden;

        emit EventHiddenSet(_eventId, _hidden, msg.sender);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getEvent(uint256 _eventId) external view returns (EventListing memory) {
        return events[_eventId];
    }

    function getEvents(uint256 _offset, uint256 _limit) external view returns (EventListing[] memory page, uint256 total) {
        total = nextEventId - 1;

        if (_offset >= total) {
            return (new EventListing[](0), total);
        }

        uint256 limit = (_limit == 0 || _limit > MAX_EVENTS_BATCH_READ_COUNT) ? MAX_EVENTS_BATCH_READ_COUNT : _limit;
        uint256 end = _offset + limit;
        if (end > total) end = total;

        uint256 resultLength = end - _offset;
        page = new EventListing[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            // Event ids start at 1, so the listing at zero-based index N has id N + 1
            page[i] = events[_offset + i + 1];
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
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupEvents) returns (bool) {
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
