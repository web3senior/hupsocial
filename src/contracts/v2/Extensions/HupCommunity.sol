// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
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

    /// @dev Field order is load-bearing: creator/admission/cType/isActive pack into one slot
    ///      (20 + 1 + 1 + 1 bytes), which is what makes canPost's isActive-then-creator reads hit
    ///      the same warm slot. `metadata` must stay last — a string always takes its own slot, so
    ///      anything after it starts a new one.
    struct Community {
        uint256 id;
        address creator;
        AdmissionMode admission;
        CommunityType cType;
        bool isActive;
        string metadata;
    }

    // Moderation here is per-community (registry[id][wallet].isModerator), not an AccessControl
    // role — the only protocol-wide role is ADMIN_ROLE.
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
    mapping(uint256 => PaymentRequirement) public paymentRequirements;
    mapping(uint256 => address) public pendingCreator;

    /// @notice creator => withdrawable native-coin join fees (pull-over-push: paying out inside
    ///         join() would let a creator whose address can't receive native coin — a Safe/
    ///         Timelock without a payable path, or a griefing contract — permanently brick
    ///         joins for their community). Token-priced fees still transfer directly, since
    ///         the creator picked the token and its failure modes themselves.
    mapping(address => uint256) public joinPayouts;

    /// @notice Sum of all unclaimed joinPayouts balances. Fences withdrawAll off the escrow:
    ///         the admin sweep may only take address(this).balance minus this amount, so
    ///         creators' accrued join fees can never be drained out from under them.
    uint256 public totalJoinPayouts;

    // --- Composable eligibility requirements ---
    // What a wallet must hold or be, independent of how it is admitted (AdmissionMode) and of
    // whether content is encrypted (keyVersion). Checked at join() for SelfServeIfEligible and
    // PayToJoin (never charge a wallet that couldn't post), and re-checked live inside canPost()
    // for everyone — sell the gating asset and posting rights lapse immediately, exactly like
    // the old single-asset gated types behaved.

    /// @notice Hard cap on a community's requirement list, bounding join()'s external-call gas.
    uint256 public constant MAX_REQUIREMENTS = 10;

    /// @notice Gas ceiling for eligibility-module calls — a hostile module fails closed instead
    ///         of gas-bombing join()/canPost() callers.
    uint256 public constant ELIGIBILITY_MODULE_GAS_CAP = 100_000;

    /// @notice Gas ceiling for balanceOf reads against requirement assets — same fail-closed
    ///         philosophy as the module cap: a hostile or broken token can neither gas-bomb nor
    ///         revert join()/canPost() callers. Generous for any honest balanceOf, including
    ///         proxied and rebasing (shares-computed) tokens.
    uint256 public constant ASSET_READ_GAS_CAP = 50_000;

    mapping(uint256 => AssetRequirement[]) private requirementsOf;

    /// @notice communityId => how its requirement list combines (AllOf / AnyOf).
    mapping(uint256 => RequirementMode) public requirementMode;

    /// @notice communityId => optional IHupEligibilityModule for logic the list can't express.
    ///         ANDed with the requirement list; a reverting module fails closed.
    mapping(uint256 => address) public eligibilityModules;

    /// @notice communityId => wallet => outstanding moderator invite awaiting the wallet's own
    ///         acceptInvite. Consent is structural: membership is a public, indexed signal, so no
    ///         moderator action may place a wallet on a roster unilaterally — an invite grants
    ///         nothing until the invitee accepts it.
    mapping(uint256 => mapping(address => bool)) public invites;

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

    /// @notice communityId => wallet => passes the Whitelisted requirement type (see AssetRequirement).
    mapping(uint256 => mapping(address => bool)) public whitelist;

    // --- Enumerable member/whitelist/banned lists ---
    // Solidity mappings alone can't be listed or paginated, so `registry` (members and, since a
    // ban removes membership, banned wallets separately) and `whitelist` are mirrored into
    // OpenZeppelin's EnumerableSet purely so the contract itself can answer "list all members"/
    // "list the whitelist"/"who is banned" directly — no indexer required for correctness.
    // cidex still indexes the same events for a faster/richer read path (search, joined-with-
    // role, etc.), but nothing here depends on it being up to date.

    mapping(uint256 => EnumerableSet.AddressSet) private memberSet;
    mapping(uint256 => EnumerableSet.AddressSet) private whitelistSet;
    mapping(uint256 => EnumerableSet.AddressSet) private bannedSet;

    // --- Creation rate limiting ---
    // Cheap, adjustable anti-spam guard for when createCommunity has no cost floor (`fee` 0).
    // Both knobs are admin-tunable via setCreationLimits; 0 disables the respective check.
    // Cooldown ships disabled — turn it on if spam actually shows up, rather than taxing
    // legitimate creators from day one.

    uint256 public creationCooldown = 0;
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
        AdmissionMode _admission,
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

        communities[id] = Community(id, sender, _admission, _communityType, true, _metadataCid);
        registry[id][sender] = MemberStatus(true, false, true, false, true);
        _addToMemberList(id, sender);

        if (initialWrappedKey.length > 0) {
            // The creator can always open their own envelope without registering (the private
            // half lives client-side), but an unregistered creator has no mailbox for a co-
            // moderator's future rotation grants — they'd silently lose access at the first
            // rotation. Enforce the right order here instead of discovering it months later.
            if (communityIdentityKeys[sender].length == 0) revert IdentityNotRegistered();

            keyVersion[id] = 1;
            wrappedKeys[id][sender][1] = initialWrappedKey;
            emit KeyInitialized(id);
            emit KeyGranted(id, sender, 1);
        }

        emit CommunityCreated(id, sender, _admission);
        return id;
    }

    /// @dev Creator-only (not moderators): changing the admission mode can flip an invite-only
    /// community open or add a paywall — too much power to delegate to moderators.
    function updateCommunity(uint256 _id, AdmissionMode _admission, CommunityType _communityType, string calldata _metadataCid) external communityExists(_id) onlyCreator(_id) {
        if (bytes(_metadataCid).length > MAX_METADATA_LENGTH) revert MetadataTooLong();

        Community storage c = communities[_id];

        c.admission = _admission;
        c.cType = _communityType;
        c.metadata = _metadataCid;

        emit CommunityUpdated(_id, _admission, _communityType, _metadataCid);
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
     * @dev Only the creator/a moderator. Called right after approveRequest (or once an invitee accepts and files a key request), and again
     *      per remaining member after a rotation (bumpKeyVersion) to bring them forward.
     */
    function grantKey(uint256 _id, address member, bytes calldata wrappedKey) external communityExists(_id) onlyModerator(_id) {
        uint256 version = keyVersion[_id];
        if (version == 0) revert NotInitialized();
        // Envelopes only for actual members — key delivery to outsiders was previously possible
        // (moderator-trust only); now the roster is enforced at the contract layer too. A ban
        // already clears isMember (setBanStatus), so the isBanned check is belt-and-braces from
        // the same storage slot: a banned wallet must never receive a rotated key.
        MemberStatus storage target = registry[_id][member];
        if (!target.isMember || target.isBanned) revert NotMember();

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
            // Skip (not revert on) non-members and banned wallets: a batch prepared from a member
            // snapshot must not be wholly rejected because one address left (or was banned)
            // between snapshot and confirmation — and a banned wallet must never be re-keyed.
            MemberStatus storage target = registry[_id][_members[i]];
            if (!target.isMember || target.isBanned) continue;

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
     * @param _maxPrice Highest price the caller is willing to pay, in the payment asset's smallest
     *        unit. Ignored by every unpaid admission mode — pass 0 there, which also makes a
     *        community that flips to PayToJoin between signing and mining revert instead of
     *        charging silently.
     * @dev nonReentrant + checks-effects-interactions (membership is granted before the payment
     *      transfer runs) since the payout goes straight to the creator — who could be a contract
     *      with its own receive/token-transfer hooks (LSP7 in particular calls back into both
     *      sender and recipient on transfer).
     */
    function join(uint256 _id, uint256 _maxPrice) external payable communityExists(_id) whenNotPaused nonReentrant {
        address sender = _msgSender();
        MemberStatus storage status = registry[_id][sender];
        if (status.isBanned) revert Banned();
        if (status.isMember) revert AlreadyMember();

        Community storage c = communities[_id];
        if (!c.isActive) revert CommunityInactive();
        if (msg.value > 0 && c.admission != AdmissionMode.PayToJoin) revert IncorrectPaymentAmount();

        if (c.admission == AdmissionMode.Open) {
            _admit(_id, sender);
        } else if (c.admission == AdmissionMode.RequestApproval) {
            status.isPending = true;
            emit MembershipRequested(_id, sender);
        } else if (c.admission == AdmissionMode.InviteOnly) {
            // acceptInvite is the only path onto an invite-only roster
            revert NotInvited();
        } else if (c.admission == AdmissionMode.SelfServeIfEligible) {
            if (!isEligible(sender, _id)) revert NotEligible();
            _admit(_id, sender);
        } else {
            // PayToJoin — membership is granted before the payout runs (checks-effects-
            // interactions + nonReentrant): the recipient is the creator, who could be a
            // contract with its own receive/token-transfer hooks (LSP7 in particular calls
            // back into both sender and recipient on transfer).
            PaymentRequirement memory req = paymentRequirements[_id];
            if (req.price == 0) revert PaymentNotConfigured();
            // Price ceiling: setPaymentRequirement can land between the joiner signing and the tx
            // being mined. A native join already fails closed on msg.value != req.price, but a
            // token join is bounded only by the standing allowance — a wallet carrying one larger
            // than the price it agreed to would silently pay the new one. The caller pins the max.
            if (req.price > _maxPrice) revert PriceExceedsMax();
            // A paid admission is the one path where admitting-then-gating would cost the joiner
            // money: canPost re-checks the requirement list live, so a wallet that pays while
            // failing it would be admitted, unable to post, and unrefundable. Check before any
            // coin moves. (Open joins deliberately still admit first — read-only membership until
            // the wallet qualifies costs nothing.)
            if (!isEligible(sender, _id)) revert NotEligible();

            _admit(_id, sender);
            emit MembershipPaid(_id, sender, req.token, req.price);

            if (req.token == address(0)) {
                if (msg.value != req.price) revert IncorrectPaymentAmount();
                // Pull-over-push: accrue to the creator's payout ledger instead of forwarding —
                // a non-payable or reverting creator address must never block admissions
                joinPayouts[c.creator] += req.price;
                totalJoinPayouts += req.price;
            } else {
                if (msg.value != 0) revert IncorrectPaymentAmount();
                if (req.isLsp7) {
                    // LSP7 (LUKSO): joiner must have called authorizeOperator(address(this), price, "")
                    // beforehand — LSP7 has no transferFrom; balanceOf is ERC-20-selector-compatible
                    // but transfers are not, so this can't reuse the plain ERC-20 branch below.
                    ILSP7Minimal(req.token).transfer(sender, c.creator, req.price, true, "");
                } else {
                    IERC20(req.token).safeTransferFrom(sender, c.creator, req.price);
                }
            }
        }
    }

    /// @notice Withdraws the caller's accrued native-coin join fees (see joinPayouts) to the
    ///         caller's own address.
    function withdrawJoinPayouts() external {
        withdrawJoinPayoutsTo(payable(_msgSender()));
    }

    /// @notice Withdraws the caller's accrued native-coin join fees to `_to`.
    /// @dev The recipient is overridable because the ledger's whole reason for existing is a
    ///      creator address that can't receive native coin (Safe/Timelock without a payable
    ///      path). Paying out to _msgSender() alone would strand exactly those balances: the
    ///      escrow keeps joins working, this keeps the coin recoverable. Only the caller's own
    ///      ledger entry is ever spent — there is no approval or delegation to abuse.
    function withdrawJoinPayoutsTo(address payable _to) public nonReentrant {
        if (_to == address(0)) revert InvalidAddress();

        address sender = _msgSender();
        uint256 amount = joinPayouts[sender];
        if (amount == 0) revert NothingToWithdraw();

        joinPayouts[sender] = 0;
        totalJoinPayouts -= amount;
        (bool success, ) = _to.call{value: amount}("");
        if (!success) revert TransferFailed();

        // Withdrawal stays for existing indexers; JoinPayoutWithdrawn is the precise one.
        emit Withdrawal(_to, amount);
        emit JoinPayoutWithdrawn(sender, _to, amount);
    }

    /// @dev Shared admission effect for every path that ends in membership (open/eligible/paid
    ///      joins, approvals, accepted invites) — one place emits MemberStatusUpdated.
    function _admit(uint256 _id, address _actor) private {
        MemberStatus storage status = registry[_id][_actor];
        status.isMember = true;
        status.canPost = true;
        status.isPending = false;
        _addToMemberList(_id, _actor);

        emit MemberStatusUpdated(_id, _actor, true);
    }

    /**
     * @notice Adds or removes a wallet from a community's join whitelist. Only meaningful for
     *         communities using the Whitelisted requirement type, but not restricted to them — a creator can
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

    /**
     * @notice Invites a wallet to the community. Replaces the old consentless addMember: the
     *         invite grants nothing until the invitee calls acceptInvite themselves, so nobody
     *         can be conscripted onto a roster (membership is public, indexed, and permanent in
     *         the event log — being listed must be the wallet owner's own choice).
     */
    function inviteMember(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        if (_actor == address(0)) revert InvalidAddress();
        if (registry[_id][_actor].isMember) revert AlreadyMember();
        if (registry[_id][_actor].isBanned) revert Banned();

        invites[_id][_actor] = true;

        emit MemberInvited(_id, _actor);
    }

    /// @notice Moderator withdraws an outstanding invite before it is accepted.
    function cancelInvite(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        delete invites[_id][_actor];

        emit InviteRevoked(_id, _actor);
    }

    /// @notice Invitee turns the invite down — same cleanup as cancelInvite, from the other side.
    function declineInvite(uint256 _id) external communityExists(_id) {
        delete invites[_id][_msgSender()];

        emit InviteRevoked(_id, _msgSender());
    }

    /**
     * @notice Accepts a pending invite — the only way a moderator's inviteMember ever results in
     *         membership. Bans and archived status are re-checked here since either may have
     *         changed while the invite sat open.
     */
    function acceptInvite(uint256 _id) external communityExists(_id) {
        address sender = _msgSender();
        if (!invites[_id][sender]) revert NotInvited();
        if (!communities[_id].isActive) revert CommunityInactive();
        if (registry[_id][sender].isBanned) revert Banned();

        delete invites[_id][sender];
        _admit(_id, sender);
    }

    function approveRequest(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        // Consent guard: only requests the wallet itself filed (join() sets isPending) can be
        // approved — without this, approveRequest doubles as a consentless addMember.
        if (!registry[_id][_actor].isPending) revert NoPendingRequest();
        // Mirror acceptInvite: bans and archived status are re-checked since either may have
        // changed while the request sat pending (setBanStatus doesn't clear isPending) — without
        // this, approving a stale request puts a banned wallet on the roster of a live community,
        // or grows the roster of an archived one. A stuck banned request is cleared via rejectRequest.
        if (!communities[_id].isActive) revert CommunityInactive();
        if (registry[_id][_actor].isBanned) revert Banned();

        _admit(_id, _actor);
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

    /**
     * @notice Withdraws the caller's own pending join request — the requester's side of
     *         rejectRequest. Without it a filed request could only be cleared by a moderator
     *         (leave() reverts NotMember for a wallet that was never admitted), so a wallet
     *         that changed its mind sat in the queue indefinitely.
     */
    function cancelRequest(uint256 _id) external communityExists(_id) {
        address sender = _msgSender();
        MemberStatus storage status = registry[_id][sender];
        if (!status.isPending) revert NoPendingRequest();

        status.isPending = false;

        emit MemberStatusUpdated(_id, sender, status.isMember);
    }

    function setModerator(uint256 _id, address _actor, bool _isMod) external communityExists(_id) onlyCreator(_id) {
        registry[_id][_actor].isModerator = _isMod;

        emit ModeratorUpdated(_id, _actor, _isMod);
    }

    /**
     * @notice Bans (or unbans) a wallet. A ban is a kick plus a flag: the wallet leaves the
     *         roster, loses moderator status and any pending request, and can't join, accept an
     *         invite, or be approved again until unbanned. Unbanning only lifts the flag — it
     *         does NOT restore membership or moderation; the wallet rejoins through the
     *         community's admission mode and the creator re-grants moderation explicitly.
     * @dev Neither the creator nor the governor can be banned (mirrors kick's guard — a
     *      moderator outranking either would be a privilege inversion; banning the governor
     *      would only block its posting while every creator-level power stayed intact, and it
     *      could unban itself anyway). Clearing isMember here is what keeps memberCount/
     *      getMembers and the grantKey/grantKeyBatch roster checks honest without consulting
     *      isBanned separately: the contract upholds `isMember => !isBanned` at every write site
     *      (every admit path checks the flag first), so a banned wallet can never be handed a
     *      rotated content key. The event carries the real post-ban membership (false), and an
     *      unban of a never-member no longer reports a join that didn't happen.
     */
    function setBanStatus(uint256 _id, address _actor, bool _banned) external communityExists(_id) onlyModerator(_id) {
        if (communities[_id].creator == _actor || governors[_id] == _actor) revert Unauthorized();

        MemberStatus storage status = registry[_id][_actor];
        status.isBanned = _banned;
        if (_banned) {
            status.isModerator = false;
            status.isPending = false;
            if (status.isMember) {
                status.isMember = false;
                status.canPost = false;
                _removeFromMemberList(_id, _actor);
            }
            bannedSet[_id].add(_actor);
        } else {
            bannedSet[_id].remove(_actor);
        }

        emit MemberStatusUpdated(_id, _actor, status.isMember);
    }

    /**
     * @notice Removes a member's current membership without banning them — unlike setBanStatus,
     *         they remain free to rejoin later (Open), be re-invited (inviteMember/approveRequest),
     *         or be re-whitelisted. This is the missing middle ground between "still a member" and
     *         "permanently banned".
     */
    function kick(uint256 _id, address _actor) external communityExists(_id) onlyModerator(_id) {
        if (communities[_id].creator == _actor || governors[_id] == _actor) revert Unauthorized();

        MemberStatus storage status = registry[_id][_actor];
        if (!status.isMember) revert NotMember();

        status.isMember = false;
        status.canPost = false;
        status.isModerator = false;
        _removeFromMemberList(_id, _actor);

        emit MemberStatusUpdated(_id, _actor, false);
    }

    /**
     * @notice Replaces the community's whole requirement list and its ALL/ANY combinator.
     *         Requirements compose with any admission mode: they gate join() under
     *         SelfServeIfEligible and are re-checked live in canPost() for every member.
     * @dev Creator-only (same reasoning as updateCommunity): the requirement list decides who
     *      can participate, which is community-shape power, not day-to-day moderation.
     */
    function setRequirements(
        uint256 _id,
        AssetRequirement[] calldata _requirements,
        RequirementMode _mode
    ) external communityExists(_id) onlyCreator(_id) {
        if (_requirements.length > MAX_REQUIREMENTS) revert TooManyRequirements();

        delete requirementsOf[_id];
        for (uint256 i = 0; i < _requirements.length; i++) {
            AssetRequirement calldata r = _requirements[i];
            if (r.rType == RequirementType.TokenBalance || r.rType == RequirementType.NftBalance) {
                if (r.asset == address(0)) revert InvalidAddress();
                // Probe balanceOf(address) at set time so a wrong asset (an ERC-1155, an EOA, a
                // typo) is rejected here with a clear error instead of surfacing later as the
                // requirement failing closed for every member in canPost().
                (bool ok, ) = _tryBalanceOf(r.asset, _msgSender());
                if (!ok) revert InvalidAsset();
            }
            requirementsOf[_id].push(r);
        }
        requirementMode[_id] = _mode;

        emit RequirementsUpdated(_id, _mode, _requirements.length);
    }

    /// @notice The community's current requirement list (pair with requirementMode for ALL/ANY).
    function getRequirements(uint256 _id) external view returns (AssetRequirement[] memory) {
        return requirementsOf[_id];
    }

    /// @notice Points the community at an optional IHupEligibilityModule for logic the built-in
    ///         list can't express; address(0) clears it. ANDed with the requirement list.
    function setEligibilityModule(uint256 _id, address _module) external communityExists(_id) onlyCreator(_id) {
        eligibilityModules[_id] = _module;

        emit EligibilityModuleUpdated(_id, _module);
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
        bool isLsp7 = _token != address(0) && _isLsp7;
        paymentRequirements[_id] = PaymentRequirement(_token, _price, isLsp7);

        emit PaymentRequirementUpdated(_id, _token, _price, isLsp7);
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

    /// @dev Gas-capped, non-reverting balanceOf(address) probe shared by the ERC-20/LSP7 and
    ///      ERC-721/LSP8 requirement checks (the selector is identical across all four standards).
    ///      Deliberately a raw staticcall rather than try/catch: try/catch does NOT catch the
    ///      revert from calling an address with no code, nor a return-data decoding failure —
    ///      exactly what a typo'd, EOA, or ERC-1155 `asset` produces. `ok` false means the asset
    ///      reverted, is not a contract, or returned malformed data; callers treat that as
    ///      "requirement not met" so one broken asset can never revert isEligible/canPost (and
    ///      with it Hup core's post flow) for the whole community.
    function _tryBalanceOf(address _asset, address _holder) private view returns (bool ok, uint256 balance) {
        (bool success, bytes memory data) = _asset.staticcall{gas: ASSET_READ_GAS_CAP}(
            abi.encodeCall(IERC20.balanceOf, (_holder))
        );
        if (!success || data.length < 32) return (false, 0);
        return (true, abi.decode(data, (uint256)));
    }

    /// @dev One requirement entry against one wallet. Balance reads are gas-capped and fail
    ///      closed on broken assets (see _tryBalanceOf); FollowsCreator fails closed when no
    ///      LSP26 registry has been wired; NFT minBalance 0 is kept as "hold any 1".
    function _passesRequirement(uint256 _id, address _actor, AssetRequirement memory r) private view returns (bool) {
        if (r.rType == RequirementType.NativeBalance) {
            return _actor.balance >= r.minBalance;
        }
        if (r.rType == RequirementType.TokenBalance) {
            (bool ok, uint256 balance) = _tryBalanceOf(r.asset, _actor);
            return ok && balance >= r.minBalance;
        }
        if (r.rType == RequirementType.NftBalance) {
            uint256 required = r.minBalance == 0 ? 1 : r.minBalance;
            (bool ok, uint256 balance) = _tryBalanceOf(r.asset, _actor);
            return ok && balance >= required;
        }
        if (r.rType == RequirementType.Whitelisted) {
            return whitelist[_id][_actor];
        }
        // FollowsCreator — same gas-capped, fail-closed staticcall discipline as the balance
        // reads: a mis-wired or hostile registry makes the requirement fail, never canPost revert
        if (followerSystem == address(0)) return false;
        (bool success, bytes memory data) = followerSystem.staticcall{gas: ASSET_READ_GAS_CAP}(
            abi.encodeCall(ILSP26FollowerSystem.isFollowing, (_actor, communities[_id].creator))
        );
        // Decoded as a word, not a bool: abi.decode(bool) panics on any value other than 0/1,
        // which would turn a malformed registry reply into exactly the revert this guards against
        return success && data.length >= 32 && abi.decode(data, (uint256)) == 1;
    }

    /**
     * @notice Live composite eligibility: the requirement list under its ALL/ANY mode, ANDed
     *         with the optional eligibility module. An empty list with no module means everyone
     *         is eligible. This is what SelfServeIfEligible joins and every canPost() consult.
     */
    function isEligible(address _actor, uint256 _id) public view returns (bool) {
        AssetRequirement[] storage reqs = requirementsOf[_id];
        uint256 len = reqs.length;

        if (len > 0) {
            if (requirementMode[_id] == RequirementMode.AnyOf) {
                bool anyPassed = false;
                for (uint256 i = 0; i < len; i++) {
                    if (_passesRequirement(_id, _actor, reqs[i])) {
                        anyPassed = true;
                        break;
                    }
                }
                if (!anyPassed) return false;
            } else {
                for (uint256 i = 0; i < len; i++) {
                    if (!_passesRequirement(_id, _actor, reqs[i])) return false;
                }
            }
        }

        address module = eligibilityModules[_id];
        if (module != address(0)) {
            // A reverting or broken module fails closed rather than bricking canPost/join, and
            // the gas cap keeps a hostile module from turning joins into gas bombs — 100k is
            // generous for any honest eligibility check (a handful of SLOADs/balance reads)
            try IHupEligibilityModule(module).isEligible{gas: ELIGIBILITY_MODULE_GAS_CAP}(_id, _actor) returns (bool ok) {
                if (!ok) return false;
            } catch {
                return false;
            }
        }

        return true;
    }

    function canPost(address actor, uint256 communityId) external view override returns (bool) {
        if (communityId == 0) return true;

        Community storage c = communities[communityId];
        if (!c.isActive) return false;

        MemberStatus storage status = registry[communityId][actor];

        if (status.isBanned) return false;
        // Order matters for gas: creator (slot already warm from isActive) and isModerator
        // (same slot as isBanned) come before the cold governors mapping read
        if (c.creator == actor || status.isModerator || governors[communityId] == actor) return true;
        if (c.cType == CommunityType.Broadcast) return false;
        if (!status.isMember || !status.canPost) return false;

        // Requirements are re-checked live on every post, whatever the admission mode — selling
        // the gating asset (AllOf) suspends posting until the wallet qualifies again
        return isEligible(actor, communityId);
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
    function getMembers(uint256 _id, uint256 offset, uint256 limit) external view communityExists(_id) onlyModerator(_id) returns (address[] memory) {
        return _page(memberSet[_id], offset, limit);
    }

    /// @notice Total whitelisted wallets for a community — pairs with getWhitelist for pagination.
    /// @dev Moderator-gated — see memberCount for the honest limits of view gating.
    function whitelistCount(uint256 _id) external view communityExists(_id) onlyModerator(_id) returns (uint256) {
        return whitelistSet[_id].length();
    }

    /// @notice Paginated read of a community's whitelisted wallet addresses. No indexer required.
    /// @dev Moderator-gated — see memberCount for the honest limits of view gating.
    function getWhitelist(uint256 _id, uint256 offset, uint256 limit) external view communityExists(_id) onlyModerator(_id) returns (address[] memory) {
        return _page(whitelistSet[_id], offset, limit);
    }

    /// @notice Total banned wallets for a community — pairs with getBanned for pagination. Banned
    ///         wallets are not members (setBanStatus removes them from the roster), so this is the
    ///         list a moderator unbans from.
    /// @dev Moderator-gated — see memberCount for the honest limits of view gating.
    function bannedCount(uint256 _id) external view communityExists(_id) onlyModerator(_id) returns (uint256) {
        return bannedSet[_id].length();
    }

    /// @notice Paginated read of a community's banned wallet addresses. No indexer required.
    /// @dev Moderator-gated — see memberCount for the honest limits of view gating.
    function getBanned(uint256 _id, uint256 offset, uint256 limit) external view communityExists(_id) onlyModerator(_id) returns (address[] memory) {
        return _page(bannedSet[_id], offset, limit);
    }

    /// @dev One pagination routine behind getMembers/getWhitelist/getBanned. Clamps against the
    ///      remaining tail rather than truncating offset + limit afterwards — the sum overflows
    ///      to a panic revert on a caller passing an unbounded `limit`.
    function _page(EnumerableSet.AddressSet storage set, uint256 offset, uint256 limit) private view returns (address[] memory page) {
        uint256 total = set.length();
        if (offset >= total || limit == 0) return new address[](0);

        uint256 remaining = total - offset;
        uint256 end = offset + (limit < remaining ? limit : remaining);

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
    ///         against. address(0) makes the FollowsCreator requirement (and any eligibility depending on it) fail
    ///         closed until it's set.
    function setFollowerSystem(address _followerSystem) external onlyDirectAdmin {
        address oldValue = followerSystem;
        followerSystem = _followerSystem;

        emit FollowerSystemUpdated(oldValue, _followerSystem);
    }

    function withdrawAll(address payable _receiver) external onlyDirectAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        // Escrowed join fees belong to creators (withdrawJoinPayouts) — sweep only the surplus:
        // creation fees plus any stray coin.
        uint256 balance = address(this).balance - totalJoinPayouts;
        if (balance == 0) revert NothingToWithdraw();

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
