// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "./../IHup.sol";
import "./IUniswapV3Minimal.sol";

/**
 * @title IHupLaunch
 * @author Hup Labs
 * @notice Shared interface for the Hup Launch protocol — one-phase memecoin launches that are a
 *         live, permanently locked Uniswap v3 pool from their first block.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used by
 *      HupLaunch-compatible contracts, clients, and offchain indexers. There is no curve contract
 *      and no graduation moment: createLaunch mints the fixed supply, seeds a v3 pool with all of
 *      it as a single-sided range position (which IS the bonding curve), and locks the position
 *      forever in the HupLaunchLocker. All trading — Hup's own UI included — is ordinary Uniswap
 *      swaps, so aggregators and wallets can route the token from minute one.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🚀
 */
interface IHupLaunch {
    // --- SHARED TYPES ---

    /// @notice A launched token and its permanent Uniswap footprint.
    /// @dev No lifecycle enum: a launch has exactly one state — live. The pool is permissionless,
    ///      so there is nothing the protocol could halt; moderation is an offchain concern
    ///      (hiding from Hup surfaces), exactly as on pools.trade.
    struct Launch {
        address creator;
        address token;
        address pool;
        /// @dev The locked position's NFT id in the Uniswap position manager, held by the locker.
        uint256 positionTokenId;
        uint64 createdAt;
        uint64 createdBlock;
        /// @dev Creator's share of the position's native-side LP fees in basis points of fees
        ///      collected (0 when the creator opted out). Snapshotted at creation.
        uint16 creatorShareBps;
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted once per launch, at creation. The anchor row for offchain indexers — the
    ///         `pool` address is what the indexer adds to its Swap-event watch list.
    /// @dev `metadata` (image, description, links) is emitted but never stored, like a tip memo.
    ///      Name and symbol live on the token contract itself. `sqrtPriceX96` is the pool's
    ///      opening price, so charts can seed the origin candle from this log alone.
    event LaunchCreated(
        uint256 indexed launchId,
        address indexed creator,
        address indexed token,
        address pool,
        uint256 positionTokenId,
        string name,
        string symbol,
        uint160 sqrtPriceX96,
        uint16 creatorShareBps,
        string metadata
    );

    /// @notice Emitted when a trusted forwarder's status is updated.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    /// @notice Emitted when the Hup Core address used for burner-session resolution is rotated.
    event HupContractUpdated(address indexed oldAddress, address indexed newAddress);

    /// @notice Emitted when the flat native creation fee is updated.
    event CreationFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the default creator share of collected LP fees is updated.
    event DefaultCreatorShareUpdated(uint16 oldValue, uint16 newValue);

    /// @notice Emitted when the opening full-supply valuation for new launches is updated.
    event OpeningSupplyValueUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the maximum metadata byte length is updated.
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when accumulated creation fees are withdrawn by an admin.
    event FeesWithdrawn(address indexed receiver, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidAmount();
    error InvalidShareBps();
    error InvalidOpeningValue();
    error InvalidMetadataLimit();
    error TokenInfoRequired();
    error MetadataTooLarge(uint256 length, uint256 maxLength);
    error InsufficientPayment(uint256 provided, uint256 required);
    error TransferFailed();
    error Unauthorized();
    error SessionExpired();
    error LaunchNotFound();
    error NothingToClaim();
    error UnexpectedNativePayment();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function hupContract() external view returns (IHup);
    function ADMIN_ROLE() external view returns (bytes32);
    function isTrustedForwarder(address forwarder) external view returns (bool);
    function trustedForwarders(address forwarder) external view returns (bool);
    function FEE_DENOMINATOR() external view returns (uint256);
    /// @notice Total tokens minted per launch, fixed and non-inflatable (1B, 18 decimals). The
    ///         entire supply is mapped to the bonding-curve position — none is held back.
    function TOTAL_SUPPLY() external view returns (uint256);
    /// @notice The v3 fee tier every launch pool uses (3000 = 0.30%).
    function POOL_FEE() external view returns (uint24);
    function tokenImplementation() external view returns (address);
    function uniswapFactory() external view returns (IUniswapV3FactoryMinimal);
    function positionManager() external view returns (INonfungiblePositionManagerMinimal);
    function wnative() external view returns (IWETH9Minimal);
    function nextLaunchId() external view returns (uint256);
    function creationFee() external view returns (uint256);
    /// @notice Default creator share of collected LP fees, in bps of fees, applied when the
    ///         creator opts in (1667 ≈ 5bps of the 30bps tier, mirroring pools.trade's 5-of-25).
    function defaultCreatorShareBps() external view returns (uint16);
    /// @notice Native value the full 1B supply opens at (the launch FDV in native wei). Sets the
    ///         pool's initial price: P0 = openingSupplyValue / TOTAL_SUPPLY. Per-chain tunable —
    ///         one native coin is worth wildly different amounts across Hup's chains.
    function openingSupplyValue() external view returns (uint128);
    function maxMetadataBytes() external view returns (uint256);
    /// @notice Creation fees accrued in native, withdrawable by an admin. LP fees never touch
    ///         this contract — they accrue inside the pool and are handled by the locker.
    function accruedFees() external view returns (uint256);
    /// @notice Maps a launched token address back to its launch id (0 when not a Hup launch).
    function launchIdOf(address token) external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Creates a token and its live Uniswap pool in one transaction.
     * @dev Mints TOTAL_SUPPLY of a fresh minimal-proxy ERC20, creates and initializes the
     *      token/WNATIVE v3 pool at the opening price, deposits the entire supply as a
     *      single-sided range position from the opening tick upward — the bonding curve — and
     *      transfers the position NFT to the locker, where no code path can ever withdraw it.
     *      `msg.value` must cover the flat `creationFee`; any excess is swapped through the new
     *      pool to the creator in the same transaction (the "buy pre-launch" bundle), so nobody
     *      can trade between the pool opening and the creator's first buy.
     * @param _owner The primary wallet of the creator (or address(0) if the caller is primary).
     * @param _name ERC20 token name.
     * @param _symbol ERC20 token symbol.
     * @param _takeCreatorFee True to take the creator share of the position's native-side LP fees.
     * @param _metadata Opaque content reference (IPFS CID) for image, description, and links.
     *        Emitted with LaunchCreated, never stored.
     * @return launchId The new launch's id (ids start at 1, so 0 means "not found").
     */
    function createLaunch(
        address _owner,
        string calldata _name,
        string calldata _symbol,
        bool _takeCreatorFee,
        string calldata _metadata
    ) external payable returns (uint256 launchId);

    // --- VIEW FUNCTIONS ---

    /// @notice Returns a launch by id. Reverts LaunchNotFound for unknown ids.
    function getLaunch(uint256 _launchId) external view returns (Launch memory);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    function setHupContract(address _hupAddress) external;
    function setCreationFee(uint256 _creationFee) external;
    function setDefaultCreatorShareBps(uint16 _shareBps) external;
    function setOpeningSupplyValue(uint128 _openingSupplyValue) external;
    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external;
    function withdrawFees(address _receiver) external;
}
