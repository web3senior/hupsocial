// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./INameIt.sol";

/**
 * @title NameIt
 * @author NameIt Labs
 * @notice A decentralized, multichain, gasless naming service using ERC-721 NFTs.
 * @dev Uses INameIt for shared events, errors, structs, and view functions. Domain names are grouped
 *      under owner-managed record types (e.g. "hup", "celo"), each with its own manager and revenue
 *      split. Registration/renewal price follows a per-record-type, per-name-length curve (shorter
 *      names cost more). Payment defaults to the chain's native coin (`paymentToken == address(0)`)
 *      and is switchable by the owner to any ERC-20 (e.g. a future project token) via
 *      `setPaymentToken`; in ERC-20 mode payment is pulled via `transferFrom` with an optional
 *      EIP-2612 `permit` so a relayer can submit the call on the user's behalf with no prior approval
 *      transaction. Each chain runs its own independent deployment; cross-chain name uniqueness and
 *      discovery are expected to be reconciled offchain by indexers. Supports a rotatable ERC2771
 *      trusted forwarder for meta-transactions, Ownable for admin permissions, and Pausable for
 *      emergency controls.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🆔
 */
contract NameIt is INameIt, ERC721URIStorage, Ownable, Pausable, ERC2771Context {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    uint256 public constant REGISTRATION_PERIOD = 365 days;

    uint256 public override recordTypeCount;
    uint256 public override domainCount;

    uint8 public override minimumLength = 3;
    uint256 public override registrationFee; // Flat floor (in the current payment currency's units) to prevent spam

    address private _trustedForwarder;
    IERC20 private _paymentToken;

    mapping(uint256 => RecordType) public recordTypes;
    mapping(uint256 => Domain) public domains;
    mapping(bytes32 => uint256) public override nodehashToDomainId;
    mapping(bytes32 => mapping(bytes32 => string)) public blockStorage;

    mapping(uint256 => EnumerableSet.Bytes32Set) private _reservedNames;
    mapping(address => EnumerableSet.UintSet) private _domainsByManager;
    mapping(uint256 => EnumerableSet.UintSet) private _domainsByRecordType;
    mapping(uint256 => uint256[]) private _lengthTierPrices;

    // --- MODIFIERS ---

    /// @dev Throws unless called by the domain's current NFT holder or the contract owner.
    modifier onlyManager(bytes32 _nodehash) {
        uint256 domainId = nodehashToDomainId[_nodehash];
        if (domainId == 0) revert DomainNotFound();
        if (ownerOf(domainId) != _msgSender() && _msgSender() != owner()) revert NotDomainManager();
        _;
    }

    // --- CONSTRUCTOR ---

    constructor(address _trustedForwarderAddress) ERC721("NameIt", "NAME") Ownable(_msgSender()) ERC2771Context(_trustedForwarderAddress) {
        _trustedForwarder = _trustedForwarderAddress;

        bytes32 reservedWord = keccak256(bytes(toLower("amir")));

        // Prices start at 0; the owner sets a payment token and per-length price curves post-deploy,
        // once the token's decimals and the desired pricing are known.
        recordTypeCount++;
        recordTypes[recordTypeCount] = RecordType(toLower("hup"), 0, "", block.timestamp, _msgSender(), 0, false);
        _reservedNames[recordTypeCount].add(reservedWord);
        emit RecordTypeAdded(recordTypeCount, toLower("hup"));

        recordTypeCount++;
        recordTypes[recordTypeCount] = RecordType(toLower("celo"), 0, "", block.timestamp, _msgSender(), 0, false);
        _reservedNames[recordTypeCount].add(reservedWord);
        emit RecordTypeAdded(recordTypeCount, toLower("celo"));
    }

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function paymentToken() public view override returns (address) {
        return address(_paymentToken);
    }

    // --- UTILITY FUNCTIONS ---

    /// @notice Generates the data URI string for ERC-721 metadata.
    function getMetadata(bytes memory _rawMetadata) public pure returns (bytes memory) {
        // Creates a data URI: data:application/json;base64,...
        bytes memory base64Json = Base64.encode(_rawMetadata);
        return abi.encodePacked("data:application/json;base64,", base64Json);
    }

    /// @notice Lowercases ASCII letters only, leaving multi-byte UTF-8 sequences (incl. ZWNJ) untouched.
    function toLower(string memory _str) public pure returns (string memory) {
        bytes memory bStr = bytes(_str);
        bytes memory lowerCaseStr = new bytes(bStr.length);
        for (uint256 i = 0; i < bStr.length; i++) {
            if (uint8(bStr[i]) >= 65 && uint8(bStr[i]) <= 90) {
                lowerCaseStr[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                lowerCaseStr[i] = bStr[i];
            }
        }
        return string(lowerCaseStr);
    }

    // --- GENERIC KEY/VALUE STORAGE ---

    /// @notice Store a new key/value
    function setKey(bytes32 _appId, bytes32 _key, string memory _val) public override onlyOwner {
        blockStorage[_appId][_key] = _val;
    }

    /// @notice Get the stored value
    function getKey(bytes32 _appId, bytes32 _key) public view override returns (string memory) {
        return blockStorage[_appId][_key];
    }

    /// @notice Delete a key from the storage
    function delKey(bytes32 _appId, bytes32 _key) public override onlyOwner returns (bool) {
        delete blockStorage[_appId][_key];
        return true;
    }

    // --- RECORD TYPE MANAGEMENT ---

    function addRecordType(
        string memory _name,
        uint256 _price,
        string[] memory _initialReserved,
        string memory _metadata,
        address _manager,
        uint8 _percentage,
        bool _paused
    ) public override onlyOwner {
        recordTypeCount++;
        uint256 recordTypeId = recordTypeCount;
        string memory normalizedName = toLower(_name);

        recordTypes[recordTypeId] = RecordType(normalizedName, _price, _metadata, block.timestamp, _manager, _percentage, _paused);

        for (uint256 i = 0; i < _initialReserved.length; i++) {
            string memory normalizedReserved = toLower(_initialReserved[i]);
            _reservedNames[recordTypeId].add(keccak256(bytes(normalizedReserved)));
            emit ReservedNameAdded(recordTypeId, normalizedReserved);
        }

        emit RecordTypeAdded(recordTypeId, normalizedName);
    }

    /// @notice Update record type
    function updateRecordType(
        uint256 _recordTypeId,
        string memory _name,
        uint256 _price,
        string memory _metadata,
        address _manager,
        uint8 _percentage,
        bool _paused
    ) public override onlyOwner {
        if (!checkRecordTypeId(_recordTypeId)) revert InvalidRecordType();

        RecordType storage rt = recordTypes[_recordTypeId];
        rt.name = toLower(_name);
        rt.price = _price;
        rt.metadata = _metadata;
        rt.manager = _manager;
        rt.percentage = _percentage;
        rt.paused = _paused;

        emit RecordTypeUpdated(_recordTypeId, rt.name);
    }

    /// @notice Adds a name to a record type's reserved list, blocking it from public registration.
    function addReservedName(uint256 _recordTypeId, string memory _name) public override onlyOwner {
        if (!checkRecordTypeId(_recordTypeId)) revert InvalidRecordType();

        string memory normalizedName = toLower(_name);
        _reservedNames[_recordTypeId].add(keccak256(bytes(normalizedName)));

        emit ReservedNameAdded(_recordTypeId, normalizedName);
    }

    /// @notice Removes a name from a record type's reserved list.
    function removeReservedName(uint256 _recordTypeId, string memory _name) public override onlyOwner {
        string memory normalizedName = toLower(_name);
        _reservedNames[_recordTypeId].remove(keccak256(bytes(normalizedName)));

        emit ReservedNameRemoved(_recordTypeId, normalizedName);
    }

    function isReservedName(uint256 _recordTypeId, string memory _name) public view override returns (bool) {
        return _reservedNames[_recordTypeId].contains(keccak256(bytes(toLower(_name))));
    }

    function getRecordTypeList() public view override returns (RecordTypeSummary[] memory) {
        RecordTypeSummary[] memory result = new RecordTypeSummary[](recordTypeCount);

        for (uint256 i = 0; i < recordTypeCount; i++) {
            uint256 id = i + 1;
            result[i] = RecordTypeSummary(id, recordTypes[id].name, recordTypes[id].price, recordTypes[id].percentage, recordTypes[id].manager);
        }

        return result;
    }

    /// @notice Record type ids are assigned sequentially starting at 1, so a range check is sufficient.
    function checkRecordTypeId(uint256 _recordTypeId) public view override returns (bool) {
        return _recordTypeId != 0 && _recordTypeId <= recordTypeCount;
    }

    /// @notice Sets the per-length price curve for a record type; see INameIt for tier semantics.
    function setLengthTierPrices(uint256 _recordTypeId, uint256[] memory _prices) public override onlyOwner {
        if (!checkRecordTypeId(_recordTypeId)) revert InvalidRecordType();

        for (uint256 i = 1; i < _prices.length; i++) {
            if (_prices[i] > _prices[i - 1]) revert InvalidPriceCurve();
        }

        delete _lengthTierPrices[_recordTypeId];
        for (uint256 i = 0; i < _prices.length; i++) {
            _lengthTierPrices[_recordTypeId].push(_prices[i]);
        }

        emit LengthTierPricesUpdated(_recordTypeId, _prices);
    }

    function getLengthTierPrices(uint256 _recordTypeId) public view override returns (uint256[] memory) {
        return _lengthTierPrices[_recordTypeId];
    }

    /// @notice Price for `_name` under `_recordTypeId`: follows the tier curve if one is set, else the flat price.
    function getPrice(uint256 _recordTypeId, string memory _name) public view override returns (uint256) {
        uint256[] storage tiers = _lengthTierPrices[_recordTypeId];
        if (tiers.length == 0) return recordTypes[_recordTypeId].price;

        uint256 len = bytes(toLower(_name)).length;
        uint256 tierIndex = len > minimumLength ? len - minimumLength : 0;
        if (tierIndex >= tiers.length) tierIndex = tiers.length - 1;

        return tiers[tierIndex];
    }

    // --- CORE NAMING SERVICE LOGIC ---

    function toNodehash(string memory _name, uint256 _recordTypeId) public view override returns (bytes32) {
        return keccak256(bytes.concat(bytes(toLower(_name)), bytes("."), bytes(recordTypes[_recordTypeId].name)));
    }

    ///@notice Calculate the manager's cut of an amount, as a whole percentage (0-100).
    function calcPercentage(uint256 _amount, uint8 _percentage) public pure override returns (uint256) {
        return (_amount * _percentage) / 100;
    }

    /**
     * @dev Collects `_amount` for a registration/renewal and forwards the record type manager's cut.
     *      If `paymentToken` is address(0), charges the chain's native coin via `msg.value`. Otherwise
     *      optionally consumes an EIP-2612 permit and pulls `_amount` of `paymentToken` from `_payer`.
     *      Called last in register/renew (checks-effects-interactions).
     */
    function _collectPayment(address _payer, uint256 _amount, RecordType storage _rt, Permit calldata _permit) internal {
        if (address(_paymentToken) == address(0)) {
            if (_amount == 0) return;
            if (msg.value < _amount) revert InsufficientBalance(_amount, msg.value);

            if (_rt.manager != owner() && _rt.manager != address(0)) {
                uint256 managerCut = calcPercentage(msg.value, _rt.percentage);
                (bool success, ) = _rt.manager.call{value: managerCut}("");
                if (!success) revert TransferFailed();
            }
            return;
        }

        if (msg.value != 0) revert UnexpectedNativePayment();
        if (_amount == 0) return;

        if (_permit.deadline != 0) {
            IERC20Permit(address(_paymentToken)).permit(_payer, address(this), _amount, _permit.deadline, _permit.v, _permit.r, _permit.s);
        }

        _paymentToken.safeTransferFrom(_payer, address(this), _amount);

        if (_rt.manager != owner() && _rt.manager != address(0)) {
            uint256 managerCut = calcPercentage(_amount, _rt.percentage);
            _paymentToken.safeTransfer(_rt.manager, managerCut);
        }
    }

    function register(
        string memory _name,
        uint256 _recordTypeId,
        bytes memory _rawMetadata,
        Permit calldata _permit
    ) public payable override whenNotPaused returns (bytes32 nodehash, uint256 domainId) {
        if (!checkRecordTypeId(_recordTypeId)) revert InvalidRecordType();

        address actor = _msgSender();
        RecordType storage rt = recordTypes[_recordTypeId];
        string memory normalizedName = toLower(_name);
        uint256 price = getPrice(_recordTypeId, normalizedName);

        // Enforce minimum length, availability, and reservation rules to prevent spam
        if (actor != owner()) {
            if (rt.paused) revert RecordTypeUnavailable();
            if (bytes(normalizedName).length < minimumLength) revert NameTooShort(bytes(normalizedName).length, minimumLength);
            if (_reservedNames[_recordTypeId].contains(keccak256(bytes(normalizedName)))) revert NameReserved(normalizedName);
            if (price < registrationFee) price = registrationFee;
        } else {
            price = 0;
        }

        nodehash = keccak256(bytes.concat(bytes(normalizedName), bytes("."), bytes(rt.name)));
        if (nodehashToDomainId[nodehash] != 0) revert NameAlreadyRegistered(nodehash);

        domainCount++;
        domainId = domainCount;

        _safeMint(actor, domainId);
        _setTokenURI(domainId, string(getMetadata(_rawMetadata)));

        uint256 expiresAt = block.timestamp + REGISTRATION_PERIOD;
        domains[domainId] = Domain(_recordTypeId, normalizedName, nodehash, "", actor, expiresAt);
        nodehashToDomainId[nodehash] = domainId;
        _domainsByManager[actor].add(domainId);
        _domainsByRecordType[_recordTypeId].add(domainId);

        emit DomainRegistered(nodehash, domainId, _recordTypeId, actor, expiresAt);

        _collectPayment(actor, price, rt, _permit);
    }

    /// @notice Update the metadata / resolved manager of a domain the caller manages
    function updateDomainMetadata(bytes32 _nodehash, address _manager, string memory _metadata, bytes memory _rawMetadata) public override onlyManager(_nodehash) {
        uint256 domainId = nodehashToDomainId[_nodehash];

        domains[domainId].manager = _manager;
        domains[domainId].metadata = _metadata;
        _setTokenURI(domainId, string(getMetadata(_rawMetadata)));

        emit DomainMetadataUpdated(_nodehash, _manager, _metadata);
    }

    /// @notice Anyone can renew a domain on behalf of its manager, paying in native coin or paymentToken
    function renewDomain(bytes32 _nodehash, Permit calldata _permit) public payable override returns (bool) {
        uint256 domainId = nodehashToDomainId[_nodehash];
        if (domainId == 0) revert DomainNotFound();

        Domain storage domain = domains[domainId];
        RecordType storage rt = recordTypes[domain.recordTypeId];
        address actor = _msgSender();
        uint256 price = getPrice(domain.recordTypeId, domain.name);

        if (actor == owner()) {
            price = 0;
        } else if (price < registrationFee) {
            price = registrationFee;
        }

        domain.expiresAt = block.timestamp + REGISTRATION_PERIOD;
        emit DomainRenewed(_nodehash, domain.expiresAt);

        _collectPayment(actor, price, rt, _permit);

        return true;
    }

    /// @notice Domain tidy up by any user, once the domain has actually expired.
    function removeExpiredDomain(bytes32 _nodehash) public override {
        uint256 domainId = nodehashToDomainId[_nodehash];
        if (domainId == 0) revert DomainNotFound();
        if (block.timestamp < domains[domainId].expiresAt) revert DomainNotExpired();

        _removeDomain(domainId, _nodehash, _msgSender());
    }

    function removeDomainByNodehash(bytes32 _nodehash) public override onlyOwner {
        uint256 domainId = nodehashToDomainId[_nodehash];
        if (domainId == 0) revert DomainNotFound();

        _removeDomain(domainId, _nodehash, _msgSender());
    }

    function removeDomainById(uint256 _domainId) public override onlyOwner {
        bytes32 nodehash = domains[_domainId].nodehash;
        if (nodehash == bytes32(0)) revert DomainNotFound();

        _removeDomain(_domainId, nodehash, _msgSender());
    }

    function _removeDomain(uint256 _domainId, bytes32 _nodehash, address _removedBy) internal {
        Domain memory domain = domains[_domainId];

        _domainsByManager[ownerOf(_domainId)].remove(_domainId);
        _domainsByRecordType[domain.recordTypeId].remove(_domainId);
        delete nodehashToDomainId[_nodehash];
        delete domains[_domainId];
        _burn(_domainId);

        emit DomainRemoved(_nodehash, _domainId, _removedBy);
    }

    // --- VIEW FUNCTIONS ---

    function resolveDomain(bytes32 _nodehash) public view override returns (Domain memory) {
        uint256 domainId = nodehashToDomainId[_nodehash];
        if (domainId == 0) revert DomainNotFound();

        Domain memory domain = domains[domainId];
        if (block.timestamp >= domain.expiresAt) revert DomainNotFound();

        return domain;
    }

    function getDomainsByManager(address _manager) public view override returns (Domain[] memory list) {
        uint256[] memory ids = _domainsByManager[_manager].values();
        list = new Domain[](ids.length);

        for (uint256 i = 0; i < ids.length; i++) {
            list[i] = domains[ids[i]];
        }
    }

    function getDomainsByRecordType(uint256 _recordTypeId) public view override returns (Domain[] memory list) {
        uint256[] memory ids = _domainsByRecordType[_recordTypeId].values();
        list = new Domain[](ids.length);

        for (uint256 i = 0; i < ids.length; i++) {
            list[i] = domains[ids[i]];
        }
    }

    // --- ADMIN CONFIGURATION ---

    function updateMinimumLength(uint8 _len) public override onlyOwner {
        minimumLength = _len;
        emit MinimumLengthUpdated(_len);
    }

    /// @notice Updates the flat fee floor (in the current payment currency's units) required to register a domain name.
    function updateRegistrationFee(uint256 _fee) public override onlyOwner {
        uint256 oldValue = registrationFee;
        registrationFee = _fee;
        emit RegistrationFeeUpdated(oldValue, _fee);
    }

    /// @notice Sets the payment currency for registrations/renewals. Pass address(0) for the chain's native coin.
    function setPaymentToken(address _token) public override onlyOwner {
        address oldToken = address(_paymentToken);
        _paymentToken = IERC20(_token);
        emit PaymentTokenUpdated(oldToken, _token);
    }

    /// @notice Sets a new trusted forwarder address, updating EIP-2771 compatibility.
    function setTrustedForwarder(address _newTrustedForwarder) public override onlyOwner {
        if (_newTrustedForwarder == address(0)) revert InvalidAddress();
        _trustedForwarder = _newTrustedForwarder;
        emit TrustedForwarderUpdated(_newTrustedForwarder);
    }

    ///@notice Withdraw this contract's balance (native coin or paymentToken) to the owner's address
    function withdraw() public override onlyOwner {
        uint256 amount = getBalance();

        if (address(_paymentToken) == address(0)) {
            (bool success, ) = owner().call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            _paymentToken.safeTransfer(owner(), amount);
        }

        emit Withdrawal(owner(), amount);
    }

    ///@notice Transfer this contract's balance (native coin or paymentToken) to the input address
    function transferBalance(address _to, uint256 _amount) public override onlyOwner {
        if (address(_paymentToken) == address(0)) {
            (bool success, ) = _to.call{value: _amount}("");
            if (!success) revert TransferFailed();
        } else {
            _paymentToken.safeTransfer(_to, _amount);
        }

        emit Withdrawal(_to, _amount);
    }

    /// @notice Return this contract's balance in the currently configured payment currency
    function getBalance() public view override returns (uint256) {
        if (address(_paymentToken) == address(0)) return address(this).balance;
        return _paymentToken.balanceOf(address(this));
    }

    /// @notice Pause registrations and renewals
    function pause() public override onlyOwner {
        _pause();
    }

    /// @notice Unpause registrations and renewals
    function unpause() public override onlyOwner {
        _unpause();
    }

    // --- OWNERSHIP ACTIONS ---

    function transferOwnership(address newOwner) public override(Ownable, INameIt) onlyOwner {
        Ownable.transferOwnership(newOwner);
    }

    function renounceOwnership() public override(Ownable, INameIt) onlyOwner {
        Ownable.renounceOwnership();
    }

    // --- INTERNAL & OVERRIDE HELPERS ---

    function owner() public view override(Ownable, INameIt) returns (address) {
        return Ownable.owner();
    }

    function paused() public view override(Pausable, INameIt) returns (bool) {
        return Pausable.paused();
    }

    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, INameIt) returns (bool) {
        return forwarder == _trustedForwarder;
    }

    function tokenURI(uint256 tokenId) public view virtual override(ERC721, ERC721URIStorage) returns (string memory) {
        return ERC721URIStorage.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721, ERC721URIStorage) returns (bool) {
        return ERC721URIStorage.supportsInterface(interfaceId);
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
