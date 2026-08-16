// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IHupLaunch.sol";
import "./IUniswapV3Minimal.sol";
import "./HupLaunchToken.sol";
import "./HupLaunchLocker.sol";

/**
 * @title Hup Launch
 * @author Hup Labs
 * @notice One-phase memecoin launches on Hup, the pools.trade way: a creator names a token and
 *         one transaction later it is a live Uniswap v3 pool — entire 1B supply mapped to a
 *         bonding curve, liquidity locked forever, tradable by anyone, anywhere, from the first
 *         block. Hup's own UI trades it through the same pool as every aggregator and wallet.
 * @dev The bonding curve IS a Uniswap position: the full supply is deposited single-sided as one
 *      range order from the opening tick upward, into a pool created and initialized in the same
 *      transaction. Buyers walking the price up that range reproduce exactly the constant-product
 *      curve a dedicated contract would give — with the difference that the market lives inside
 *      Uniswap, so nothing about it is Hup-only.
 *
 *      This contract is a factory and registry, not an exchange. It never holds user funds
 *      beyond a transaction's own scope: tokens go straight into the pool, the position NFT goes
 *      straight into the HupLaunchLocker (which has no withdrawal path — see its NatSpec for the
 *      auto-compounding jar), and any msg.value above the creation fee is swapped through the
 *      new pool to the creator atomically, so the creator's opening buy cannot be front-run.
 *
 *      What one-phase deliberately gives up, mirroring pools.trade: there is no freeze — a v3
 *      pool is permissionless and nobody can halt trading on it; moderation is hiding a launch
 *      from Hup's surfaces, offchain. And there is no snipe guard — the pool is open to everyone
 *      from its first block.
 *
 *      Uses IHupLaunch for shared structs, events, errors, and view signatures. Integrates with
 *      Hup Core via IHup only to resolve burner session keys to primary wallets. Supports
 *      rotatable ERC2771 trusted forwarders, AccessControl for admin permissions, Pausable as a
 *      circuit breaker on new launches (never on trading — that is out of anyone's hands), and
 *      ReentrancyGuard on the value-moving paths.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🚀
 */
contract HupLaunch is IHupLaunch, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2_048;

    /// @notice Every launch mints exactly this much, once, and can never mint again. All of it
    ///         goes into the pool — no team allocation, no holdback, no reserve.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    /// @notice The v3 fee tier every launch pool uses: 0.30%, the closest standard tier to
    ///         pools.trade's 25bps. Fees accrue to the locked position and auto-compound.
    uint24 public constant POOL_FEE = 3_000;

    /// @notice Ceiling on the creator's share of collected fees (50% of fees).
    uint16 public constant ABSOLUTE_MAX_CREATOR_SHARE_BPS = 5_000;

    /// @dev Uniswap v3 tick and sqrt-price bounds, from TickMath
    int24 private constant MAX_TICK = 887_272;
    uint160 private constant MIN_SQRT_RATIO = 4_295_128_739;
    uint160 private constant MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

    /// @notice The HupLaunchToken implementation that every launch clones via EIP-1167.
    address public immutable tokenImplementation;

    /// @notice The permanent home of every launch's position NFT. Deployed by this constructor,
    ///         admin-free, no withdrawal path — see its own NatSpec.
    HupLaunchLocker public immutable locker;

    IUniswapV3FactoryMinimal public immutable uniswapFactory;
    INonfungiblePositionManagerMinimal public immutable positionManager;
    IWETH9Minimal public immutable wnative;

    /// @notice The Hup Core contract instance (burner session resolution only). Admin-rotatable
    ///         so a Hup Core redeploy doesn't strand the composer flow behind a stale source.
    IHup public hupContract;

    /// @notice Maps launch id to its launch
    mapping(uint256 => Launch) private _launches;

    /// @notice The id the next launch will receive; ids start at 1 so 0 means "not found"
    uint256 public nextLaunchId = 1;

    /// @notice Maps a launched token back to its launch id, so a client holding only a token
    ///         address can prove it came from here and find its pool.
    mapping(address => uint256) public launchIdOf;

    mapping(address => bool) public trustedForwarders;

    /// @notice Creation fees accrued in native. LP fees never pass through this contract.
    uint256 public accruedFees;

    /// @notice Flat native cost to open a launch, as spam friction. Accrues to the fee ledger.
    uint256 public creationFee = 0;

    /// @notice Creator share of native-side collected LP fees when the creator opts in, in bps
    ///         of fees. 1667 ≈ 5bps of the 30bps tier — pools.trade's 5-of-25, transposed.
    uint16 public defaultCreatorShareBps = 1_667;

    /// @notice Native value the full supply opens at (launch FDV in native wei). Sets the pool's
    ///         initial price. Per-chain tunable: pools.trade opens around $5K FDV, and the wei
    ///         figure that corresponds to differs per chain's native coin.
    uint128 public openingSupplyValue = 1 ether;

    /// @notice The maximum allowed byte length for a launch's metadata reference
    uint256 public maxMetadataBytes = 256;

    /// @dev The pool a dev-buy swap is in flight against; gates the swap callback to that exact
    ///      caller for that exact transaction.
    address private _pendingPool;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the launch factory, deploys the token implementation it clones and the
     *         locker that will hold every position.
     * @param _hupAddress Address of the deployed core Hup contract.
     * @param _trustedForwarder Address of the initial EIP-2771 trusted forwarder (or address(0)).
     * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     * @param _uniswapFactory The chain's Uniswap v3 factory.
     * @param _positionManager The chain's Uniswap NonfungiblePositionManager.
     * @param _wnative The chain's canonical wrapped-native token (WETH9-compatible).
     */
    constructor(
        address _hupAddress,
        address _trustedForwarder,
        address _admin,
        address _uniswapFactory,
        address _positionManager,
        address _wnative
    ) ERC2771Context(_trustedForwarder) {
        if (
            _hupAddress == address(0) || _admin == address(0) || _uniswapFactory == address(0)
                || _positionManager == address(0) || _wnative == address(0)
        ) revert InvalidAddress();

        // The fee tier must exist on this chain's factory or every createLaunch would revert
        if (IUniswapV3FactoryMinimal(_uniswapFactory).feeAmountTickSpacing(POOL_FEE) == 0) revert InvalidAddress();

        hupContract = IHup(_hupAddress);
        uniswapFactory = IUniswapV3FactoryMinimal(_uniswapFactory);
        positionManager = INonfungiblePositionManagerMinimal(_positionManager);
        wnative = IWETH9Minimal(_wnative);

        tokenImplementation = address(new HupLaunchToken());
        locker = new HupLaunchLocker(_positionManager, _wnative);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        if (_trustedForwarder != address(0)) {
            trustedForwarders[_trustedForwarder] = true;
            emit TrustedForwarderUpdated(_trustedForwarder, true);
        }
    }

    // --- MUTATIVE LOGIC ---

    /// @inheritdoc IHupLaunch
    function createLaunch(
        address _owner,
        string calldata _name,
        string calldata _symbol,
        bool _takeCreatorFee,
        string calldata _metadata
    ) external payable whenNotPaused nonReentrant returns (uint256 launchId) {
        address creator = _resolveActor(_owner);

        if (bytes(_name).length == 0 || bytes(_symbol).length == 0) revert TokenInfoRequired();
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }

        uint256 fee = creationFee;
        if (msg.value < fee) revert InsufficientPayment(msg.value, fee);
        accruedFees += fee;

        address token = Clones.clone(tokenImplementation);
        HupLaunchToken(token).initialize(_name, _symbol, address(this), TOTAL_SUPPLY);

        bool tokenIsToken0 = token < address(wnative);

        // Pool opens at exactly the configured FDV: P0 = openingSupplyValue / TOTAL_SUPPLY,
        // expressed in the pool's own token order
        uint160 sqrtPriceX96 = _openingSqrtPriceX96(tokenIsToken0);

        address pool = uniswapFactory.createPool(token, address(wnative), POOL_FEE);
        IUniswapV3PoolMinimal(pool).initialize(sqrtPriceX96);

        (int24 tickLower, int24 tickUpper) = _fullSupplyRange(pool, tokenIsToken0);

        // The entire supply becomes the curve — a single-sided range position from the opening
        // tick to the edge of the tick space, owned by the locker from the moment it exists
        IERC20(token).forceApprove(address(positionManager), TOTAL_SUPPLY);
        (uint256 positionTokenId, , , ) = positionManager.mint(
            INonfungiblePositionManagerMinimal.MintParams({
                token0: tokenIsToken0 ? token : address(wnative),
                token1: tokenIsToken0 ? address(wnative) : token,
                fee: POOL_FEE,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: tokenIsToken0 ? TOTAL_SUPPLY : 0,
                amount1Desired: tokenIsToken0 ? 0 : TOTAL_SUPPLY,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(locker),
                deadline: block.timestamp
            })
        );

        uint16 creatorShareBps = _takeCreatorFee ? defaultCreatorShareBps : 0;

        launchId = nextLaunchId++;
        _launches[launchId] = Launch({
            creator: creator,
            token: token,
            pool: pool,
            positionTokenId: positionTokenId,
            createdAt: uint64(block.timestamp),
            createdBlock: uint64(block.number),
            creatorShareBps: creatorShareBps
        });
        launchIdOf[token] = launchId;

        locker.register(positionTokenId, creator, creatorShareBps, !tokenIsToken0);

        // Liquidity rounding can leave a few base units of the supply undeposited — parked at
        // the dead address so "entire supply on the curve or burned" stays literally true
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) IERC20(token).safeTransfer(address(0xdEaD), dust);

        emit LaunchCreated(
            launchId,
            creator,
            token,
            pool,
            positionTokenId,
            _name,
            _symbol,
            sqrtPriceX96,
            creatorShareBps,
            _metadata
        );

        // Anything paid above the creation fee is the creator's opening buy, swapped through the
        // pool in this same transaction — no block exists where the pool is live and the creator
        // hasn't bought, so the opening price cannot be sniped out from under them
        uint256 openingBuy = msg.value - fee;
        if (openingBuy > 0) {
            wnative.deposit{value: openingBuy}();

            bool zeroForOne = !tokenIsToken0; // WNATIVE in, launch token out
            _pendingPool = pool;
            IUniswapV3PoolMinimal(pool).swap(
                creator,
                zeroForOne,
                int256(openingBuy),
                zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
                ""
            );
            _pendingPool = address(0);
        }
    }

    /**
     * @notice Uniswap v3 swap callback — pays the WNATIVE the opening-buy swap owes the pool.
     * @dev Only the pool a swap is currently in flight against may call this, and only within
     *      the createLaunch transaction that armed it. The positive delta is always the WNATIVE
     *      side, because this contract only ever initiates WNATIVE-in swaps.
     */
    function uniswapV3SwapCallback(int256 _amount0Delta, int256 _amount1Delta, bytes calldata) external {
        if (msg.sender != _pendingPool || _pendingPool == address(0)) revert Unauthorized();

        uint256 owed = _amount0Delta > 0 ? uint256(_amount0Delta) : uint256(_amount1Delta);
        if (!wnative.transfer(msg.sender, owed)) revert TransferFailed();
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    /// @inheritdoc IHupLaunch
    function getLaunch(uint256 _launchId) external view returns (Launch memory) {
        Launch memory launch = _launches[_launchId];
        if (launch.creator == address(0)) revert LaunchNotFound();

        return launch;
    }

    // --- ADMIN CONFIGURATION ---

    function pause() external onlyDirectAdmin {
        _pause();
    }

    function unpause() external onlyDirectAdmin {
        _unpause();
    }

    function setTrustedForwarder(address _forwarder, bool _trusted) external onlyDirectAdmin {
        if (_forwarder == address(0)) revert InvalidAddress();

        trustedForwarders[_forwarder] = _trusted;

        emit TrustedForwarderUpdated(_forwarder, _trusted);
    }

    function setHupContract(address _hupAddress) external onlyDirectAdmin {
        if (_hupAddress == address(0)) revert InvalidAddress();

        // Probe the session getter so a fat-fingered address can't silently break the
        // burner-session path. This catches EOAs and contracts that don't answer the call.
        try IHup(_hupAddress).userSessions(address(0)) returns (address, uint256) {
            // answered, so the rotation target is a plausible Hup Core
        } catch {
            revert InvalidAddress();
        }

        address oldAddress = address(hupContract);
        hupContract = IHup(_hupAddress);

        emit HupContractUpdated(oldAddress, _hupAddress);
    }

    function setCreationFee(uint256 _creationFee) external onlyDirectAdmin {
        uint256 oldValue = creationFee;
        creationFee = _creationFee;

        emit CreationFeeUpdated(oldValue, _creationFee);
    }

    /// @inheritdoc IHupLaunch
    function setDefaultCreatorShareBps(uint16 _shareBps) external onlyDirectAdmin {
        if (_shareBps > ABSOLUTE_MAX_CREATOR_SHARE_BPS) revert InvalidShareBps();

        uint16 oldValue = defaultCreatorShareBps;
        defaultCreatorShareBps = _shareBps;

        emit DefaultCreatorShareUpdated(oldValue, _shareBps);
    }

    /// @inheritdoc IHupLaunch
    function setOpeningSupplyValue(uint128 _openingSupplyValue) external onlyDirectAdmin {
        if (_openingSupplyValue == 0) revert InvalidOpeningValue();

        uint256 oldValue = openingSupplyValue;
        openingSupplyValue = _openingSupplyValue;

        emit OpeningSupplyValueUpdated(oldValue, _openingSupplyValue);
    }

    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external onlyDirectAdmin {
        if (_maxMetadataBytes == 0 || _maxMetadataBytes > ABSOLUTE_MAX_METADATA_BYTES) {
            revert InvalidMetadataLimit();
        }

        uint256 oldValue = maxMetadataBytes;
        maxMetadataBytes = _maxMetadataBytes;

        emit MaxMetadataBytesUpdated(oldValue, _maxMetadataBytes);
    }

    /// @inheritdoc IHupLaunch
    function withdrawFees(address _receiver) external onlyDirectAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 amount = accruedFees;
        if (amount == 0) revert NothingToClaim();

        accruedFees = 0;

        (bool success, ) = _receiver.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit FeesWithdrawn(_receiver, amount);
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
     * @dev The opening sqrt price in the pool's token order. Price in v3 is token1-per-token0 in
     *      raw units, so with P0 = openingSupplyValue / TOTAL_SUPPLY:
     *        launch token as token0 → price = P0     → sqrtPriceX96 = sqrt(V0 · 2¹⁹² / S)
     *        launch token as token1 → price = 1 / P0 → sqrtPriceX96 = sqrt(S · 2¹⁹² / V0)
     *      Math.mulDiv carries the 512-bit intermediate, so no supply or valuation overflows.
     */
    function _openingSqrtPriceX96(bool _tokenIsToken0) internal view returns (uint160) {
        uint256 ratioX192 = _tokenIsToken0
            ? Math.mulDiv(openingSupplyValue, 1 << 192, TOTAL_SUPPLY)
            : Math.mulDiv(TOTAL_SUPPLY, 1 << 192, openingSupplyValue);

        uint256 sqrtPrice = Math.sqrt(ratioX192);
        if (sqrtPrice <= MIN_SQRT_RATIO || sqrtPrice >= MAX_SQRT_RATIO) revert InvalidOpeningValue();

        return uint160(sqrtPrice);
    }

    /**
     * @dev The tick range holding the full supply single-sided, aligned to the pool's spacing.
     *      A v3 position is entirely in the launch token exactly when the current tick sits
     *      outside the range on the token side — strictly below tickLower when the token is
     *      token0, at or above tickUpper when it is token1 — so the range starts one aligned
     *      tick past the opening tick and runs to the edge of the tick space. Buyers then walk
     *      the price through the range: the bonding curve.
     */
    function _fullSupplyRange(address _pool, bool _tokenIsToken0)
        internal
        view
        returns (int24 tickLower, int24 tickUpper)
    {
        (, int24 currentTick, , , , , ) = IUniswapV3PoolMinimal(_pool).slot0();
        int24 spacing = IUniswapV3PoolMinimal(_pool).tickSpacing();
        int24 maxUsable = (MAX_TICK / spacing) * spacing;

        if (_tokenIsToken0) {
            // Range strictly above the current tick; buyers push the price up through it
            int24 lower = (currentTick / spacing) * spacing;
            if (lower <= currentTick) lower += spacing;
            return (lower, maxUsable);
        }

        // Token is token1: range at or below the current tick; buys push the tick down through
        // it, which is the launch token's price rising
        int24 upper = (currentTick / spacing) * spacing;
        if (upper > currentTick) upper -= spacing;
        return (-maxUsable, upper);
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
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupLaunch) returns (bool) {
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

    /**
     * @dev Nothing legitimate sends bare native here — creation fees arrive as msg.value on
     *      createLaunch and LP fees never route through this contract — so reject instead of
     *      stranding funds.
     */
    receive() external payable {
        revert UnexpectedNativePayment();
    }
}
