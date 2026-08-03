// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./IHupCommunity.sol";
import "./Follower System/ILSP26FollowerSystem.sol";
import "./ILSP7Minimal.sol";

/**
 * @title Hup Community Protocol
 * @author Hup Labs
 * @notice Manages decentralized community spaces, membership tiers, and moderation roles.
 * @dev Uses IHupCommunity for shared events, errors, enums, and view structs. Supports a fixed
 *      ERC2771 trusted forwarder for meta-transactions, AccessControl for creator/moderator/admin
 *      permissions, and Pausable for emergency controls. Rich discovery, search, and feeds are
 *      expected to be handled offchain by indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💬
 */
contract HupCommunity is IHupCommunity, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    struct Community {
        uint256 id;
        address creator;
        MembershipType membershipType;
        CommunityType cType;
        string metadata;
        bool isActive;
    }

    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Hard cap on setWhitelistedBatch's array length, so a moderator can't submit a
    ///         batch large enough to exceed the block gas limit and revert with nothing written.
    uint256 public constant MAX_BATCH_SIZE = 100;

    /// @notice Hard cap on community metadata length in bytes. `_metadataCid` is meant to be an
    ///         IPFS CID only (typically 46-59 chars) — this cap is generous enough for any CID
    ///         format but far too small to fit a raw JSON blob, so it enforces the CID-only
    ///         convention in practice rather than just by documentation.
    uint256 public constant MAX_METADATA_LENGTH = 128;

    uint256 public communityCount;
    uint256 public fee = 0 ether;

    /// @notice LSP26-compatible follower registry used by FollowerGated communities. A single,
    ///         chain-wide address shared by every community (mirrors LSP26's own canonical-
    ///         singleton design), wired in after deployment since it deploys separately.
    address public followerSystem;

    mapping(uint256 => Community) public communities;
    mapping(uint256 => mapping(address => MemberStatus)) public registry;
    mapping(uint256 => NftRequirement) public nftRequirements;
    mapping(uint256 => TokenRequirement) public tokenRequirements;
    mapping(uint256 => PaymentRequirement) public paymentRequirements;
    mapping(uint256 => address) public pendingCreator;

    // --- DAO governance ---
    // Optional per-community governor: a contract address (Governor+Timelock, Safe, or any
    // executor) that holds creator-level authority ALONGSIDE the creator ("soft DAO"). For a
    // full handover where power no longer derives from the creator wallet at all ("hard DAO"),
    // transfer the creator role itself to the governance contract via the existing two-step
    // transferCommunityOwnership/acceptCommunityOwnership flow — the executor calls accept.
    // Note for encrypted communities: a contract can never hold identity-key material, so key
    // grants/rotations remain the job of human moderators the governor appoints.

    /// @notice communityId => governance executor with creator-level powers (0 = none).
    mapping(uint256 => address) public governors;

    /// @notice communityId => wallet => pre-approved to self-service join a WhitelistGated community.
    mapping(uint256 => mapping(address => bool)) public whitelist;

    // --- Enumerable member/whitelist lists ---
    // Solidity mappings alone can't be listed or paginated, so both `registry` and `whitelist`
    // are mirrored into OpenZeppelin's EnumerableSet purely so the contract itself can answer
    // "list all members"/"list the whitelist" directly — no indexer required for correctness.
    // cidex still indexes the same events for a faster/richer read path (search, joined-with-
    // role, etc.), but nothing here depends on it being up to date.

    mapping(uint256 => EnumerableSet.AddressSet) private memberSet;
    mapping(uint256 => EnumerableSet.AddressSet) private whitelistSet;

    // --- Creation rate limiting ---
    // Cheap, adjustable anti-spam guard now that createCommunity has no cost floor when `fee`
    // is left at 0. Both knobs are admin-configurable; 0 disables the respective check.

    uint256 public creationCooldown = 1 hours;
    uint256 public maxCommunitiesPerWallet = 20;

    mapping(address => uint256) public lastCommunityCreatedAt;
    mapping(address => uint256) public communitiesCreatedCount;

    // --- Encryption vault storage ---
    // Holds ECIES-wrapped community content-key envelopes and a self-service registry of
    // community-specific identity public keys. Never stores plaintext or a usable key — only
    // ciphertext envelopes that a holder's own private key (kept client-side) can open. Only
    // Private and Request-Based communities use this in practice, but nothing here enforces that.

    /// @notice Self-registered community identity public key, one per wallet.
    mapping(address => bytes) public communityIdentityKeys;

    /// @notice communityId => latest key version. 0 means the community has no content key yet.
    mapping(uint256 => uint256) public keyVersion;

    /// @notice communityId => holder => version => ECIES envelope wrapping that version's content key.
    /// Append-only: never overwritten, so a holder keeps access to every version they were ever
    /// granted even after a later rotation moves everyone else forward.
    mapping(uint256 => mapping(address => mapping(uint256 => bytes))) public wrappedKeys;

    /// @notice Per-community history policy — see setHistoryVisibility. Default false: rotations
    /// are epoch walls and new members can't read pre-rotation posts.
    mapping(uint256 => bool) public historyVisibleToNewMembers;

    /// @notice communityId => version => version-1's content key encrypted under version's key
    /// (AES-GCM blob, client-encrypted). Holding any version's key + an unbroken chain of these
    /// links yields every older key — but never a newer one. Write-once per version.
    mapping(uint256 => mapping(uint256 => bytes)) public keyBacklinks;

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    modifier onlyCreator(uint256 communityId) {
        address sender = _msgSender();
        // The community's governor (when set) carries full creator authority — see the
        // DAO governance storage section for the soft/hard governance split.
        if (communities[communityId].creator != sender && governors[communityId] != sender) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyModerator(uint256 communityId) {
        address sender = _msgSender();
        MemberStatus storage callerStatus = registry[communityId][sender];
        // A banned moderator has no powers — without this, a freshly banned moderator could
        // simply unban themselves via setBanStatus (their isModerator flag alone would pass).
        // The governor passes: creator-level authority is a superset of moderation.
        if (
            communities[communityId].creator != sender &&
            governors[communityId] != sender &&
            (!callerStatus.isModerator || callerStatus.isBanned)
        ) {
            revert Unauthorized();
        }
        _;
    }

    modifier communityExists(uint256 communityId) {
        if (communities[communityId].id == 0) revert CommunityDoesNotExist();
        _;
    }

    // --- Enumerable list helpers ---

    function _addToMemberList(uint256 _id, address _actor) private {
        memberSet[_id].add(_actor);
    }

    function _removeFromMemberList(uint256 _id, address _actor) private {
        memberSet[_id].remove(_actor);
    }

    function _setWhitelistedOne(uint256 _id, address _actor, bool _allowed) private {
        whitelist[_id][_actor] = _allowed;

        if (_allowed) {
            whitelistSet[_id].add(_actor);
        } else {
            whitelistSet[_id].remove(_actor);
        }

        emit WhitelistUpdated(_id, _actor, _allowed);
    }

    constructor(address _trustedForwarder, address _admin) ERC2771Context(_trustedForwarder) {
        if (_admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    /**
     * @notice Creates a community. `_metadataCid` is an IPFS CID pointing at the community's
     *         display metadata (name/summary/description/images), the same convention Hup Core
     *         already uses for post content — never a raw JSON blob, so on-chain storage cost
     *         stays flat regardless of how much a creator writes.
     * @dev `initialWrappedKey` is optional — pass empty bytes for unencrypted communities. When
     *      non-empty, it atomically initializes version 1 of the content key (wrapped to the
     *      creator's own identity key) in the same transaction, so encrypted communities never sit
     *      in an uninitialized "gated but unencrypted" state between two separate signatures.
     */
    function createCommunity(
        MembershipType _type,
        CommunityType _communityType,
        string calldata _metadataCid,
        bytes calldata initialWrappedKey
    ) external payable whenNotPaused returns (uint256) {
        // Exact-value check both ways: rejects underpayment when a fee is set AND accidental
        // dust when it isn't (previously silently kept when fee == 0).
        if (msg.value != fee) revert InsufficientFee();
        if (bytes(_metadataCid).length > MAX_METADATA_LENGTH) revert MetadataTooLong();

        address sender = _msgSender();

        if (creationCooldown > 0 && block.timestamp < lastCommunityCreatedAt[sender] + creationCooldown) {
            revert CreationCooldownActive();
        }
        if (maxCommunitiesPerWallet > 0 && communitiesCreatedCount[sender] >= maxCommunitiesPerWallet) {
            revert MaxCommunitiesReached();
        }

        lastCommunityCreatedAt[sender] = block.timestamp;
        communitiesCreatedCount[sender]++;

        communityCount++;
        uint256 id = communityCount;

        communities[id] = Community(id, sender, _type, _communityType, _metadataCid, true);
        registry[id][sender] = MemberStatus(true, false, true, false, true);
        _addToMemberList(id, sender);

        if (initialWrappedKey.length > 0) {
            keyVersion[id] = 1;
            wrappedKeys[id][sender][1] = initialWrappedKey;
            emit KeyInitialized(id);
            emit KeyGranted(id, sender, 1);
        }

        emit CommunityCreated(id, sender, _type);
        return id;
    }

    /// @dev Creator-only (not moderators): changing the membership type can flip a Private
    /// community public or add a paywall — too much power to delegate to moderators.
    function updateCommunity(uint256 _id, MembershipType _type, CommunityType _communityType, string calldata _metadataCid) external communityExists(_id) onlyCreator(_id) {
        if (bytes(_metadataCid).length > MAX_METADATA_LENGTH) revert MetadataTooLong();

        Community storage c = communities[_id];

        c.membershipType = _type;
        c.cType = _communityType;
        c.metadata = _metadataCid;

        emit CommunityUpdated(_id, _type, _communityType, _metadataCid);
    }

    /**
     * @notice Archives or reactivates a community. While inactive, `canPost` returns false for
     *         everyone (including the creator/moderators) and `join` reverts, but existing posts
     *         and membership records are left untouched — this is a freeze, not a delete.
     */
    function setCommunityStatus(uint256 _id, bool _isActive) external communityExists(_id) onlyCreator(_id) {
        communities[_id].isActive = _isActive;

        emit CommunityStatusUpdated(_id, _isActive);
    }

    /**
     * @notice Publishes the caller's community-specific identity public key (derived client-side
     *         from a wallet signature + PIN, unrelated to Chat's identity key). Self-service,
     *         re-registerable at any time (e.g. after choosing a new PIN).
     */
    function registerIdentityKey(bytes calldata pubKey) external {
        communityIdentityKeys[_msgSender()] = pubKey;
        emit IdentityKeyRegistered(_msgSender());
    }

    /**
     * @notice Creates version 1 of a community's content key, wrapped to the creator's own key.
     * @dev Only the community creator, only once per community.
     */
    function initializeKey(uint256 _id, bytes calldata creatorWrappedKey) external communityExists(_id) onlyCreator(_id) {
        if (keyVersion[_id] != 0) revert AlreadyInitialized();

        keyVersion[_id] = 1;
        wrappedKeys[_id][_msgSender()][1] = creatorWrappedKey;

        emit KeyInitialized(_id);
        emit KeyGranted(_id, _msgSender(), 1);
    }

    /**
     * @notice Grants a member access to the community's current key version.
     * @dev Only the creator/a moderator. Called right after approveRequest/addMember, and again
     *      per remaining member after a rotation (bumpKeyVersion) to bring them forward.
     */
    function grantKey(uint256 _id, address member, bytes calldata wrappedKey) external communityExists(_id) onlyModerator(_id) {
        uint256 version = keyVersion[_id];
        if (version == 0) revert NotInitialized();
        // Envelopes only for actual members — key delivery to outsiders was previously possible
        // (moderator-trust only); now the roster is enforced at the contract layer too.
        if (!registry[_id][member].isMember) revert NotMember();

        wrappedKeys[_id][member][version] = wrappedKey;
        emit KeyGranted(_id, member, version);
    }

    /**
     * @notice Batch version of grantKey — one transaction re-keys up to MAX_BATCH_SIZE members
     *         instead of one tx each, which is what makes lazy post-rotation re-grants practical
     *         for larger communities.
     */
    function grantKeyBatch(
        uint256 _id,
        address[] calldata _members,
        bytes[] calldata _wrappedKeys
    ) external communityExists(_id) onlyModerator(_id) {
        if (_members.length != _wrappedKeys.length) revert ArrayLengthMismatch();
        if (_members.length > MAX_BATCH_SIZE) revert BatchTooLarge();

        uint256 version = keyVersion[_id];
        if (version == 0) revert NotInitialized();

        for (uint256 i = 0; i < _members.length; i++) {
            // Skip (not revert on) non-members: a batch prepared from a member snapshot must not
            // be wholly rejected because one address left between snapshot and confirmation.
            if (!registry[_id][_members[i]].isMember) continue;

            wrappedKeys[_id][_members[i]][version] = _wrappedKeys[i];
            emit KeyGranted(_id, _members[i], version);
        }
    }

    /**
     * @notice Bumps the community's key version (e.g. on ban) so future grants move remaining
     *         members onto a fresh content key. Does not itself re-grant anyone — the caller
     *         follows up with ordinary grantKey calls per remaining member, so no atomic
     *         on-chain member list is required here.
     */
    function bumpKeyVersion(uint256 _id) external communityExists(_id) onlyModerator(_id) returns (uint256 newVersion) {
        if (keyVersion[_id] == 0) revert NotInitialized();

        newVersion = ++keyVersion[_id];
        emit KeyRotated(_id, newVersion);
    }

    /**
     * @notice Per-community history policy: when true, each rotation also publishes a "backlink"
     *         (the retiring content key encrypted under the new one — see publishKeyBacklink), so
     *         members holding only the current key can walk the chain backward and read posts
     *         from before they joined. When false, rotations are epoch walls (default).
     * @dev Cooperative, not cryptographically enforced: moderator clients honor the flag when
     *      rotating, and moderators hold every historical envelope regardless. Toggling OFF only
     *      affects future rotations — already-published backlinks are on-chain forever.
     */
    function setHistoryVisibility(uint256 _id, bool _visible) external communityExists(_id) onlyModerator(_id) {
        historyVisibleToNewMembers[_id] = _visible;
        emit HistoryVisibilityUpdated(_id, _visible);
    }

    /**
     * @notice Publishes the backward key-chain link for `_version`: keyBacklinks[_id][_version]
     *         holds version `_version - 1`'s content key encrypted under version `_version`'s key
     *         (client-side AES-GCM). Write-once so a later moderator can't corrupt a valid link.
     *         Also used retroactively: turning history visibility on after epoch walls exist, a
     *         moderator (who holds envelopes for all versions) can backfill the missing links.
     */
    function publishKeyBacklink(uint256 _id, uint256 _version, bytes calldata _link) external communityExists(_id) onlyModerator(_id) {
        if (_version < 2 || _version > keyVersion[_id]) revert InvalidKeyVersion();
        // Write-once for moderators (a rogue moderator can't corrupt a valid link), but the
        // CREATOR may overwrite — the repair path if a moderator published garbage first.
        if (keyBacklinks[_id][_version].length != 0 && communities[_id].creator != _msgSender()) {
            revert BacklinkAlreadyPublished();
        }

        keyBacklinks[_id][_version] = _link;
        emit KeyBacklinkPublished(_id, _version);
    }

    /**
     * @notice Joins a community. Payable only in effect for PaidGated communities — send exactly
     *         paymentRequirements[_id].price in native coin when its `token` is address(0);
     *         otherwise approve this contract for that price on the ERC-20/LSP7 token first, and
     *         send no value.
     * @dev nonReentrant + checks-effects-interactions (membership is granted before the payment
     *      transfer runs) since the payout goes straight to the creator — who could be a contract
     *      with its own receive/token-transfer hooks (LSP7 in particular calls back into both
     *      sender and recipient on transfer).
     */
    function join(uint256 _id) external payable communityExists(_id) whenNotPaused nonReentrant {
        MemberStatus storage status = registry[_id][_msgSender()];
        if (status.isBanned) revert Banned();
        if (status.isMember) revert AlreadyMember();

        Community storage c = communities[_id];
        if (!c.isActive) revert CommunityInactive();
        if (msg.value > 0 && c.membershipType != MembershipType.PaidGated) revert IncorrectPaymentAmount();

        if (c.membershipType == MembershipType.Public) {
            status.isMember = true;
            status.canPost = true;
            _addToMemberList(_id, _msgSender());
            emit MemberStatusUpdated(_id, _msgSender(), true);
        } else if (c.membershipType == MembershipType.RequestBased) {
            status.isPending = true;
        } else if (c.membershipType == MembershipType.WhitelistGated) {
            if (!whitelist[_id][_msgSender()]) revert NotWhitelisted();
            status.isMember = true;
            status.canPost = true;
            _addToMemberList(_id, _msgSender());
            emit MemberStatusUpdated(_id, _msgSender(), true);
        } else if (c.membershipType == MembershipType.PaidGated) {
            PaymentRequirement memory req = paymentRequirements[_id];
            if (req.price == 0) revert PaymentNotConfigured();

            status.isMember = true;
            status.canPost = true;
            _addToMemberList(_id, _msgSender());
            emit MemberStatusUpdated(_id, _msgSender(), true);
            emit MembershipPaid(_id, _msgSender(), req.token, req.price);

            if (req.token == address(0)) {
                if (msg.value != req.price) revert IncorrectPaymentAmount();
                (bool success, ) = c.creator.call{value: req.price}("");
                if (!success) revert TransferFailed();
            } else {
                if (msg.value != 0) revert IncorrectPaymentAmount();
                if (req.isLsp7) {
                    // LSP7 (LUKSO): joiner must have called authorizeOperator(address(this), price, "")
                    // beforehand — LSP7 has no transferFrom; balanceOf is ERC-20-selector-compatible
                    // but transfers are not, so this can't reuse the plain ERC-20 branch below.
                    ILSP7Minimal(req.token).transfer(_msgSender(), c.creator, req.price, true, "");
                } else {
                    IERC20(req.token).safeTransferFrom(_msgSender(), c.creator, req.price);
                }
            }
        }
    }

    /**
     * @notice Adds or removes a wallet from a community's join whitelist. Only meaningful for
     *         WhitelistGated communities, but not restricted to that type — a creator can
     *         pre-populate a whitelist before switching a community's type via updateCommunity.
     */
    function setWhitelisted(uint256 _id, address _actor, bool _allowed) external communityExists(_id) onlyModerator(_id) {
        _setWhitelistedOne(_id, _actor, _allowed);
    }

    /// @notice Batch version of setWhitelisted, for adding/removing several addresses in one tx.
    function setWhitelistedBatch(uint256 _id, address[] calldata _actors, bool _allowed) external communityExists(_id) onlyModerator(_id) {
        if (_actors.length > MAX_BATCH_SIZE) revert BatchTooLarge();

        for (uint256 i = 0; i < _actors.length; i++) {
            _setWhitelistedOne(_id, _actors[i], _allowed);
        }
    }

    /**
     * @notice Voluntarily leaves a community. The creator can't leave their own community this
     *         way — they'd need to transfer ownership first, since `creator` is tracked separately
     *         from membership and canPost always lets the creator through regardless of this flag.
     * @dev Clears isModerator too, so rejoining a Public community later via `join` doesn't
     *      silently restore moderator powers.
     */
    function leave(uint256 _id) external communityExists(_id) {
        if (communities[_id].creator == _msgSender()) revert Unauthorized();

        MemberStatus storage status = registry[_id][_msgSender()];
        if (!status.isMember) revert NotMember();

        status.isMember = false;
        status.canPost = false;
        status.isModerator = false;
        _removeFromMemberList(_id, _msgSender());

        emit MemberStatusUpdated(_id, _msgSender(), false);
    }

    function addMember(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        registry[_id][_actor].isMember = true;
        registry[_id][_actor].canPost = true;
        registry[_id][_actor].isPending = false;
        _addToMemberList(_id, _actor);

        emit MemberStatusUpdated(_id, _actor, true);
    }

    function approveRequest(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        registry[_id][_actor].isMember = true;
        registry[_id][_actor].canPost = true;
        registry[_id][_actor].isPending = false;
        _addToMemberList(_id, _actor);

        emit MemberStatusUpdated(_id, _actor, true);
    }

    /**
     * @notice Declines a pending join request without banning — clears isPending so the wallet
     *         is free to request again later. Pairs with approveRequest; before this existed a
     *         pending flag could never be cleared on-chain except by approving.
     */
    function rejectRequest(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        registry[_id][_actor].isPending = false;

        emit MemberStatusUpdated(_id, _actor, registry[_id][_actor].isMember);
    }

    function setModerator(uint256 _id, address _actor, bool _isMod) external communityExists(_id) onlyCreator(_id) {
        registry[_id][_actor].isModerator = _isMod;

        emit ModeratorUpdated(_id, _actor, _isMod);
    }

    /// @dev The creator can't be banned (mirrors kick's guard — a moderator outranking the
    ///      creator would be a privilege inversion). Banning also strips moderator status, so a
    ///      later unban doesn't silently restore moderation powers — the creator must re-grant.
    function setBanStatus(uint256 _id, address _actor, bool _banned) external communityExists(_id) onlyModerator(_id) {
        if (communities[_id].creator == _actor) revert Unauthorized();

        MemberStatus storage status = registry[_id][_actor];
        status.isBanned = _banned;
        if (_banned) {
            status.isModerator = false;
        }

        emit MemberStatusUpdated(_id, _actor, !_banned);
    }

    /**
     * @notice Removes a member's current membership without banning them — unlike setBanStatus,
     *         they remain free to rejoin later (Public), be re-added (addMember/approveRequest),
     *         or be re-whitelisted. This is the missing middle ground between "still a member" and
     *         "permanently banned".
     */
    function kick(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        if (communities[_id].creator == _actor) revert Unauthorized();

        MemberStatus storage status = registry[_id][_actor];
        if (!status.isMember) revert NotMember();

        status.isMember = false;
        status.canPost = false;
        status.isModerator = false;
        _removeFromMemberList(_id, _actor);

        emit MemberStatusUpdated(_id, _actor, false);
    }

    function setNftRequirement(uint256 _id, address _nftAddress, uint256 _minBalance) external communityExists(_id) onlyModerator(_id) {
        nftRequirements[_id] = NftRequirement(_nftAddress, _minBalance);
    }

    function setTokenRequirement(uint256 _id, address _tokenAddress, uint256 _minBalance) external communityExists(_id) onlyModerator(_id) {
        tokenRequirements[_id] = TokenRequirement(_tokenAddress, _minBalance);
    }

    /// @notice Sets the join price for a PaidGated community. `_token` address(0) means native
    ///         coin; `_isLsp7` only matters when `_token` is set and selects the LSP7 transfer
    ///         path over plain ERC-20.
    /// @dev Creator-only (unlike the NFT/token gates): the payout goes to the creator, so the
    ///      price is theirs to set — a moderator repricing someone else's revenue is out of scope
    ///      for moderation powers.
    function setPaymentRequirement(
        uint256 _id,
        address _token,
        uint256 _price,
        bool _isLsp7
    ) external communityExists(_id) onlyCreator(_id) {
        paymentRequirements[_id] = PaymentRequirement(_token, _price, _token != address(0) && _isLsp7);
    }

    function setPostingPermission(uint256 _id, address _actor, bool _canPost) external communityExists(_id) onlyModerator(_id) {
        registry[_id][_actor].canPost = _canPost;

        emit MemberStatusUpdated(_id, _actor, registry[_id][_actor].isMember);
    }

    /**
     * @notice Starts a two-step transfer of a community's creator role to `_newCreator`.
     * @dev Mirrors OZ's Ownable2Step: the transfer only completes once `_newCreator` calls
     *      `acceptCommunityOwnership`, so a typo'd or inaccessible address can't strand the community.
     */
    function transferCommunityOwnership(uint256 _id, address _newCreator) external communityExists(_id) onlyCreator(_id) {
        if (_newCreator == address(0) || _newCreator == _msgSender()) revert InvalidAddress();

        pendingCreator[_id] = _newCreator;

        emit CommunityOwnershipTransferStarted(_id, _msgSender(), _newCreator);
    }

    function cancelCommunityOwnershipTransfer(uint256 _id) external communityExists(_id) onlyCreator(_id) {
        delete pendingCreator[_id];
    }

    /**
     * @notice Sets (or clears, with address(0)) the community's governance executor. While set,
     *         the governor passes every onlyCreator/onlyModerator gate alongside the creator.
     * @dev Callable by the creator or the current governor — so a DAO can replace or renounce
     *      itself by proposal. The creator keeping this power is deliberate ("soft DAO"); a
     *      community wanting authority to derive purely from governance should follow up by
     *      transferring the creator role to the governor via transferCommunityOwnership.
     */
    function setGovernor(uint256 _id, address _governor) external communityExists(_id) onlyCreator(_id) {
        governors[_id] = _governor;

        emit CommunityGovernorUpdated(_id, _governor);
    }

    /**
     * @notice Completes a pending ownership transfer. Callable only by the pending creator.
     * @dev Grants the new creator a full MemberStatus, same as `createCommunity`, so they can
     *      immediately post and moderate. The prior creator's own MemberStatus is left untouched.
     */
    function acceptCommunityOwnership(uint256 _id) external communityExists(_id) {
        address newCreator = _msgSender();
        if (pendingCreator[_id] != newCreator) revert NotPendingCreator();

        Community storage c = communities[_id];
        address oldCreator = c.creator;
        c.creator = newCreator;
        delete pendingCreator[_id];

        registry[_id][newCreator] = MemberStatus(true, false, true, false, true);
        _addToMemberList(_id, newCreator);

        emit CommunityOwnershipTransferred(_id, oldCreator, newCreator);
    }

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

        // The UI collects a minimum-balance threshold — enforce it (0 kept as "hold any 1")
        uint256 required = req.minBalance == 0 ? 1 : req.minBalance;
        return IERC721(req.nftAddress).balanceOf(_actor) >= required;
    }

    /// @notice True if `_actor` follows the community's creator on the wired-in LSP26-compatible
    ///         follower registry. Fails closed (returns false) if no registry has been set yet.
    function isEligibleViaFollow(address _actor, uint256 _id) public view returns (bool) {
        if (followerSystem == address(0)) return false;

        return ILSP26FollowerSystem(followerSystem).isFollowing(_actor, communities[_id].creator);
    }

    function canPost(address actor, uint256 communityId) external view override returns (bool) {
        if (communityId == 0) return true;

        Community storage c = communities[communityId];
        if (!c.isActive) return false;

        MemberStatus storage status = registry[communityId][actor];

        if (status.isBanned) return false;
        if (c.creator == actor || status.isModerator) return true;
        if (c.cType == CommunityType.Broadcast) return false;
        if (!status.canPost) return false;
        if (c.membershipType == MembershipType.Public) return true;

        if (c.membershipType == MembershipType.NftGated) {
            return isEligibleViaNft(actor, communityId);
        }

        if (c.membershipType == MembershipType.TokenGated) {
            return isEligibleViaToken(actor, communityId);
        }

        if (c.membershipType == MembershipType.NftAndTokenGated) {
            return isEligibleViaNft(actor, communityId) && isEligibleViaToken(actor, communityId);
        }

        if (c.membershipType == MembershipType.FollowerGated) {
            return isEligibleViaFollow(actor, communityId);
        }

        return status.isMember;
    }

    /// @notice Total current members of a community — pairs with getMembers for pagination.
    /// @dev Moderator-gated to keep member lists out of casual reach. Best-effort only: view
    /// gating can be bypassed by spoofing `from` in eth_call, and membership is reconstructable
    /// from storage slots and MemberStatusUpdated events. Real hiding requires the planned
    /// separate ZK-membership contract.
    function memberCount(uint256 _id) external view communityExists(_id) onlyModerator(_id) returns (uint256) {
        return memberSet[_id].length();
    }

    /// @notice Paginated read of a community's current member addresses. No indexer required.
    /// @dev Moderator-gated — see memberCount for the honest limits of view gating.
    function getMembers(uint256 _id, uint256 offset, uint256 limit) external view communityExists(_id) onlyModerator(_id) returns (address[] memory page) {
        EnumerableSet.AddressSet storage set = memberSet[_id];
        uint256 total = set.length();
        if (offset >= total || limit == 0) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;

        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = set.at(i);
        }
    }

    /// @notice Total whitelisted wallets for a community — pairs with getWhitelist for pagination.
    /// @dev Moderator-gated — see memberCount for the honest limits of view gating.
    function whitelistCount(uint256 _id) external view communityExists(_id) onlyModerator(_id) returns (uint256) {
        return whitelistSet[_id].length();
    }

    /// @notice Paginated read of a community's whitelisted wallet addresses. No indexer required.
    /// @dev Moderator-gated — see memberCount for the honest limits of view gating.
    function getWhitelist(uint256 _id, uint256 offset, uint256 limit) external view communityExists(_id) onlyModerator(_id) returns (address[] memory page) {
        EnumerableSet.AddressSet storage set = whitelistSet[_id];
        uint256 total = set.length();
        if (offset >= total || limit == 0) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;

        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = set.at(i);
        }
    }

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

    /// @notice Tunes community-creation rate limiting. Either value set to 0 disables that check.
    function setCreationLimits(uint256 _cooldown, uint256 _maxPerWallet) external onlyDirectAdmin {
        creationCooldown = _cooldown;
        maxCommunitiesPerWallet = _maxPerWallet;

        emit CreationLimitsUpdated(_cooldown, _maxPerWallet);
    }

    /// @notice Wires in the LSP26-compatible follower registry FollowerGated communities check
    ///         against. address(0) makes isEligibleViaFollow (and canPost for that type) fail
    ///         closed until it's set.
    function setFollowerSystem(address _followerSystem) external onlyDirectAdmin {
        address oldValue = followerSystem;
        followerSystem = _followerSystem;

        emit FollowerSystemUpdated(oldValue, _followerSystem);
    }

    function withdrawAll(address payable _receiver) external onlyDirectAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 balance = address(this).balance;
        if (balance == 0) revert TransferFailed();

        (bool success, ) = _receiver.call{value: balance}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(_receiver, balance);
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
