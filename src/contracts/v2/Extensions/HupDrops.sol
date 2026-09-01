// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ILSP7Minimal.sol";
import "./IHupDrops.sol";

/**
 * @title Hup Drops
 * @author Hup Labs
 * @notice The Hup NFT launchpad engine — one address per chain. Creators deploy real,
 *         creator-owned collection contracts (LSP7/LSP8 on LUKSO, ERC721/ERC1155 elsewhere)
 *         and sell the primary mint through phases, each with its own window, price, per-wallet
 *         limit, allocation, and gate: open to everyone, the drop's onchain allowlist, LSP26
 *         followers of the creator, members of a Hup community, or holders of an asset. A
 *         creator can append phases to a live drop; existing ones are never editable. Mint proceeds are pushed straight to the creator
 *         on every mint — the engine escrows nothing but its own fees.
 * @dev Collection creation code lives in per-standard deployer satellites (registered via
 *      `setDeployer`) so this engine stays under the EIP-170 size limit and a future token
 *      standard is one new satellite plus one admin transaction, never an engine redeploy. The
 *      engine is the sole mint authority on the collections it deploys; everything else about a
 *      collection (metadata, royalties, ownership) belongs to its creator from the first block.
 *      Uses IHupDrops for shared structs, events, errors, and view signatures, and integrates
 *      with Hup Core via IHup only to resolve burner session keys to primary wallets — so
 *      per-wallet limits count against the primary and cannot be reset by rotating burners.
 *      Supports rotatable ERC2771 trusted forwarders for meta-transactions, AccessControl for
 *      admin permissions, Pausable for emergency controls, and ReentrancyGuard for protected
 *      settlement. Every state change emits an event; offchain indexers derive full drop state
 *      from DropCreated / PhaseConfigured / PhasePausedSet / Minted / DropClosed /
 *      AllowlistUpdated / PayoutDestinationUpdated alone.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupDrops is IHupDrops, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeERC20 for IERC20;

  // --- STATE VARIABLES ---

  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
  uint256 public constant FEE_DENOMINATOR = 10_000;
  uint256 public constant ABSOLUTE_MAX_MINT_FEE_BPS = 1_000;
  uint256 public constant MAX_REFERRAL_BPS = 5_000;
  uint256 public constant MAX_PHASES = 8;

  /// @notice Longest a phase's label may be, in bytes. Counted in bytes rather than characters
  ///         because that is what storage costs: 31 bytes is one slot, and this allows two. A
  ///         non-Latin script spends 2-4 bytes per character, so the practical limit is shorter
  ///         for some creators than others — the cap is on cost, not on alphabet.
  uint256 public constant MAX_PHASE_NAME_BYTES = 64;
  uint256 public constant MAX_PER_TX = 100;

  /// @notice Hard cap on setAllowlistedBatch's array length, so a creator can't submit a batch
  ///         large enough to exceed the block gas limit and revert with nothing written.
  uint256 public constant MAX_BATCH_SIZE = 100;

  /// @notice The Hup Core contract instance (burner session resolution only). Admin-rotatable
  ///         so a Hup Core redeploy doesn't strand live drops behind a stale session source.
  IHup public hupContract;

  /// @notice The chain's LSP26 follower system, read by the Followers gate. address(0) on a
  ///         chain without one — creating a Followers-gated phase there reverts instead of
  ///         silently gating nobody.
  address public followerSystem;

  /// @notice The chain's HupCommunity registry, read by the Community gate. address(0) on a
  ///         chain without one — creating a Community-gated phase there reverts instead of
  ///         silently gating nobody. Admin-rotatable, like the follower system.
  address public communitySystem;

  /// @notice Total number of drops ever created; ids are 1..dropCount
  uint256 public dropCount;

  /// @notice Maps dropId to its drop
  mapping(uint256 => Drop) private _drops;

  /// @notice Maps dropId to its phase schedule, fixed at creation
  mapping(uint256 => Phase[]) private _phases;

  /// @notice Maps a standard id to its deployer satellite (address(0) = unavailable here)
  mapping(uint256 => address) public deployers;

  /// @notice Maps a deployed collection back to its drop id
  mapping(address => uint256) public dropIdOf;

  /// @notice dropId => phaseIndex => resolved primary wallet => items minted
  mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public mintedInPhaseBy;

  /// @notice dropId => wallet => passes the drop's Allowlist gate. Stored onchain like
  ///         HupCommunity's whitelist — a drop is a long-lived object, so its list is worth its
  ///         SSTOREs, unlike a poll's (HupPolls keeps the merkle design for exactly that reason).
  mapping(uint256 => mapping(address => bool)) public allowlist;

  /// @dev `allowlist` mirrored into an EnumerableSet purely so the contract itself can answer
  ///      "list the allowlist" (allowlistCount/allowlistOf) — no indexer required for
  ///      correctness. cidex still indexes AllowlistUpdated for a faster/richer read path.
  mapping(uint256 => EnumerableSet.AddressSet) private _allowlistSet;

  /// @notice dropId => where the creator's share of mint proceeds is sent. address(0) (the
  ///         default) means the creator. Pushed straight from mint() like HupCommunity's
  ///         join fees — the engine never holds it — so a destination that can't receive
  ///         native coin makes mints revert until the creator re-points it. Self-inflicted
  ///         and fixable in one tx, which is why no escrow/claim ledger is needed.
  ///         Only the creator's own address can move this — see `_requireDirectCreator`.
  mapping(uint256 => address) public payoutDestination;

  mapping(address => bool) public trustedForwarders;

  /// @notice Platform share of paid mints, in basis points (100 = 1%)
  uint256 public mintFeeBps = 0;

  /// @notice Flat native fee charged per item minted, on top of the phase price and paid by the
  ///         minter. Deliberately not a share of the price: a basis-point cut earns nothing on a
  ///         free drop, which is the format most of this launchpad's supply ships in. Charged on
  ///         every mint — free, native-priced, and token-priced alike — and always in the chain's
  ///         native coin, so it lands in the same balance `withdraw` already drains.
  uint256 public mintFee = 0;

  /// @notice Whether `mintFee` is actually charged. Separate from the amount so an admin can
  ///         switch the fee off without losing a configured figure, and back on without having to
  ///         re-derive it from the chain's coin price.
  bool public mintFeeEnabled = false;

  /// @notice Flat native fee charged by createDrop
  uint256 public creationFee = 0;

  // --- MODIFIERS ---

  modifier onlyDirectAdmin() {
    if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
    _;
  }

  // --- CONSTRUCTOR ---

  /**
   * @notice Initializes the drops engine.
   * @param _hupAddress Address of the deployed core Hup contract.
   * @param _trustedForwarder Address of the initial EIP-2771 trusted forwarder (or address(0) to skip).
   * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
   * @param _followerSystem The chain's LSP26 follower system (or address(0) when it has none).
   */
  constructor(address _hupAddress, address _trustedForwarder, address _admin, address _followerSystem) ERC2771Context(_trustedForwarder) {
    if (_hupAddress == address(0) || _admin == address(0)) revert InvalidAddress();

    hupContract = IHup(_hupAddress);
    followerSystem = _followerSystem;

    _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    _grantRole(ADMIN_ROLE, _admin);

    if (_trustedForwarder != address(0)) {
      trustedForwarders[_trustedForwarder] = true;
      emit TrustedForwarderUpdated(_trustedForwarder, true);
    }
  }

  // --- MUTATIVE LOGIC ---

  function createDrop(
    address _creator,
    uint256 _standardId,
    bytes calldata _collectionParams,
    uint256 _maxSupply,
    uint256 _referralBps,
    PhaseInput[] calldata _phaseInputs
  ) external payable whenNotPaused nonReentrant returns (uint256 dropId, address collection) {
    address deployer = deployers[_standardId];
    if (deployer == address(0)) revert InvalidStandard();
    if (_referralBps > MAX_REFERRAL_BPS) revert InvalidReferralBps();
    if (_phaseInputs.length == 0 || _phaseInputs.length > MAX_PHASES) revert InvalidPhases();
    if (msg.value != creationFee) revert InsufficientPayment(msg.value, creationFee);

    address creator = _resolveActor(_creator);

    dropId = ++dropCount;

    // The satellite news the collection with the creator as owner and this engine as the only
    // mint authority. Reverts bubble up, so a bad params blob can never half-create a drop.
    collection = IHupDropsDeployer(deployer).deploy(creator, _maxSupply, _collectionParams);
    if (collection == address(0)) revert InvalidAddress();

    _drops[dropId] = Drop({
      collection: collection,
      creator: creator,
      standardId: _standardId,
      maxSupply: _maxSupply,
      minted: 0,
      referralBps: _referralBps,
      createdAt: uint64(block.timestamp),
      closed: false
    });
    dropIdOf[collection] = dropId;

    emit DropCreated(dropId, creator, collection, _standardId, _maxSupply, _referralBps);

    for (uint256 i = 0; i < _phaseInputs.length; i++) {
      _appendPhase(dropId, _maxSupply, _phaseInputs[i]);
    }
  }

  function addPhase(uint256 _dropId, PhaseInput calldata _phase) external whenNotPaused returns (uint256 phaseIndex) {
    _requireDropCreator(_dropId);
    if (_phases[_dropId].length >= MAX_PHASES) revert InvalidPhases();

    return _appendPhase(_dropId, _drops[_dropId].maxSupply, _phase);
  }

  function addPhaseBatch(uint256 _dropId, PhaseInput[] calldata _phaseInputs) external whenNotPaused returns (uint256 firstPhaseIndex) {
    _requireDropCreator(_dropId);
    if (_phaseInputs.length == 0 || _phases[_dropId].length + _phaseInputs.length > MAX_PHASES) revert InvalidPhases();

    uint256 maxSupply = _drops[_dropId].maxSupply;
    firstPhaseIndex = _phases[_dropId].length;

    for (uint256 i = 0; i < _phaseInputs.length; i++) {
      _appendPhase(_dropId, maxSupply, _phaseInputs[i]);
    }
  }

  function mint(
    address _minter,
    uint256 _dropId,
    uint256 _phaseIndex,
    uint256 _quantity,
    address _referral
  ) external payable whenNotPaused nonReentrant {
    Drop storage drop = _drops[_dropId];
    if (drop.collection == address(0)) revert DropNotFound();
    if (drop.closed) revert DropNotActive();
    if (_phaseIndex >= _phases[_dropId].length) revert PhaseNotFound();
    if (_quantity == 0 || _quantity > MAX_PER_TX) revert InvalidAmount();

    Phase storage phase = _phases[_dropId][_phaseIndex];
    if (phase.paused) revert PhaseNotActive();
    if (block.timestamp < phase.startTime || (phase.endTime != 0 && block.timestamp >= phase.endTime)) revert PhaseNotActive();

    address minter = _resolveActor(_minter);
    address creator = drop.creator;

    if (_referral != address(0)) {
      // A referral is only meaningful when the drop pays one, and never to the parties already
      // in the trade.
      if (drop.referralBps == 0 || _referral == minter || _referral == creator) revert InvalidReferral();
    }

    if (drop.maxSupply != 0 && drop.minted + _quantity > drop.maxSupply) revert SupplyExceeded(_quantity, drop.maxSupply - drop.minted);
    if (phase.allocation != 0 && phase.minted + _quantity > phase.allocation) revert AllocationExceeded(_quantity, phase.allocation - phase.minted);

    if (phase.perWallet != 0) {
      uint256 already = mintedInPhaseBy[_dropId][_phaseIndex][minter];
      if (already + _quantity > phase.perWallet) revert WalletLimitReached(phase.perWallet);
    }

    _checkGate(_dropId, phase, creator, minter);

    uint256 totalPaid = phase.price * _quantity;
    // The flat fee rides on top of the price rather than coming out of it, so the creator's take
    // is unchanged by it and a "free" phase stays free from the creator's side. Always native,
    // even on a token phase — pricing a platform fee in whatever ERC20 the creator picked would
    // leave the engine holding dust in arbitrary tokens.
    uint256 flatFee = mintFeeEnabled ? mintFee * _quantity : 0;
    // Native phases are paid with the transaction; token phases are pulled from the minter in
    // settlement, so the only value a token phase may carry is the flat fee — anything else
    // would strand in the engine.
    if (phase.token == address(0)) {
      uint256 required = totalPaid + flatFee;
      if (msg.value != required) revert InsufficientPayment(msg.value, required);
    } else if (msg.value != flatFee) {
      revert InsufficientPayment(msg.value, flatFee);
    }

    // Effects before interactions: every counter moves before any native transfer or the
    // collection's LSP1/receiver hooks can re-enter.
    uint256 firstTokenId = drop.minted + 1;
    drop.minted += _quantity;
    phase.minted += _quantity;
    mintedInPhaseBy[_dropId][_phaseIndex][minter] += _quantity;

    (uint256 priceFee, uint256 referralAmount) = _settleMint(_dropId, phase, creator, minter, _referral, drop.referralBps, totalPaid);

    // The flat fee needs no settlement of its own: it arrived as value and simply stays here,
    // waiting for withdraw, which is why it also works on a free mint that skips settlement
    // entirely. Reported folded into feeAmount so the event still carries the platform's total
    // take on the mint and its signature is unchanged for indexers.
    uint256 feeAmount = priceFee + flatFee;

    // Deliver last, once payment has fully settled.
    IHupDropCollection(drop.collection).engineMint(minter, firstTokenId, _quantity);

    emit Minted(_dropId, minter, _referral, _phaseIndex, _quantity, firstTokenId, totalPaid, feeAmount, referralAmount, drop.minted);
  }

  function setPhasePaused(uint256 _dropId, uint256 _phaseIndex, bool _paused) external whenNotPaused {
    _requireDropCreator(_dropId);
    if (_phaseIndex >= _phases[_dropId].length) revert PhaseNotFound();

    _phases[_dropId][_phaseIndex].paused = _paused;

    emit PhasePausedSet(_dropId, _phaseIndex, _paused);
  }

  function setAllowlisted(uint256 _dropId, address _wallet, bool _allowed) external whenNotPaused {
    _requireDropCreator(_dropId);

    _setAllowlistedOne(_dropId, _wallet, _allowed);
  }

  function setAllowlistedBatch(uint256 _dropId, address[] calldata _wallets, bool _allowed) external whenNotPaused {
    if (_wallets.length > MAX_BATCH_SIZE) revert BatchTooLarge();

    _requireDropCreator(_dropId);

    for (uint256 i = 0; i < _wallets.length; i++) {
      _setAllowlistedOne(_dropId, _wallets[i], _allowed);
    }
  }

  function setPayoutDestination(uint256 _dropId, address _destination) external whenNotPaused {
    _requireDirectCreator(_dropId);

    payoutDestination[_dropId] = _destination;

    emit PayoutDestinationUpdated(_dropId, _destination);
  }

  function closeDrop(uint256 _dropId) external whenNotPaused {
    Drop storage drop = _drops[_dropId];
    if (drop.collection == address(0)) revert DropNotFound();
    if (drop.closed) revert DropNotActive();

    // Creator first (accepting their active burner session), then moderation. The admin check
    // is on msg.sender deliberately, matching the direct-admin convention everywhere else.
    bool byAdmin;
    if (hasRole(ADMIN_ROLE, msg.sender)) {
      byAdmin = msg.sender != drop.creator;
    } else {
      // _resolveActor reverts unless the caller is the creator or their active burner session.
      if (_resolveActor(drop.creator) != drop.creator) revert Unauthorized();
    }

    drop.closed = true;

    emit DropClosed(_dropId, byAdmin);
  }

  // --- VIEW FUNCTIONS ---

  function version() external pure override returns (string memory) {
    return "1.0.0";
  }

  function getDrop(uint256 _dropId) external view returns (Drop memory) {
    return _drops[_dropId];
  }

  function phasesOf(uint256 _dropId) external view returns (Phase[] memory) {
    return _phases[_dropId];
  }

  function activePhaseOf(uint256 _dropId) public view returns (bool found, uint256 index) {
    Phase[] storage phases = _phases[_dropId];

    for (uint256 i = 0; i < phases.length; i++) {
      if (phases[i].paused) continue;

      if (block.timestamp >= phases[i].startTime && (phases[i].endTime == 0 || block.timestamp < phases[i].endTime)) {
        return (true, i);
      }
    }

    return (false, 0);
  }

  function isMintable(uint256 _dropId, uint256 _phaseIndex, address _wallet, uint256 _quantity) external view returns (bool) {
    Drop storage drop = _drops[_dropId];
    if (drop.collection == address(0) || drop.closed || paused()) return false;
    if (_phaseIndex >= _phases[_dropId].length) return false;
    if (_quantity == 0 || _quantity > MAX_PER_TX) return false;

    Phase storage phase = _phases[_dropId][_phaseIndex];
    if (phase.paused) return false;
    if (block.timestamp < phase.startTime || (phase.endTime != 0 && block.timestamp >= phase.endTime)) return false;
    if (drop.maxSupply != 0 && drop.minted + _quantity > drop.maxSupply) return false;
    if (phase.allocation != 0 && phase.minted + _quantity > phase.allocation) return false;
    if (phase.perWallet != 0 && mintedInPhaseBy[_dropId][_phaseIndex][_wallet] + _quantity > phase.perWallet) return false;

    // Every check mint itself makes — what this returns, mint accepts.
    if (phase.gate == GateType.Allowlist) {
      return allowlist[_dropId][_wallet];
    }
    if (phase.gate == GateType.Followers) {
      return ILSP26Minimal(followerSystem).isFollowing(_wallet, drop.creator);
    }
    if (phase.gate == GateType.Community) {
      return _passesCommunityGate(phase.gateData, _wallet);
    }
    if (phase.gate == GateType.AssetHolders) {
      return IGateBalance(phase.gateAsset).balanceOf(_wallet) >= phase.gateMin;
    }
    if (phase.gate == GateType.AssetHolders1155) {
      return IGateBalance1155(phase.gateAsset).balanceOf(_wallet, uint256(phase.gateData)) >= phase.gateMin;
    }

    return true;
  }

  function allowlistCount(uint256 _dropId) external view returns (uint256) {
    _requireCreatorView(_dropId);

    return _allowlistSet[_dropId].length();
  }

  function allowlistOf(uint256 _dropId, uint256 _offset, uint256 _limit) external view returns (address[] memory) {
    _requireCreatorView(_dropId);

    return _page(_allowlistSet[_dropId], _offset, _limit);
  }

  // --- ADMIN CONFIGURATION ---

  function pause() external onlyDirectAdmin {
    _pause();
  }

  function unpause() external onlyDirectAdmin {
    _unpause();
  }

  function setDeployer(uint256 _standardId, address _deployer) external onlyDirectAdmin {
    // address(0) is a valid value: it retires a standard on this chain without touching
    // existing drops, which keep minting through their already-deployed collections.
    deployers[_standardId] = _deployer;

    emit DeployerUpdated(_standardId, _deployer);
  }

  function setMintFeeBps(uint256 _mintFeeBps) external onlyDirectAdmin {
    if (_mintFeeBps > ABSOLUTE_MAX_MINT_FEE_BPS) revert InvalidFeeBps();

    uint256 oldValue = mintFeeBps;
    mintFeeBps = _mintFeeBps;

    emit MintFeeUpdated(oldValue, _mintFeeBps);
  }

  /**
   * @notice Sets the flat per-item native mint fee. Uncapped, like `creationFee`: a sane ceiling
   *         is a coin-price question, not a bytecode one, and it differs on every chain the
   *         engine deploys to.
   * @dev Setting it does not switch it on — `mintFeeEnabled` does, so the amount can be staged
   *      ahead of the flip.
   */
  function setMintFee(uint256 _mintFee) external onlyDirectAdmin {
    uint256 oldValue = mintFee;
    mintFee = _mintFee;

    emit FlatMintFeeUpdated(oldValue, _mintFee);
  }

  function setMintFeeEnabled(bool _enabled) external onlyDirectAdmin {
    mintFeeEnabled = _enabled;

    emit MintFeeEnabledUpdated(_enabled);
  }

  function setCreationFee(uint256 _creationFee) external onlyDirectAdmin {
    uint256 oldValue = creationFee;
    creationFee = _creationFee;

    emit CreationFeeUpdated(oldValue, _creationFee);
  }

  function setFollowerSystem(address _followerSystem) external onlyDirectAdmin {
    address oldValue = followerSystem;
    followerSystem = _followerSystem;

    emit FollowerSystemUpdated(oldValue, _followerSystem);
  }

  function setCommunitySystem(address _communitySystem) external onlyDirectAdmin {
    address oldValue = communitySystem;
    communitySystem = _communitySystem;

    emit CommunitySystemUpdated(oldValue, _communitySystem);
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

  function withdrawAll(address payable _receiver) external onlyDirectAdmin nonReentrant {
    if (_receiver == address(0)) revert InvalidAddress();

    uint256 balance = address(this).balance;
    if (balance == 0) revert TransferFailed();

    (bool success, ) = _receiver.call{value: balance}("");
    if (!success) revert TransferFailed();

    emit Withdrawal(_receiver, balance);
  }

  function withdrawToken(address _token, address _receiver, bool _isLsp7) external onlyDirectAdmin nonReentrant {
    if (_token == address(0) || _receiver == address(0)) revert InvalidAddress();

    uint256 balance = IERC20(_token).balanceOf(address(this));
    if (balance == 0) revert TransferFailed();

    // balanceOf is selector-compatible across ERC20 and LSP7; the transfers are not.
    if (_isLsp7) {
      ILSP7Minimal(_token).transfer(address(this), _receiver, balance, true, "");
    } else {
      IERC20(_token).safeTransfer(_receiver, balance);
    }

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
   * @dev The shared gate in front of every creator-only lever (phase pause, allowlist edits):
   *      the drop must exist and still be open, and the caller must be its creator or their
   *      active burner session. Admins deliberately have no say here — moderation's levers are
   *      closeDrop and the engine-wide pause, while a sale's own controls belong to whoever is
   *      running it.
   */
  function _requireDropCreator(uint256 _dropId) internal view {
    Drop storage drop = _drops[_dropId];
    if (drop.collection == address(0)) revert DropNotFound();
    if (drop.closed) revert DropNotActive();

    if (_resolveActor(drop.creator) != drop.creator) revert Unauthorized();
  }

  /**
   * @dev The payout lever's gate, deliberately stricter than _requireDropCreator: the caller must
   *      be the creator's own address — not a burner session, not a forwarder relay. Both of those
   *      resolve identity through admin-rotatable references (`hupContract` for sessions,
   *      `trustedForwarders` for relays), so honouring them here would mean a compromised admin
   *      key could point another creator's revenue at itself by swapping in a session source or a
   *      forwarder that vouches for anyone. Redirecting money is worth one direct signature — the
   *      same reasoning that keeps `onlyDirectAdmin` on `msg.sender`.
   */
  function _requireDirectCreator(uint256 _dropId) private view {
    Drop storage drop = _drops[_dropId];
    if (drop.collection == address(0)) revert DropNotFound();
    if (drop.closed) revert DropNotActive();

    if (msg.sender != drop.creator) revert Unauthorized();
  }

  /**
   * @dev The listing views' gate: creator (or their burner session) only, like HupCommunity's
   *      whitelist views — but without the closed check, since the list outlives the sale.
   *      Everyone else answers "is X on it" through the public `allowlist` getter.
   */
  function _requireCreatorView(uint256 _dropId) private view {
    Drop storage drop = _drops[_dropId];
    if (drop.collection == address(0)) revert DropNotFound();

    if (_resolveActor(drop.creator) != drop.creator) revert Unauthorized();
  }

  /// @dev HupCommunity's pagination routine: clamps against the remaining tail rather than
  ///      truncating offset + limit afterwards — the sum overflows to a panic revert on a
  ///      caller passing an unbounded `limit`.
  function _page(EnumerableSet.AddressSet storage _set, uint256 _offset, uint256 _limit) private view returns (address[] memory page) {
    uint256 total = _set.length();
    if (_offset >= total || _limit == 0) return new address[](0);

    uint256 remaining = total - _offset;
    uint256 end = _offset + (_limit < remaining ? _limit : remaining);

    page = new address[](end - _offset);
    for (uint256 i = _offset; i < end; i++) {
      page[i - _offset] = _set.at(i);
    }
  }

  /**
   * @dev Validates one phase and pushes it onto a drop's schedule, emitting PhaseConfigured
   *      with the index it landed at. Shared by createDrop and addPhase so an appended phase
   *      can never be held to looser rules than one declared at creation, and so indexers see
   *      an identical event either way.
   */
  function _appendPhase(uint256 _dropId, uint256 _maxSupply, PhaseInput calldata _phase) private returns (uint256 phaseIndex) {
    if (bytes(_phase.name).length > MAX_PHASE_NAME_BYTES) revert PhaseNameTooLong();
    if (_phase.endTime != 0 && _phase.endTime <= _phase.startTime) revert InvalidPhases();
    if (_maxSupply != 0 && _phase.allocation > _maxSupply) revert InvalidPhases();
    // A free phase has nothing to charge in, so naming a token there is a mistake worth
    // catching rather than storing — it would read as a priced phase to every client.
    if (_phase.price == 0 && _phase.token != address(0)) revert InvalidPaymentToken();
    _validateGate(_phase.gate, _phase.gateAsset, _phase.gateData, _phase.gateMin);

    phaseIndex = _phases[_dropId].length;

    _phases[_dropId].push(Phase({
      name: _phase.name,
      startTime: _phase.startTime,
      endTime: _phase.endTime,
      paused: _phase.paused,
      token: _phase.token,
      isLsp7: _phase.isLsp7,
      price: _phase.price,
      perWallet: _phase.perWallet,
      allocation: _phase.allocation,
      gate: _phase.gate,
      gateAsset: _phase.gateAsset,
      gateData: _phase.gateData,
      gateMin: _phase.gateMin,
      minted: 0
    }));

    emit PhaseConfigured(
      _dropId,
      phaseIndex,
      _phase.startTime,
      _phase.endTime,
      _phase.price,
      _phase.perWallet,
      _phase.allocation,
      _phase.gate,
      _phase.gateAsset,
      _phase.gateData,
      _phase.gateMin,
      _phase.paused,
      _phase.token,
      _phase.isLsp7,
      _phase.name
    );
  }

  /**
   * @dev One allowlist entry flipped, mapping and enumerable mirror together — HupCommunity's
   *      _setWhitelistedOne, drop-scoped.
   */
  function _setAllowlistedOne(uint256 _dropId, address _wallet, bool _allowed) private {
    allowlist[_dropId][_wallet] = _allowed;

    if (_allowed) {
      _allowlistSet[_dropId].add(_wallet);
    } else {
      _allowlistSet[_dropId].remove(_wallet);
    }

    emit AllowlistUpdated(_dropId, _wallet, _allowed);
  }

  /**
   * @dev Rejects gate configurations that could never pass or would silently gate nobody.
   *      Allowlist needs none — its list lives in `allowlist` and may be filled before or
   *      after the phase opens.
   */
  function _validateGate(GateType _gate, address _gateAsset, bytes32 _gateData, uint256 _gateMin) internal view {
    if (_gate == GateType.Open || _gate == GateType.Allowlist) return;

    if (_gate == GateType.Followers) {
      if (followerSystem == address(0)) revert InvalidGateConfig();
    } else if (_gate == GateType.Community) {
      // Community id 0 is never a real community, so it would gate everyone out silently
      if (communitySystem == address(0) || _gateData == bytes32(0)) revert InvalidGateConfig();
    } else {
      // AssetHolders / AssetHolders1155
      if (_gateAsset == address(0) || _gateMin == 0) revert InvalidGateConfig();
    }
  }

  /**
   * @dev Membership of the community `_gateData` names. A banned wallet is excluded even where
   *      the registry still records it as a member — a ban is the community saying no, and a
   *      gate that ignored it would hand banned wallets the mint anyway.
   */
  function _passesCommunityGate(bytes32 _gateData, address _minter) internal view returns (bool) {
    (bool isMember, , , bool isBanned, ) = IHupCommunityMinimal(communitySystem).registry(uint256(_gateData), _minter);

    return isMember && !isBanned;
  }

  /**
   * @dev Reverts with GateNotPassed unless `_minter` passes the phase's gate.
   */
  function _checkGate(uint256 _dropId, Phase storage _phase, address _creator, address _minter) internal view {
    GateType gate = _phase.gate;

    if (gate == GateType.Open) return;

    if (gate == GateType.Allowlist) {
      if (!allowlist[_dropId][_minter]) revert GateNotPassed();
    } else if (gate == GateType.Followers) {
      if (!ILSP26Minimal(followerSystem).isFollowing(_minter, _creator)) revert GateNotPassed();
    } else if (gate == GateType.Community) {
      if (!_passesCommunityGate(_phase.gateData, _minter)) revert GateNotPassed();
    } else if (gate == GateType.AssetHolders) {
      if (IGateBalance(_phase.gateAsset).balanceOf(_minter) < _phase.gateMin) revert GateNotPassed();
    } else {
      if (IGateBalance1155(_phase.gateAsset).balanceOf(_minter, uint256(_phase.gateData)) < _phase.gateMin) revert GateNotPassed();
    }
  }

  /**
   * @dev Splits a paid mint: the platform fee stays in the contract, the referral share goes to
   *      the referrer, and the remainder is pushed straight to the drop's payout destination —
   *      the creator unless they re-pointed it. Direct push, one address, resolved now: rules
   *      richer than "one wallet" live in the destination contract, not here. Free mints skip
   *      settlement entirely.
   */
  function _settleMint(
    uint256 _dropId,
    Phase storage _phase,
    address _creator,
    address _minter,
    address _referral,
    uint256 _referralBps,
    uint256 _totalPaid
  ) internal returns (uint256 feeAmount, uint256 referralAmount) {
    if (_totalPaid == 0) return (0, 0);

    feeAmount = (_totalPaid * mintFeeBps) / FEE_DENOMINATOR;
    referralAmount = _referral == address(0) ? 0 : (_totalPaid * _referralBps) / FEE_DENOMINATOR;

    address recipient = payoutDestination[_dropId];
    if (recipient == address(0)) recipient = _creator;

    uint256 creatorAmount = _totalPaid - feeAmount - referralAmount;

    if (_phase.token == address(0)) {
      _sendNative(recipient, creatorAmount);
      if (referralAmount > 0) _sendNative(_referral, referralAmount);
      return (feeAmount, referralAmount);
    }

    // Token phases move value straight from the minter to each party, so the engine never
    // custodies the creator's or referrer's share — only its own fee lands here, waiting for
    // withdrawToken. The minter must have approved (ERC20) or authorized this engine as an
    // operator (LSP7) for the full total beforehand.
    _pullToken(_phase, _minter, recipient, creatorAmount);
    if (referralAmount > 0) _pullToken(_phase, _minter, _referral, referralAmount);
    if (feeAmount > 0) _pullToken(_phase, _minter, address(this), feeAmount);
  }

  /**
   * @dev One token transfer out of the minter's balance. LSP7 has no `transferFrom` and its
   *      `transfer` is not selector-compatible with ERC20's, so the two standards need
   *      different calls — the same split HupCommunity's paid joins make. `force` is true so a
   *      plain EOA or a UP without an LSP1 delegate can receive.
   */
  function _pullToken(Phase storage _phase, address _from, address _to, uint256 _amount) private {
    if (_phase.isLsp7) {
      ILSP7Minimal(_phase.token).transfer(_from, _to, _amount, true, "");
    } else {
      IERC20(_phase.token).safeTransferFrom(_from, _to, _amount);
    }
  }

  /**
   * @dev Sends native value, reverting on failure.
   */
  function _sendNative(address _to, uint256 _amount) internal {
    if (_amount == 0) return;

    (bool success, ) = _to.call{value: _amount}("");
    if (!success) revert TransferFailed();
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
  function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupDrops) returns (bool) {
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
