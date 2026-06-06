// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IHupCommunity.sol";

/**
 * @title Hup Community Protocol
 * @author MCH01 Labs
 * @notice Manages decentralized community spaces, membership tiers, and moderation roles.
 */
contract HupCommunity is IHupCommunity, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    enum CommunityType {
        Discussion,
        Broadcast
    }

    struct Community {
        uint256 id;
        address creator;
        MembershipType membershipType;
        CommunityType cType;
        string metadata;
    }

    uint256 public communityCount;
    uint256 public fee = 0 ether;

    mapping(uint256 => Community) public communities;
    mapping(uint256 => mapping(address => MemberStatus)) public registry;
    mapping(uint256 => NftRequirement) public nftRequirements;
    mapping(uint256 => TokenRequirement) public tokenRequirements;

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, _msgSender())) revert Unauthorized();
        _;
    }

    modifier onlyCreator(uint256 communityId) {
        if (communities[communityId].creator != _msgSender()) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyModerator(uint256 communityId) {
        if (communities[communityId].creator != _msgSender() && !registry[communityId][_msgSender()].isModerator) {
            revert Unauthorized();
        }
        _;
    }

    modifier communityExists(uint256 communityId) {
        if (communities[communityId].id == 0) revert CommunityDoesNotExist();
        _;
    }

    constructor(address _trustedForwarder, address _admin) ERC2771Context(_trustedForwarder) {
        if (_admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    function createCommunity(MembershipType _type, CommunityType _communityType, string calldata _metadata) external payable whenNotPaused returns (uint256) {
        if (fee > 0 && msg.value != fee) revert InsufficientFee();
        communityCount++;
        uint256 id = communityCount;
        communities[id] = Community(id, _msgSender(), _type, _communityType, _metadata);
        registry[id][_msgSender()] = MemberStatus(true, false, true, false, true);
        emit CommunityCreated(id, _msgSender(), _type);
        return id;
    }

    function updateCommunity(uint256 _id, MembershipType _type, string calldata _metadata) external communityExists(_id) onlyModerator(_id) {
        Community storage c = communities[_id];

        c.membershipType = _type;
        c.metadata = _metadata;

        emit CommunityUpdated(_id, _type, _metadata);
    }

    function join(uint256 _id) external communityExists(_id) whenNotPaused {
        MemberStatus storage status = registry[_id][_msgSender()];
        if (status.isBanned) revert Banned();
        if (status.isMember) revert AlreadyMember();

        Community storage c = communities[_id];
        if (c.membershipType == MembershipType.Public) {
            status.isMember = true;
            status.canPost = true;
            emit MemberStatusUpdated(_id, _msgSender(), true);
        } else if (c.membershipType == MembershipType.RequestBased) {
            status.isPending = true;
        }
    }

    // --- Moderator Actions ---

    function addMember(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        registry[_id][_actor].isMember = true;
        registry[_id][_actor].canPost = true;
        registry[_id][_actor].isPending = false;
        emit MemberStatusUpdated(_id, _actor, true);
    }

    function approveRequest(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        registry[_id][_actor].isMember = true;
        registry[_id][_actor].canPost = true;
        registry[_id][_actor].isPending = false;
        emit MemberStatusUpdated(_id, _actor, true);
    }

    function setModerator(uint256 _id, address _actor, bool _isMod) external communityExists(_id) onlyCreator(_id) {
        registry[_id][_actor].isModerator = _isMod;
        emit ModeratorUpdated(_id, _actor, _isMod);
    }

    function setBanStatus(uint256 _id, address _actor, bool _banned) external communityExists(_id) onlyModerator(_id) {
        registry[_id][_actor].isBanned = _banned;
        emit MemberStatusUpdated(_id, _actor, !_banned);
    }

    function setNftRequirement(uint256 _id, address _nftAddress, uint256 _tokenId) external communityExists(_id) onlyModerator(_id) {
        nftRequirements[_id] = NftRequirement(_nftAddress, _tokenId);
    }

    function setTokenRequirement(uint256 _id, address _tokenAddress, uint256 _minBalance) external communityExists(_id) onlyModerator(_id) {
        tokenRequirements[_id] = TokenRequirement(_tokenAddress, _minBalance);
    }

    function setPostingPermission(uint256 _id, address _actor, bool _canPost) external communityExists(_id) onlyModerator(_id) {
        registry[_id][_actor].canPost = _canPost;
        emit MemberStatusUpdated(_id, _actor, registry[_id][_actor].isMember);
    }

    // --- Guard & Permissions Gate ---

    function isEligibleViaToken(address _actor, uint256 _id) public view returns (bool) {
        TokenRequirement memory req = tokenRequirements[_id];
        if (req.minBalance == 0) return true;

        if (req.tokenAddress == address(0)) {
            return _actor.balance >= req.minBalance;
        } else {
            return IERC20(req.tokenAddress).balanceOf(_actor) >= req.minBalance;
        }
    }

    function isEligibleViaNft(address _actor, uint256 _id) public view returns (bool) {
        NftRequirement memory req = nftRequirements[_id];
        if (req.nftAddress == address(0)) return false;

        return IERC721(req.nftAddress).balanceOf(_actor) > 0;
    }

    function canPost(address actor, uint256 communityId) external view override returns (bool) {
        if (communityId == 0) return true;

        Community storage c = communities[communityId];
        MemberStatus storage status = registry[communityId][actor];

        if (status.isBanned) return false;
        if (c.creator == actor || status.isModerator) return true;
        if (!status.canPost) return false;
        if (c.membershipType == MembershipType.Public) return true;

        if (c.membershipType == MembershipType.NftGated) {
            return isEligibleViaNft(actor, communityId);
        }

        if (c.membershipType == MembershipType.TokenGated) {
            return isEligibleViaToken(actor, communityId);
        }

        return status.isMember;
    }

    // --- Admin & Utils ---

    function pause() external onlyDirectAdmin {
        _pause();
    }

    function unpause() external onlyDirectAdmin {
        _unpause();
    }

    function setFee(uint256 _fee) external onlyDirectAdmin {
        uint256 oldValue = fee;
        fee = _fee;
        emit FeeUpdated(oldValue, _fee);
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

    receive() external payable {
        emit UnattributedDeposit(_msgSender(), msg.value);
    }
}