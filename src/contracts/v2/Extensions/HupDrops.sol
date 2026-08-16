// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./IHupDrops.sol";

/**
 * @title Hup Drops
 * @author Hup Labs
 * @notice The Hup NFT launchpad engine — one address per chain. Creators deploy real,
 *         creator-owned collection contracts (LSP7/LSP8 on LUKSO, ERC721/ERC1155 elsewhere)
 *         and sell the primary mint through phases, each with its own window, price, per-wallet
 *         limit, allocation, and gate: open to everyone, merkle allowlist, LSP26 followers of
 *         the creator, or holders of an asset. Mint proceeds are pushed straight to the creator
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
 *      from DropCreated / PhaseConfigured / PhasePausedSet / Minted / DropClosed alone.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupDrops is IHupDrops, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
  // --- STATE VARIABLES ---

  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
  uint256 public constant FEE_DENOMINATOR = 10_000;
  uint256 public constant ABSOLUTE_MAX_MINT_FEE_BPS = 1_000;
  uint256 public constant MAX_REFERRAL_BPS = 5_000;
  uint256 public constant MAX_PHASES = 8;
  uint256 public constant MAX_PER_TX = 100;

  /// @notice The Hup Core contract instance (burner session resolution only). Admin-rotatable
  ///         so a Hup Core redeploy doesn't strand live drops behind a stale session source.
  IHup public hupContract;

  /// @notice The chain's LSP26 follower system, read by the Followers gate. address(0) on a
  ///         chain without one — creating a Followers-gated phase there reverts instead of
  ///         silently gating nobody.
  address public followerSystem;

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

  mapping(address => bool) public trustedForwarders;

  /// @notice Platform share of paid mints, in basis points (100 = 1%)
  uint256 public mintFeeBps = 0;

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
      PhaseInput calldata p = _phaseInputs[i];

      if (p.endTime != 0 && p.endTime <= p.startTime) revert InvalidPhases();
      if (_maxSupply != 0 && p.allocation > _maxSupply) revert InvalidPhases();
      _validateGate(p.gate, p.gateAsset, p.gateData, p.gateMin);

      _phases[dropId].push(Phase({
        startTime: p.startTime,
        endTime: p.endTime,
        paused: p.paused,
        price: p.price,
        perWallet: p.perWallet,
        allocation: p.allocation,
        gate: p.gate,
        gateAsset: p.gateAsset,
        gateData: p.gateData,
        gateMin: p.gateMin,
        minted: 0
      }));

      emit PhaseConfigured(dropId, i, p.startTime, p.endTime, p.price, p.perWallet, p.allocation, p.gate, p.gateAsset, p.gateData, p.gateMin, p.paused);
    }
  }

  function mint(
    address _minter,
    uint256 _dropId,
    uint256 _phaseIndex,
    uint256 _quantity,
    address _referral,
    bytes32[] calldata _proof
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

    _checkGate(phase, creator, minter, _proof);

    uint256 totalPaid = phase.price * _quantity;
    if (msg.value != totalPaid) revert InsufficientPayment(msg.value, totalPaid);

    // Effects before interactions: every counter moves before any native transfer or the
    // collection's LSP1/receiver hooks can re-enter.
    uint256 firstTokenId = drop.minted + 1;
    drop.minted += _quantity;
    phase.minted += _quantity;
    mintedInPhaseBy[_dropId][_phaseIndex][minter] += _quantity;

    (uint256 feeAmount, uint256 referralAmount) = _settleMint(creator, _referral, drop.referralBps, totalPaid);

    // Deliver last, once payment has fully settled.
    IHupDropCollection(drop.collection).engineMint(minter, firstTokenId, _quantity);

    emit Minted(_dropId, minter, _referral, _phaseIndex, _quantity, firstTokenId, totalPaid, feeAmount, referralAmount, drop.minted);
  }

  function setPhasePaused(uint256 _dropId, uint256 _phaseIndex, bool _paused) external whenNotPaused {
    Drop storage drop = _drops[_dropId];
    if (drop.collection == address(0)) revert DropNotFound();
    if (drop.closed) revert DropNotActive();
    if (_phaseIndex >= _phases[_dropId].length) revert PhaseNotFound();

    // Creator only, accepting their active burner session. Admins deliberately have no say
    // here: moderation's levers are closeDrop and the engine-wide pause, while a phase's
    // on/off switch belongs to whoever is running the sale.
    if (_resolveActor(drop.creator) != drop.creator) revert Unauthorized();

    _phases[_dropId][_phaseIndex].paused = _paused;

    emit PhasePausedSet(_dropId, _phaseIndex, _paused);
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

    // Everything except an Allowlist proof, which only the client holds.
    if (phase.gate == GateType.Followers) {
      return ILSP26Minimal(followerSystem).isFollowing(_wallet, drop.creator);
    }
    if (phase.gate == GateType.AssetHolders) {
      return IGateBalance(phase.gateAsset).balanceOf(_wallet) >= phase.gateMin;
    }
    if (phase.gate == GateType.AssetHolders1155) {
      return IGateBalance1155(phase.gateAsset).balanceOf(_wallet, uint256(phase.gateData)) >= phase.gateMin;
    }

    return true;
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
   * @dev Rejects gate configurations that could never pass or would silently gate nobody.
   */
  function _validateGate(GateType _gate, address _gateAsset, bytes32 _gateData, uint256 _gateMin) internal view {
    if (_gate == GateType.Open) return;

    if (_gate == GateType.Allowlist) {
      if (_gateData == bytes32(0)) revert InvalidGateConfig();
    } else if (_gate == GateType.Followers) {
      if (followerSystem == address(0)) revert InvalidGateConfig();
    } else {
      // AssetHolders / AssetHolders1155
      if (_gateAsset == address(0) || _gateMin == 0) revert InvalidGateConfig();
    }
  }

  /**
   * @dev Reverts with GateNotPassed unless `_minter` passes the phase's gate. Allowlist leaves
   *      follow the OpenZeppelin StandardMerkleTree convention:
   *      keccak256(bytes.concat(keccak256(abi.encode(address)))).
   */
  function _checkGate(Phase storage _phase, address _creator, address _minter, bytes32[] calldata _proof) internal view {
    GateType gate = _phase.gate;

    if (gate == GateType.Open) return;

    if (gate == GateType.Allowlist) {
      bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(_minter))));
      if (!MerkleProof.verify(_proof, _phase.gateData, leaf)) revert GateNotPassed();
    } else if (gate == GateType.Followers) {
      if (!ILSP26Minimal(followerSystem).isFollowing(_minter, _creator)) revert GateNotPassed();
    } else if (gate == GateType.AssetHolders) {
      if (IGateBalance(_phase.gateAsset).balanceOf(_minter) < _phase.gateMin) revert GateNotPassed();
    } else {
      if (IGateBalance1155(_phase.gateAsset).balanceOf(_minter, uint256(_phase.gateData)) < _phase.gateMin) revert GateNotPassed();
    }
  }

  /**
   * @dev Splits a paid mint: the platform fee stays in the contract, the referral share goes to
   *      the referrer, and the remainder is pushed straight to the creator. Free mints skip
   *      settlement entirely.
   */
  function _settleMint(address _creator, address _referral, uint256 _referralBps, uint256 _totalPaid) internal returns (uint256 feeAmount, uint256 referralAmount) {
    if (_totalPaid == 0) return (0, 0);

    feeAmount = (_totalPaid * mintFeeBps) / FEE_DENOMINATOR;
    referralAmount = _referral == address(0) ? 0 : (_totalPaid * _referralBps) / FEE_DENOMINATOR;

    _sendNative(_creator, _totalPaid - feeAmount - referralAmount);
    if (referralAmount > 0) _sendNative(_referral, referralAmount);
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
