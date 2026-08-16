// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupDrops
 * @author Hup Labs
 * @notice Shared interface for the Hup Drops protocol — the NFT launchpad. A drop deploys a real,
 *         creator-owned collection contract (LSP7/LSP8 on LUKSO, ERC721/ERC1155 elsewhere) and
 *         sells its primary mint through phases: each phase carries its own window, price,
 *         per-wallet limit, allocation, and gate (open, merkle allowlist, LSP26 followers, or
 *         asset holders).
 * @dev Completes the Hup NFT stack: HupDrops is primary issuance, HupTrade (one-of-ones) and
 *      HupEditions (balance-based) are the secondary markets — a drop-minted collection is
 *      immediately listable on the matching one. Defines the public events, custom errors,
 *      structs, and interfaces used by clients and offchain indexers, plus the two plumbing
 *      interfaces (deployer satellites, collection mint hook) the engine composes with.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
interface IHupDrops {
  // --- SHARED TYPES ---

  /// @notice Who may mint during a phase.
  /// @dev `Allowlist` verifies an OpenZeppelin StandardMerkleTree proof against `gateData`.
  ///      `Followers` asks the chain's LSP26 follower system whether the minter follows the
  ///      drop's creator. `AssetHolders` checks `balanceOf(address)` on `gateAsset` (covers
  ///      ERC20, ERC721, LSP7, and LSP8); `AssetHolders1155` checks
  ///      `balanceOf(address, uint256(gateData))` for id-scoped ERC1155 balances.
  enum GateType {
    Open,
    Allowlist,
    Followers,
    AssetHolders,
    AssetHolders1155
  }

  /// @notice One mint phase. A phase's terms are fixed at creation — Universal Page's "you can
  ///         not change the launch dates after deployment" rule — so a buyer's terms can never
  ///         shift under them. `paused` is the single exception: the creator's on/off switch
  ///         over their own sale, replayable by indexers from `PhasePausedSet`.
  /// @dev `endTime` 0 means open-ended. `perWallet` 0 means unlimited. `allocation` 0 means the
  ///      phase draws freely from the drop's total supply. `gateData` is overloaded per gate:
  ///      merkle root for `Allowlist`, ERC1155 token id for `AssetHolders1155`, zero otherwise.
  ///      A `paused` phase never mints, whatever its window says.
  struct Phase {
    uint64 startTime;
    uint64 endTime;
    bool paused;
    uint256 price;
    uint256 perWallet;
    uint256 allocation;
    GateType gate;
    address gateAsset;
    bytes32 gateData;
    uint256 gateMin;
    uint256 minted;
  }

  /// @notice Same shape as `Phase` minus the counter — what `createDrop` accepts. Creating a
  ///         phase with `paused` true is how a drop waits for the creator to press start
  ///         rather than for a clock.
  struct PhaseInput {
    uint64 startTime;
    uint64 endTime;
    bool paused;
    uint256 price;
    uint256 perWallet;
    uint256 allocation;
    GateType gate;
    address gateAsset;
    bytes32 gateData;
    uint256 gateMin;
  }

  /// @notice A drop: one collection, one creator, one phase schedule.
  /// @dev `maxSupply` 0 means an open edition. `minted` is the running total across all phases;
  ///      token ids are 1-based, so token `n` of a numbered collection is the `n`-th mint.
  ///      `closed` is final — a closed drop never mints again, though the collection contract
  ///      lives on under its creator's ownership.
  struct Drop {
    address collection;
    address creator;
    uint256 standardId;
    uint256 maxSupply;
    uint256 minted;
    uint256 referralBps;
    uint64 createdAt;
    bool closed;
  }

  // --- SHARED EVENTS ---

  /// @notice Emitted once per drop. Together with PhaseConfigured, PhasePausedSet, Minted, and
  ///         DropClosed this is the single source of truth for offchain indexers — full drop
  ///         state is derivable from these five events alone.
  event DropCreated(uint256 indexed dropId, address indexed creator, address indexed collection, uint256 standardId, uint256 maxSupply, uint256 referralBps);

  /// @notice Emitted once per phase at creation, in index order.
  event PhaseConfigured(uint256 indexed dropId, uint256 indexed phaseIndex, uint64 startTime, uint64 endTime, uint256 price, uint256 perWallet, uint256 allocation, GateType gate, address gateAsset, bytes32 gateData, uint256 gateMin, bool paused);

  /// @notice Emitted whenever a creator pauses or resumes one of their phases — including the
  ///         first start of a phase created paused.
  event PhasePausedSet(uint256 indexed dropId, uint256 indexed phaseIndex, bool paused);

  /// @notice Emitted for every mint. `firstTokenId` starts the contiguous id range this mint
  ///         produced (`quantity` ids for numbered standards; edition standards mint balance
  ///         only and clients ignore the range). `dropMinted` is the post-mint drop total, so a
  ///         progress bar needs no extra read.
  event Minted(uint256 indexed dropId, address indexed minter, address indexed referral, uint256 phaseIndex, uint256 quantity, uint256 firstTokenId, uint256 totalPaid, uint256 feeAmount, uint256 referralAmount, uint256 dropMinted);

  /// @notice Emitted when a drop is closed for good, by its creator or by moderation.
  event DropClosed(uint256 indexed dropId, bool byAdmin);

  /// @notice Emitted when a standard's deployer satellite is registered or replaced. Registering
  ///         a new standard id is how a future token standard joins without redeploying the
  ///         engine.
  event DeployerUpdated(uint256 indexed standardId, address deployer);

  /// @notice Emitted when the platform's share of mint proceeds (basis points) is updated.
  event MintFeeUpdated(uint256 oldValue, uint256 newValue);

  /// @notice Emitted when the flat native fee charged by createDrop is updated.
  event CreationFeeUpdated(uint256 oldValue, uint256 newValue);

  /// @notice Emitted when the LSP26 follower system reference is rotated.
  event FollowerSystemUpdated(address oldValue, address newValue);

  /// @notice Emitted when a trusted forwarder's status is updated.
  event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

  /// @notice Emitted when the Hup Core contract reference (burner session source) is rotated.
  event HupContractUpdated(address oldValue, address newValue);

  /// @notice Emitted when accumulated native fees are withdrawn by an admin.
  event Withdrawal(address indexed recipient, uint256 amount);

  /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
  event UnattributedDeposit(address indexed from, uint256 amount);

  // --- SHARED ERRORS ---

  error InvalidAddress();
  error InvalidAmount();
  error InvalidFeeBps();
  error InvalidReferralBps();
  /// @notice No deployer satellite is registered for this standard id on this chain.
  error InvalidStandard();
  /// @notice The phase list is empty, longer than MAX_PHASES, or a phase's window is inverted.
  error InvalidPhases();
  /// @notice A gate is missing its required configuration (allowlist without a root, follower
  ///         gate on a chain with no follower system, asset gate without asset or minimum).
  error InvalidGateConfig();
  error DropNotFound();
  /// @notice The drop is closed, or the engine is paused for moderation.
  error DropNotActive();
  error PhaseNotFound();
  /// @notice The phase's time window is not currently open, or its creator has paused it.
  error PhaseNotActive();
  /// @notice The minter does not pass the phase's gate (bad proof, not a follower, or balance
  ///         below the gate minimum).
  error GateNotPassed();
  /// @notice This wallet has reached the phase's per-wallet limit.
  error WalletLimitReached(uint256 limit);
  /// @notice The requested quantity exceeds the phase's remaining allocation.
  error AllocationExceeded(uint256 requested, uint256 remaining);
  /// @notice The requested quantity exceeds the drop's remaining supply.
  error SupplyExceeded(uint256 requested, uint256 remaining);
  error InsufficientPayment(uint256 provided, uint256 required);
  /// @notice The referrer must be neither the minter nor the creator, and referrals require the
  ///         drop to carry a referral share.
  error InvalidReferral();
  error TransferFailed();
  error Unauthorized();
  error SessionExpired();

  // --- STATE GETTERS ---

  function version() external pure returns (string memory);
  function hupContract() external view returns (IHup);
  function followerSystem() external view returns (address);
  function ADMIN_ROLE() external view returns (bytes32);
  function trustedForwarders(address forwarder) external view returns (bool);
  function isTrustedForwarder(address forwarder) external view returns (bool);
  function mintFeeBps() external view returns (uint256);
  function creationFee() external view returns (uint256);
  function FEE_DENOMINATOR() external view returns (uint256);
  function ABSOLUTE_MAX_MINT_FEE_BPS() external view returns (uint256);
  function MAX_REFERRAL_BPS() external view returns (uint256);
  function MAX_PHASES() external view returns (uint256);
  function MAX_PER_TX() external view returns (uint256);
  /// @notice Total number of drops ever created; drop ids are 1..dropCount.
  function dropCount() external view returns (uint256);
  /// @notice The deployer satellite for a standard id, or address(0) when the standard is not
  ///         available on this chain. Canonical ids: 1 = ERC721, 2 = ERC1155, 3 = LSP7, 4 = LSP8;
  ///         future standards take the next free id.
  function deployers(uint256 standardId) external view returns (address);
  /// @notice Reverse lookup from a collection this engine deployed to its drop id (0 if unknown).
  function dropIdOf(address collection) external view returns (uint256);
  /// @notice How many items `wallet` minted in a phase, keyed by the resolved primary wallet.
  function mintedInPhaseBy(uint256 dropId, uint256 phaseIndex, address wallet) external view returns (uint256);

  // --- MUTATIVE LOGIC ---

  /**
   * @notice Creates a drop: deploys the collection through the standard's registered deployer
   *         satellite and stores its phase schedule. The collection is owned by the creator from
   *         its first block; this engine only ever holds mint authority.
   * @dev msg.value must equal `creationFee` exactly. Phases are validated and then immutable.
   * @param _creator The primary wallet creating the drop (or address(0) if caller is primary).
   * @param _standardId Which registered standard to deploy (see `deployers`).
   * @param _collectionParams ABI-encoded constructor parameters, decoded by the standard's
   *        deployer satellite (name, symbol, metadata, royalties — shape is per standard).
   * @param _maxSupply Total mintable items, fixed forever. 0 = open edition.
   * @param _referralBps Share of each paid mint (basis points) paid to the mint-time referrer.
   * @param _phases The phase schedule, in order. 1..MAX_PHASES entries.
   * @return dropId The id of the created drop.
   * @return collection The deployed collection contract.
   */
  function createDrop(address _creator, uint256 _standardId, bytes calldata _collectionParams, uint256 _maxSupply, uint256 _referralBps, PhaseInput[] calldata _phases) external payable returns (uint256 dropId, address collection);

  /**
   * @notice Mints `_quantity` items from a drop's phase. msg.value must exactly equal the phase
   *         price times the quantity. The platform fee stays in the contract; the referral share
   *         goes to `_referral` when provided; the remainder is pushed straight to the creator —
   *         no escrow.
   * @param _minter The primary wallet minting (or address(0) if caller is primary). Per-wallet
   *        limits count against the resolved primary, so a burner session cannot reset them.
   * @param _dropId The drop to mint from.
   * @param _phaseIndex Which phase to mint through; its window must be open.
   * @param _quantity How many items. 1..MAX_PER_TX.
   * @param _referral The referrer credited with the mint, or address(0) for none. Must be
   *        neither minter nor creator.
   * @param _proof Merkle proof for Allowlist phases (leaf = double-hashed minter address, the
   *        OpenZeppelin StandardMerkleTree convention). Empty for other gates.
   */
  function mint(address _minter, uint256 _dropId, uint256 _phaseIndex, uint256 _quantity, address _referral, bytes32[] calldata _proof) external payable;

  /**
   * @notice Pauses or resumes one phase, any number of times in either direction. Callable by
   *         the drop's creator (or their active burner session) only — pausing is a creator's
   *         lever over their own sale, not a moderation tool; moderation closes the drop or
   *         pauses the engine instead.
   * @dev Nothing else about the phase can change: window, price, limits, and gate stay
   *       immutable. A paused phase reverts `PhaseNotActive` on mint and is skipped by
   *       `activePhaseOf`, whatever its window says.
   */
  function setPhasePaused(uint256 _dropId, uint256 _phaseIndex, bool _paused) external;

  /**
   * @notice Closes a drop permanently. Callable by the drop's creator (or their active burner
   *         session) and by moderation admins. Remaining supply is forfeited; the collection
   *         contract itself is untouched.
   */
  function closeDrop(uint256 _dropId) external;

  // --- VIEW FUNCTIONS ---

  /**
   * @notice Returns a drop by id (zeroed struct when the id does not exist).
   */
  function getDrop(uint256 _dropId) external view returns (Drop memory);

  /**
   * @notice Returns a drop's full phase schedule, in index order.
   */
  function phasesOf(uint256 _dropId) external view returns (Phase[] memory);

  /**
   * @notice Returns the first phase whose time window is open right now and which its creator
   *         has not paused. `found` is false when no phase is live (upcoming, paused, between
   *         phases, or ended).
   */
  function activePhaseOf(uint256 _dropId) external view returns (bool found, uint256 index);

  /**
   * @notice Returns whether `_wallet` could mint `_quantity` through a phase right now, checking
   *         everything except an Allowlist proof (which only the client holds). For Allowlist
   *         phases a true result still requires a valid proof at mint time.
   */
  function isMintable(uint256 _dropId, uint256 _phaseIndex, address _wallet, uint256 _quantity) external view returns (bool);

  // --- ADMIN CONFIGURATION ---

  function pause() external;
  function unpause() external;
  function setDeployer(uint256 _standardId, address _deployer) external;
  function setMintFeeBps(uint256 _mintFeeBps) external;
  function setCreationFee(uint256 _creationFee) external;
  function setFollowerSystem(address _followerSystem) external;
  function setTrustedForwarder(address _forwarder, bool _trusted) external;
  function setHupContract(address _hupAddress) external;
  function withdrawAll(address payable _receiver) external;
}

/**
 * @title IHupDropsDeployer
 * @notice A per-standard satellite holding one collection's creation code, so the engine stays
 *         under the EIP-170 size limit and future standards bolt on without redeploying it.
 * @dev `deploy` must revert for any caller but the engine it was constructed with.
 */
interface IHupDropsDeployer {
  function drops() external view returns (address);
  function deploy(address _creator, uint256 _maxSupply, bytes calldata _params) external returns (address collection);
}

/**
 * @title IHupDropCollection
 * @notice The uniform mint hook every drop collection exposes to the engine, whatever standard
 *         it speaks.
 * @dev `engineMint` must revert for any caller but the engine. Numbered standards (ERC721, LSP8)
 *      mint ids `_firstTokenId .. _firstTokenId + _quantity - 1`; edition standards (ERC1155,
 *      LSP7) mint `_quantity` units and ignore `_firstTokenId`.
 */
interface IHupDropCollection {
  function drops() external view returns (address);
  function maxSupply() external view returns (uint256);
  function totalMinted() external view returns (uint256);
  function engineMint(address _to, uint256 _firstTokenId, uint256 _quantity) external;
}

/**
 * @title ILSP26Minimal
 * @notice The single LSP26 Follower System call the Followers gate needs.
 */
interface ILSP26Minimal {
  function isFollowing(address follower, address addr) external view returns (bool);
}

/**
 * @title IGateBalance
 * @notice Minimal `balanceOf` shared by ERC20, ERC721, LSP7, and LSP8 — one gate check covers
 *         all four.
 */
interface IGateBalance {
  function balanceOf(address account) external view returns (uint256);
}

/**
 * @title IGateBalance1155
 * @notice Id-scoped `balanceOf` for ERC1155 asset gates.
 */
interface IGateBalance1155 {
  function balanceOf(address account, uint256 id) external view returns (uint256);
}
