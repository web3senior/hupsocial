// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./IHupCommunity.sol";

/**
 * @title Hup Community Protocol
 * @author Hup Labs
 * @notice Manages decentralized community spaces, membership tiers, and moderation roles.
 */
contract HupCommunity is IHupCommunity, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    struct Community {
        uint256 id;
        address creator;
        MembershipType membershipType;
        string metadata;
    }

    uint256 public communityCount;
    uint256 public fee = 0 ether;

    mapping(uint256 => Community) public communities;
    mapping(uint256 => mapping(address => MemberStatus)) public registry;

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, _msgSender())) revert Unauthorized();
        _;
    }

    constructor(address _trustedForwarder, address _admin) ERC2771Context(_trustedForwarder) {
        if (_admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    /**
     * @notice Creates a new community space.
     */
    function createCommunity(MembershipType _type, string calldata _metadata) external payable whenNotPaused returns (uint256) {
        if (fee > 0 && msg.value != fee) revert InsufficientFee();
        
        communityCount++;
        uint256 id = communityCount;

        communities[id] = Community(id, _msgSender(), _type, _metadata);
        registry[id][_msgSender()] = MemberStatus(true, false, true, false);

        emit CommunityCreated(id, _msgSender(), _type);
        return id;
    }

    /**
     * @notice Gateway for users to join or request access to communities.
     */
    function join(uint256 _id) external whenNotPaused {
        MemberStatus storage status = registry[_id][_msgSender()];
        if (status.isBanned) revert Banned();
        if (status.isMember) revert AlreadyMember();

        Community storage c = communities[_id];
        if (c.membershipType == MembershipType.Public) {
            status.isMember = true;
            emit MemberStatusUpdated(_id, _msgSender(), true);
        } else if (c.membershipType == MembershipType.RequestBased) {
            status.isPending = true;
        }
        // Private communities require manual addMember logic (to be added)
    }

    /**
     * @notice Validates if an actor is permitted to post within a community.
     */
    function canPost(address actor, uint256 communityId) external view override returns (bool) {
        if (communityId == 0) return true;

        Community storage c = communities[communityId];
        MemberStatus storage status = registry[communityId][actor];

        if (status.isBanned) return false;
        if (c.creator == actor || status.isModerator) return true;
        if (c.membershipType == MembershipType.Public) return true;

        return status.isMember;
    }

    // --- Admin & Utils ---

    function pause() external onlyDirectAdmin { _pause(); }
    function unpause() external onlyDirectAdmin { _unpause(); }

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