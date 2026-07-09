// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title INameIt
 * @author NameIt Labs
 * @notice Shared interface for the NameIt naming service protocol.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used
 *      by NameIt-compatible contracts, clients, and offchain indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🆔
 */
interface INameIt {
    // --- SHARED STRUCTS ---

    /// @dev Defines a namespace (e.g. "hup", "celo") that domains can be registered under.
    struct RecordType {
        string name;
        uint256 price;
        string metadata;
        uint256 createdAt;
        address manager;
        uint8 percentage;
        bool paused;
    }

    /// @dev Defines a single registered domain. `tokenId` equals the ERC-721 token minted for it.
    struct Domain {
        uint256 recordTypeId;
        string name;
        bytes32 nodehash;
        string metadata;
        address manager;
        uint256 expiresAt;
    }

    /// @dev Lightweight summary used by list views to avoid returning full RecordType structs.
    struct RecordTypeSummary {
        uint256 id;
        string name;
        uint256 price;
        uint8 percentage;
        address manager;
    }

    /// @dev Optional EIP-2612 permit, bundled so registration/renewal can be paid without a prior approve tx.
    ///      Leave `deadline` at 0 to skip the permit call and rely on a pre-existing allowance instead.
    struct Permit {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // --- SHARED EVENTS ---

    event RecordTypeAdded(uint256 indexed recordTypeId, string name);
    event RecordTypeUpdated(uint256 indexed recordTypeId, string name);
    event ReservedNameAdded(uint256 indexed recordTypeId, string name);
    event ReservedNameRemoved(uint256 indexed recordTypeId, string name);
    event DomainRegistered(bytes32 indexed nodehash, uint256 indexed domainId, uint256 indexed recordTypeId, address manager, uint256 expiresAt);
    event DomainMetadataUpdated(bytes32 indexed nodehash, address indexed manager, string metadata);
    event DomainRenewed(bytes32 indexed nodehash, uint256 expiresAt);
    event DomainRemoved(bytes32 indexed nodehash, uint256 indexed domainId, address indexed removedBy);
    event MinimumLengthUpdated(uint8 newLength);
    event RegistrationFeeUpdated(uint256 oldValue, uint256 newValue);
    event LengthTierPricesUpdated(uint256 indexed recordTypeId, uint256[] prices);
    event PaymentTokenUpdated(address indexed oldToken, address indexed newToken);
    event TrustedForwarderUpdated(address indexed forwarder);
    event Withdrawal(address indexed recipient, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidRecordType();
    error RecordTypeUnavailable();
    error NameTooShort(uint256 length, uint256 minimumLength);
    error NameReserved(string name);
    error NameAlreadyRegistered(bytes32 nodehash);
    error DomainNotFound();
    error DomainNotExpired();
    error NotDomainManager();
    error InvalidAddress();
    error InvalidPriceCurve();
    error InsufficientBalance(uint256 required, uint256 provided);
    error TransferFailed();
    error UnexpectedNativePayment();

    function version() external pure returns (string memory);

    // --- STATE GETTERS ---

    function recordTypeCount() external view returns (uint256);
    function domainCount() external view returns (uint256);
    function minimumLength() external view returns (uint8);
    function registrationFee() external view returns (uint256);

    /// @notice The ERC-20 token payments are collected in, or address(0) to charge the chain's native coin.
    function paymentToken() external view returns (address);
    function nodehashToDomainId(bytes32 nodehash) external view returns (uint256);
    function owner() external view returns (address);
    function paused() external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);

    // --- RECORD TYPE MANAGEMENT ---

    function addRecordType(
        string calldata name,
        uint256 price,
        string[] calldata initialReserved,
        string calldata metadata,
        address manager,
        uint8 percentage,
        bool paused
    ) external;

    function updateRecordType(
        uint256 recordTypeId,
        string calldata name,
        uint256 price,
        string calldata metadata,
        address manager,
        uint8 percentage,
        bool paused
    ) external;

    function addReservedName(uint256 recordTypeId, string calldata name) external;
    function removeReservedName(uint256 recordTypeId, string calldata name) external;
    function isReservedName(uint256 recordTypeId, string calldata name) external view returns (bool);
    function getRecordTypeList() external view returns (RecordTypeSummary[] memory);
    function checkRecordTypeId(uint256 recordTypeId) external view returns (bool);

    /**
     * @notice Sets the per-length price curve for a record type. `prices[0]` applies at `minimumLength`,
     *         each subsequent entry applies to the next length up, and the last entry applies to that
     *         length and everything longer. Must be non-increasing (shorter names cost at least as much
     *         as longer ones). Pass an empty array to fall back to the record type's flat `price`.
     */
    function setLengthTierPrices(uint256 recordTypeId, uint256[] calldata prices) external;
    function getLengthTierPrices(uint256 recordTypeId) external view returns (uint256[] memory);

    /// @notice Returns the price to register/renew `name` under `recordTypeId`, following its price curve.
    function getPrice(uint256 recordTypeId, string calldata name) external view returns (uint256);

    // --- CORE NAMING SERVICE LOGIC ---

    /**
     * @notice Registers a domain. If `paymentToken` is address(0), pay with the chain's native coin via
     *         `msg.value`. Otherwise payment is pulled in `paymentToken`; pass a zeroed `Permit` to rely
     *         on a pre-existing allowance, or a signed one to approve and pay in the same call.
     */
    function register(string calldata name, uint256 recordTypeId, bytes calldata rawMetadata, Permit calldata permit) external payable returns (bytes32 nodehash, uint256 domainId);

    function updateDomainMetadata(bytes32 nodehash, address manager, string calldata metadata, bytes calldata rawMetadata) external;

    function renewDomain(bytes32 nodehash, Permit calldata permit) external payable returns (bool);

    function removeExpiredDomain(bytes32 nodehash) external;
    function removeDomainByNodehash(bytes32 nodehash) external;
    function removeDomainById(uint256 domainId) external;

    // --- VIEW FUNCTIONS ---

    function toNodehash(string calldata name, uint256 recordTypeId) external view returns (bytes32);
    function resolveDomain(bytes32 nodehash) external view returns (Domain memory);
    function getDomainsByManager(address manager) external view returns (Domain[] memory);
    function getDomainsByRecordType(uint256 recordTypeId) external view returns (Domain[] memory);
    function calcPercentage(uint256 amount, uint8 percentage) external pure returns (uint256);

    // --- GENERIC KEY/VALUE STORAGE ---

    function setKey(bytes32 appId, bytes32 key, string calldata val) external;
    function getKey(bytes32 appId, bytes32 key) external view returns (string memory);
    function delKey(bytes32 appId, bytes32 key) external returns (bool);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function updateMinimumLength(uint8 newLength) external;
    function updateRegistrationFee(uint256 fee) external;

    /// @notice Sets the payment currency. Pass address(0) to switch back to the chain's native coin.
    function setPaymentToken(address token) external;
    function setTrustedForwarder(address forwarder) external;
    function withdraw() external;
    function transferBalance(address to, uint256 amount) external;
    function getBalance() external view returns (uint256);

    // --- OWNERSHIP ACTIONS ---

    function transferOwnership(address newOwner) external;
    function renounceOwnership() external;
}
