// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @custom:error Thrown when the user does not send enough native currency (CELO) for registration or renewal.
error InsufficientBalance(uint256 required, uint256 provided);
/// @custom:error Thrown when an internal function fails to return a valid result.
error Reverted();

/// @title Dropid 🆔
/// @author Aratta Labs
/// @notice Dropid on CELO. A decentralized, single-chain Naming Service (FNS) using ERC-721 NFTs.
/// @dev This contract manages tokenized domain names with custom extensions and requires a CELO fee to prevent spam.
/// @custom:security-contact atenyun@gmail.com
contract Dropid is ERC721URIStorage, Ownable, Pausable {
    using Counters for Counters.Counter;

    // --- State & Counters ---
    Counters.Counter public _recordTypeCounter;
    Counters.Counter public _resolveCounter;
    Counters.Counter private _tokenIds;

    uint8 public minimumLength = 3;
    uint256 public registrationFee = 1000000000000000000; // 1 CELO (10^18) to prevent spamming

    // --- Events ---
    event RecordTypeAdded(bytes32 indexed recordTypeId, string name);
    event RecordTypeUpdated(bytes32 indexed recordTypeId, string name);
    event newDomain(bytes32 indexed nodehash);
    event ResolveUpdated(address indexed manager, string metadata);
    event RenewalResolve(bytes32 indexed nodehash);
    event MinimumLengthUpdated(uint8 newLength);
    event PrimaryChainUpdated(bytes32 indexed nodehash, uint256 newChainId); // Retained for compatibility but not used in single-chain logic

    // --- Structs (No multi-chain pointer needed) ---
    struct RecordTypeStruct {
        string name;
        uint256 price;
        string[] reserved;
        string metadata;
        uint256 dt;
        address manager;
        uint8 percentage;
        bool pause;
    }

    struct ResolveStruct {
        bytes32 recordTypeId;
        bytes32 tokenId;
        bytes32 nodehash;
        string metadata;
        address manager;
        uint256 exp;
        // profileChainId removed for single-chain deployment
    }

    struct NameListStruct {
        bytes32 id;
        string name;
        uint256 price;
        uint8 percentage;
        address manager;
    }

    // --- Mappings ---
    mapping(bytes32 => RecordTypeStruct) public recordType;
    mapping(bytes32 => ResolveStruct) public resolve;
    mapping(bytes32 => mapping(bytes32 => string)) public blockStorage;

    ///@dev Throws if called by any account other than the manager or the contract owner.
    modifier onlyManager(bytes32 nodehash) {
        uint256 resolveIndex = _indexOfResolve(nodehash);
        // Using ERC721 standard function ownerOf()
        require(ownerOf(resolve[bytes32(resolveIndex)].tokenId) == _msgSender() || _msgSender() == owner(), "The sender is not the owner/manager of the entered domain.");
        _;
    }

    // --- Constructor ---
    constructor() ERC721URIStorage("Dropid FNS", "DID") Ownable(msg.sender) {
        string[] memory reserved = new string[](1);
        reserved[0] = "amir";

        // Initial records (CELO focus)
        _recordTypeCounter.increment();
        recordType[bytes32(_recordTypeCounter.current())] = RecordTypeStruct(toLower("hup"), registrationFee, reserved, "", block.timestamp, _msgSender(), 0, false);
        emit RecordTypeAdded(bytes32(_recordTypeCounter.current()), toLower("hup"));

        _recordTypeCounter.increment();
        recordType[bytes32(_recordTypeCounter.current())] = RecordTypeStruct(toLower("celo"), 0.5 ether, reserved, "", block.timestamp, _msgSender(), 0, false);
        emit RecordTypeAdded(bytes32(_recordTypeCounter.current()), toLower("celo"));
    }

    // --- Utility Functions ---

    /// @notice Generates the data URI string for ERC-721 metadata.
    function getMetadata(bytes memory _rawMetadata) public pure returns (bytes memory) {
        // Creates a data URI: data:application/json;base64,...
        bytes memory base64Json = Base64.encode(_rawMetadata);
        return abi.encodePacked("data:application/json;base64,", base64Json);
    }

    function toLower(string memory str) public pure returns (string memory) {
        bytes memory bStr = bytes(str);
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

    function toLowercase(string memory _arg) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_arg)) >> 32;
    }

    /// @notice Store a new key/ value
    function setKey(
        bytes32 appId,
        bytes32 key,
        string memory val
    ) public onlyOwner {
        blockStorage[appId][key] = val;
    }

    /// @notice Get the stored value
    function getKey(bytes32 appId, bytes32 key) public view returns (string memory) {
        return blockStorage[appId][key];
    }

    /// @notice Delete a key from the storage
    function delKey(bytes32 appId, bytes32 key) public onlyOwner returns (bool) {
        delete blockStorage[appId][key];
        return true;
    }

    // --- Record Type Management ---

    function addRecordType(
        string memory _name,
        uint256 _price,
        string[] memory _reserved,
        string memory _metadata,
        address _manager,
        uint8 _percentage,
        bool _pause
    ) public onlyOwner {
        _recordTypeCounter.increment();
        recordType[bytes32(_recordTypeCounter.current())] = RecordTypeStruct(toLower(_name), _price, _reserved, _metadata, block.timestamp, _manager, _percentage, _pause);
        emit RecordTypeAdded(bytes32(_recordTypeCounter.current()), toLower(_name));
    }

    /// @notice Update record type
    function updateRecordType(
        bytes32 _recordTypeId,
        string memory _name,
        uint256 _price,
        string[] memory _reserved,
        string memory _metadata,
        address _manager,
        uint8 _percentage,
        bool _pause
    ) public onlyOwner {
        recordType[_recordTypeId].name = toLower(_name);
        recordType[_recordTypeId].price = _price;
        recordType[_recordTypeId].reserved = _reserved;
        recordType[_recordTypeId].metadata = _metadata;
        recordType[_recordTypeId].manager = _manager;
        recordType[_recordTypeId].percentage = _percentage;
        recordType[_recordTypeId].pause = _pause;
        emit RecordTypeUpdated(bytes32(_recordTypeCounter.current()), toLower(_name));
    }

    function getRecordTypeNameList() public view returns (NameListStruct[] memory) {
        uint256 totalRecordType = _recordTypeCounter.current();
        NameListStruct[] memory result = new NameListStruct[](totalRecordType);

        for (uint256 i = 0; i < totalRecordType; i++) {
            result[i] = NameListStruct(bytes32(i + 1), recordType[bytes32(i + 1)].name, recordType[bytes32(i + 1)].price, recordType[bytes32(i + 1)].percentage, recordType[bytes32(i + 1)].manager);
        }

        return result;
    }

    // --- Resolver Functions ---

    function getResolveList(address _manager) public view returns (ResolveStruct[] memory list) {
        // Note: Returning dynamic arrays in view functions requires allocating a fixed size, 
        // which can lead to unused elements if the count is unknown. 
        // A dedicated counter or event indexing off-chain is better for production.
        ResolveStruct[] memory tempResult = new ResolveStruct[](_resolveCounter.current());

        uint256 counter = 0;
        for (uint256 i = 1; i <= _resolveCounter.current(); i++) {
            if (resolve[bytes32(i)].manager == _manager) {
                tempResult[counter] = resolve[bytes32(i)];
                counter++;
            }
        }
        
        // Resize array to actual count
        ResolveStruct[] memory result = new ResolveStruct[](counter);
        for(uint256 i = 0; i < counter; i++) {
            result[i] = tempResult[i];
        }

        return result;
    }

    function getResolveListByRecordType(bytes32 _recordTypeId) public view returns (ResolveStruct[] memory list) {
        ResolveStruct[] memory tempResult = new ResolveStruct[](_resolveCounter.current());

        uint256 counter = 0;
        for (uint256 i = 1; i <= _resolveCounter.current(); i++) {
            if (resolve[bytes32(i)].recordTypeId == _recordTypeId) {
                tempResult[counter] = resolve[bytes32(i)];
                counter++;
            }
        }
        
        // Resize array to actual count
        ResolveStruct[] memory result = new ResolveStruct[](counter);
        for(uint256 i = 0; i < counter; i++) {
            result[i] = tempResult[i];
        }

        return result;
    }

    function toNodehash(string memory _name, bytes32 _recordTypeId) public view returns (bytes32) {
        bytes32 nodehash;
        return nodehash = bytes32(keccak256(bytes.concat(bytes(toLower(_name)), bytes("."), bytes(recordType[_recordTypeId].name))));
    }

    ///@notice Calculate percentage
    function calcPercentage(uint256 amount, uint256 bps) public pure returns (uint256) {
        require((amount * bps) / 100 >= 0);
        return (amount * bps) / 100;
    }

    // Check if the name is duplicated if it's not expired
    function _freeToRegister(bytes32 _nodehash) public view returns (bool) {
        for (uint256 i = 0; i < _resolveCounter.current(); i++) if (resolve[bytes32(i + 1)].nodehash == _nodehash) return true;
        return false;
    }

    function checkRecordTypeId(bytes32 _recordTypeId) public view returns (bool) {
        uint256 totalRecordType = _recordTypeCounter.current();
        for (uint256 i = 1; i <= totalRecordType; i++) if (bytes32(i) == _recordTypeId) return true;
        return false;
    }

    // --- Core Naming Service Functions ---

    function register(
        string memory _name,
        bytes32 _recordTypeId,
        bytes memory _rawMetadata
    ) public payable whenNotPaused returns (bytes32, uint256) {
        // Check the recordTypeId
        require(checkRecordTypeId(_recordTypeId), "The provided recordTypeId is invalid.");

        // Enforce the registration fee to prevent spam
        if (_msgSender() != owner()) {
            require(msg.value >= registrationFee, "Insufficient CELO provided for registration fee.");
            // Check length
            require(bytes(_name).length >= minimumLength, "A name must be a minimum of 3 characters long.");
            // Check domain price
            if (msg.value < recordType[_recordTypeId].price) revert InsufficientBalance(recordType[_recordTypeId].price, msg.value);
        }

        // Check if the name is duplicated if it's not expired
        bytes32 nodehash = bytes32(keccak256(bytes.concat(bytes(toLower(_name)), bytes("."), bytes(recordType[_recordTypeId].name))));

        require(!_freeToRegister(nodehash), "The name you are trying to register is already registered.");

        // Handle fee split if manager is not the owner
        if (recordType[_recordTypeId].manager != owner()) {
            uint256 amount = calcPercentage(msg.value, recordType[_recordTypeId].percentage);
            (bool success, ) = recordType[_recordTypeId].manager.call{value: amount}("");
            require(success, "Failed to send CELO to the manager");
        }

        // Mint NFT
        _tokenIds.increment();
        uint256 _tokenId = _tokenIds.current();
        // Use ERC721 _safeMint
        _safeMint(_msgSender(), _tokenId);
        
        // Set metadata (using ERC721URIStorage function)
        _setTokenURI(_tokenId, string(getMetadata(_rawMetadata)));

        // Buy it (Register the resolution)
        _resolveCounter.increment();
        resolve[bytes32(_resolveCounter.current())] = ResolveStruct(_recordTypeId, bytes32(_tokenId), nodehash, "", _msgSender(), (block.timestamp + 365 days));
        emit newDomain(nodehash);

        return (nodehash, _tokenId);
    }

    /// @notice Update URL (metadata)
    /// onlyManager(_nodehash)
    function updateResolve(
        bytes32 _nodehash,
        address _manager,
        string memory _metadata,
        bytes memory _rawMetadata
    ) public onlyManager(_nodehash) {
        // check if the token id of the nodehash is the sender, so users can trade the nfts/ domains
        uint256 _resolveIndex = _indexOfResolve(_nodehash);
        resolve[bytes32(_resolveIndex)].manager = _manager;
        resolve[bytes32(_resolveIndex)].metadata = _metadata;

        require(ownerOf(uint256(resolve[bytes32(_resolveIndex)].tokenId)) == _msgSender(), "Sender is not the owner of entred username.");

        // Set ERC721 metadata
        _setTokenURI(uint256(resolve[bytes32(_resolveIndex)].tokenId), string(getMetadata(_rawMetadata)));

        emit ResolveUpdated(_manager, _metadata);
    }

    /// @notice everyone can renewal a domain
    function renewal(bytes32 _nodehash) public payable returns (bool) {
        // Get resolve index
        uint256 _resolveIndex = _indexOfResolve(_nodehash);
        bytes32 _recordTypeId = resolve[bytes32(_resolveIndex)].recordTypeId;

        // Check the amount
        if (_msgSender() != owner()) {
            if (msg.value < recordType[_recordTypeId].price) revert InsufficientBalance(recordType[_recordTypeId].price, msg.value);
        }

        // Check if the recordType manager is not the owner
        if (recordType[_recordTypeId].manager != owner()) {
            uint256 amount = calcPercentage(msg.value, recordType[_recordTypeId].percentage);
            (bool success, ) = recordType[_recordTypeId].manager.call{value: amount}("");
            require(success, "Failed to send CELO to the manager");
        }

        // update the expiration, a year
        resolve[bytes32(_resolveIndex)] = ResolveStruct(_recordTypeId, resolve[bytes32(_resolveIndex)].tokenId, resolve[bytes32(_resolveIndex)].nodehash, resolve[bytes32(_resolveIndex)].metadata, resolve[bytes32(_resolveIndex)].manager, (block.timestamp + 360 days));

        emit RenewalResolve(_nodehash);

        return true;
    }

    function _indexOfResolve(bytes32 _nodehash) internal view returns (uint256) {
        for (uint256 i = 0; i < _resolveCounter.current(); i++) if (resolve[bytes32(i + 1)].nodehash == _nodehash) return i + 1;
        revert Reverted();
    }

    function resolver(bytes32 _nodehash) public view returns (ResolveStruct memory) {
        for (uint256 i = 1; i <= _resolveCounter.current(); i++)
            if (resolve[bytes32(i)].nodehash == _nodehash) {
                // Check if the domain isn't expired
                if (block.timestamp < resolve[bytes32(i)].exp) return resolve[bytes32(i)];
            }
        revert Reverted();
    }

    /// @notice Domains tidy up by any users!
    function removeExpiredResolve() public {
        for (uint256 i = 1; i <= _resolveCounter.current(); i++)
            // Check whether the domain has expired.
            if (block.timestamp > resolve[bytes32(i)].exp) {
                bytes32 tokenId = resolve[bytes32(i)].tokenId;
                // Use ERC721 _burn
                _burn(uint256(tokenId));
                delete resolve[bytes32(i)];
            }
    }

    function removeResolveByNodehash(bytes32 _nodehash) public onlyOwner {
        uint256 _resolveIndex = _indexOfResolve(_nodehash);
        bytes32 tokenId = resolve[bytes32(_resolveIndex)].tokenId;
        _burn(uint256(tokenId));
        delete resolve[bytes32(_resolveIndex)];
    }

    function removeResolveByIndex(bytes32 _resolveIndex) public onlyOwner {
        bytes32 tokenId = resolve[_resolveIndex].tokenId;
        _burn(uint256(tokenId));
        delete resolve[_resolveIndex];
    }

    function updateMinimumLength(uint8 _len) public onlyOwner {
        minimumLength = _len;
        emit MinimumLengthUpdated(_len);
    }
    
    /// @notice Updates the CELO fee required to register a domain name.
    function updateRegistrationFee(uint256 _fee) public onlyOwner {
        registrationFee = _fee;
    }

    ///@notice Withdraw the balance from this contract and transfer it to the owner's address
    function withdraw() public onlyOwner {
        uint256 amount = address(this).balance;
        (bool success, ) = owner().call{value: amount}("");
        require(success, "Failed");
    }

    ///@notice Transfer balance from this contract to input address
    function transferBalance(address payable _to, uint256 _amount) public onlyOwner {
        // Note that "to" is declared as payable
        (bool success, ) = _to.call{value: _amount}("");
        require(success, "Failed");
    }

    /// @notice Return the balance of this contract
    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Pause mint
    function pause() public onlyOwner {
        _pause();
    }

    /// @notice Unpause mint
    function unpause() public onlyOwner {
        _unpause();
    }

    // --- ERC721 Overrides ---
    function tokenURI(uint256 tokenId) public view virtual override(ERC721, ERC721URIStorage) returns (string memory) {
        return ERC721URIStorage.tokenURI(tokenId);
    }
    
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721, ERC721URIStorage) returns (bool) {
        return ERC721URIStorage.supportsInterface(interfaceId);
    }
}
