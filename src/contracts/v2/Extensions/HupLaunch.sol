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

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import "./IHupLaunch.sol";
import "./HupLaunchToken.sol";
import "./HupLaunchLocker.sol";

/**
 * @title Hup Launch
 * @author Hup Labs
 * @notice One-phase memecoin launches on Hup: a creator names a token and one transaction later it
 *         is a live Uniswap v4 pool — entire 1B supply mapped to a bonding curve, liquidity locked
 *         forever, tradable by anyone, anywhere, from the first block. There is no curve contract
 *         to graduate out of and no migration anyone has to be trusted to perform.
 * @dev The bonding curve IS a Uniswap position: the full supply is deposited single-sided as one
 *      range order from the opening tick outward, into a pool created and initialized in the same
 *      transaction. Buyers walking the price through that range reproduce exactly the curve a
 *      dedicated contract would give, with the difference that the market lives inside Uniswap, so
 *      nothing about it is Hup-only.
 *
 *      Every pool is an ordinary Uniswap pool at the canonical 1% tier, with no hook attached.
 *      That is deliberate: a hookless pool at a standard tier is routable by every aggregator, and
 *      the fee is a plain LP fee accruing to the locked position, which HupLaunchLocker splits at
 *      collection time. Protection against snipers comes from the opening buy being bundled into
 *      this same transaction, not from a fee that punishes early trades.
 *
 *      A launch may be priced in the chain's native coin or in any ERC20 an admin has approved,
 *      which is how a token gets quoted in a stablecoin or a tokenized equity. The opening
 *      valuation is configured per quote asset, because one unit of a stock token and one unit of
 *      a native coin are not remotely the same amount of money.
 *
 *      This contract is a factory and registry, not an exchange. It never holds user funds beyond
 *      a transaction's own scope: tokens go straight into the pool, the position NFT goes straight
 *      into the HupLaunchLocker (which has no withdrawal path), and the creator's opening buy is
 *      swapped atomically so it cannot be front-run.
 *
 *      What one-phase deliberately gives up: there is no freeze, because a v4 pool is
 *      permissionless and nobody can halt trading on it. Moderation means hiding a launch from
 *      Hup's surfaces, offchain.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🚀
 */
contract HupLaunch is IHupLaunch, IUnlockCallback, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2_048;

    /// @notice Quote assets one setQuoteAssets call may write. Bounded so a batch cannot be built
    ///         that runs out of gas partway and leaves the allowlist half-written.
    uint256 public constant MAX_QUOTE_BATCH = 100;

    /// @notice Every launch mints exactly this much, once, and can never mint again. All of it
    ///         goes into the pool — no team allocation, no holdback, no reserve.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    /// @notice The fee every launch pool charges, in hundredths of a bip. Fixed for the life of
    ///         the pool: a launch opens at the same rate it will still be charging a year later.
    uint24 public constant LAUNCH_FEE = 10_000;

    /// @notice Tick spacing every launch pool uses. Paired with LAUNCH_FEE this is Uniswap's own
    ///         canonical 1% tier — which is what makes a launch pool routable by aggregators and
    ///         by Hup's own swap page, both of which probe the standard tiers and nothing else.
    int24 public constant TICK_SPACING = 200;

    /// @notice Ceiling on the creator's share of collected fees (50% of fees).
    uint16 public constant ABSOLUTE_MAX_CREATOR_SHARE_BPS = 5_000;

    /// @notice Protocol share of quote-side fees, stamped into every locker at deployment.
    uint16 public constant PROTOCOL_SHARE_BPS = 1_000;

    /// @notice Share of token-side (sell) fees burned on every collect.
    uint16 public constant BURN_SHARE_BPS = 1_000;

    /// @dev Widest range the tick spacing allows, used as the far edge of the supply range.
    int24 private constant MAX_USABLE_TICK = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;

    /// @notice The HupLaunchToken implementation that every launch clones via EIP-1167.
    address public immutable tokenImplementation;

    /// @notice The permanent home of every launch's position NFT. Deployed by this constructor,
    ///         admin-free, no withdrawal path — see its own NatSpec.
    HupLaunchLocker public immutable locker;

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;

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

    /// @notice Most of the collected LP fees a creator may take, in bps of fees. Each launch
    ///         picks its own share up to this line.
    uint16 public maxCreatorShareBps = 5_000;

    /// @notice Native value the full supply opens at (launch FDV in native wei). Sets the pool's
    ///         initial price for native-quoted launches. Per-chain tunable.
    uint128 public openingSupplyValue = 1 ether;

    /// @inheritdoc IHupLaunch
    mapping(address => uint128) public quoteOpeningValue;

    /// @notice The maximum allowed byte length for a launch's metadata reference
    uint256 public maxMetadataBytes = 256;

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
     * @param _poolManager The chain's Uniswap v4 PoolManager.
     * @param _positionManager The chain's Uniswap v4 PositionManager.
     * @param _permit2 The canonical Permit2 deployment.
     */
    constructor(
        address _hupAddress,
        address _trustedForwarder,
        address _admin,
        address _poolManager,
        address _positionManager,
        address _permit2
    ) ERC2771Context(_trustedForwarder) {
        if (
            _hupAddress == address(0) || _admin == address(0) || _poolManager == address(0)
                || _positionManager == address(0) || _permit2 == address(0)
        ) revert InvalidAddress();

        hupContract = IHup(_hupAddress);
        poolManager = IPoolManager(_poolManager);
        positionManager = IPositionManager(_positionManager);
        permit2 = IAllowanceTransfer(_permit2);

        tokenImplementation = address(new HupLaunchToken());
        locker = new HupLaunchLocker(
            _positionManager, _poolManager, _permit2, _admin, PROTOCOL_SHARE_BPS, BURN_SHARE_BPS
        );

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
        uint16 _creatorShareBps,
        address _feeRecipient,
        string calldata _metadata,
        address _quote,
        uint256 _openingBuy
    ) external payable whenNotPaused nonReentrant returns (uint256 launchId) {
        address creator = _resolveActor(_owner);

        if (bytes(_name).length == 0 || bytes(_symbol).length == 0) revert TokenInfoRequired();
        if (_creatorShareBps > maxCreatorShareBps) revert InvalidShareBps();
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }

        uint128 openingValue = _collectPayment(_quote, _openingBuy);

        address token = Clones.clone(tokenImplementation);
        HupLaunchToken(token).initialize(_name, _symbol, address(this), TOTAL_SUPPLY);

        bool tokenIsCurrency0 = token < _quote;
        uint160 sqrtPriceX96 = _openingSqrtPriceX96(tokenIsCurrency0, openingValue);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : _quote),
            currency1: Currency.wrap(tokenIsCurrency0 ? _quote : token),
            fee: LAUNCH_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        poolManager.initialize(key, sqrtPriceX96);

        uint256 positionTokenId = _mintFullSupplyPosition(key, token, tokenIsCurrency0, sqrtPriceX96);

        // An unnamed recipient is the creator themselves — the common case, and the one the
        // creator can still repoint later through the locker
        address feeRecipient = _feeRecipient == address(0) ? creator : _feeRecipient;

        launchId = nextLaunchId++;
        _launches[launchId] = Launch({
            creator: creator,
            token: token,
            poolId: PoolId.unwrap(key.toId()),
            quote: _quote,
            positionTokenId: positionTokenId,
            createdAt: uint64(block.timestamp),
            createdBlock: uint64(block.number),
            creatorShareBps: _creatorShareBps
        });
        launchIdOf[token] = launchId;

        locker.register(positionTokenId, creator, feeRecipient, _creatorShareBps, !tokenIsCurrency0);

        // Liquidity rounding can leave a few base units of the supply undeposited — parked at
        // the dead address so "entire supply on the curve or burned" stays literally true
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) IERC20(token).safeTransfer(address(0xdEaD), dust);

        emit LaunchCreated(
            launchId,
            creator,
            token,
            PoolId.unwrap(key.toId()),
            _quote,
            positionTokenId,
            _name,
            _symbol,
            sqrtPriceX96,
            _creatorShareBps,
            _metadata
        );

        // The opening buy runs in this same transaction, so no block exists where the pool is
        // live and the creator has not bought. This is the whole of the anti-snipe design: there
        // is no window to race rather than a penalty for racing it.
        if (_openingBuy > 0) {
            poolManager.unlock(abi.encode(key, !tokenIsCurrency0, _openingBuy, creator));
        }
    }

    /**
     * @notice Uniswap v4 unlock callback — performs the creator's opening buy.
     * @dev Only reachable from the PoolManager, and only inside createLaunch, which is the only
     *      function that ever calls unlock. Settles the quote leg and sends the bought tokens
     *      straight to the creator, so this contract holds neither at the end of the call.
     */
    function unlockCallback(bytes calldata _data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Unauthorized();

        (PoolKey memory key, bool zeroForOne, uint256 amountIn, address recipient) =
            abi.decode(_data, (PoolKey, bool, uint256, address));

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        // The quote leg is what the pool is owed; the token leg is what it owes the creator
        (int128 quoteDelta, int128 tokenDelta) =
            zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        Currency quoteCurrency = zeroForOne ? key.currency0 : key.currency1;
        Currency tokenCurrency = zeroForOne ? key.currency1 : key.currency0;

        if (quoteDelta < 0) _settle(quoteCurrency, uint256(uint128(-quoteDelta)));
        if (tokenDelta > 0) poolManager.take(tokenCurrency, recipient, uint256(uint128(tokenDelta)));

        return "";
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
    function setMaxCreatorShareBps(uint16 _shareBps) external onlyDirectAdmin {
        if (_shareBps > ABSOLUTE_MAX_CREATOR_SHARE_BPS) revert InvalidShareBps();

        uint16 oldValue = maxCreatorShareBps;
        maxCreatorShareBps = _shareBps;

        emit MaxCreatorShareUpdated(oldValue, _shareBps);
    }

    /// @inheritdoc IHupLaunch
    function setOpeningSupplyValue(uint128 _openingSupplyValue) external onlyDirectAdmin {
        if (_openingSupplyValue == 0) revert InvalidOpeningValue();

        uint256 oldValue = openingSupplyValue;
        openingSupplyValue = _openingSupplyValue;

        emit OpeningSupplyValueUpdated(oldValue, _openingSupplyValue);
    }

    /**
     * @notice Approves an ERC20 as a quote asset, reprices it, or withdraws it with a zero value.
     * @dev The opening value is denominated in the quote asset's own base units, so a six-decimal
     *      stablecoin and an eighteen-decimal token need different numbers for the same amount of
     *      money. Getting this wrong misprices a launch by orders of magnitude, so it is admin-set
     *      per asset rather than derived.
     */
    function setQuoteAsset(address _quote, uint128 _openingValue) external onlyDirectAdmin {
        if (_quote == address(0)) revert InvalidAddress();

        quoteOpeningValue[_quote] = _openingValue;

        emit QuoteAssetUpdated(_quote, _openingValue);
    }

    /**
     * @notice Approves, reprices or withdraws many quote assets in one transaction.
     * @dev Same rules as the single setter, one event per asset, so nothing downstream can tell
     *      the difference between a batch and a run of individual calls. It exists because a
     *      tokenized-equity registry is hundreds of assets deep: pricing them one transaction at
     *      a time is the only thing that would make the allowlist impractical to keep current.
     * @param _quotes The assets to write.
     * @param _openingValues Each asset's opening valuation, positionally matched, in that asset's
     *        own base units. Zero withdraws the asset.
     */
    function setQuoteAssets(address[] calldata _quotes, uint128[] calldata _openingValues)
        external
        onlyDirectAdmin
    {
        if (_quotes.length != _openingValues.length) revert LengthMismatch();
        if (_quotes.length == 0 || _quotes.length > MAX_QUOTE_BATCH) revert InvalidQuoteBatch();

        for (uint256 i = 0; i < _quotes.length; i++) {
            if (_quotes[i] == address(0)) revert InvalidAddress();

            quoteOpeningValue[_quotes[i]] = _openingValues[i];

            emit QuoteAssetUpdated(_quotes[i], _openingValues[i]);
        }
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
     * @dev Takes the creation fee and the opening buy in whichever asset the launch is priced in,
     *      and answers with the opening valuation to price the pool at. Native launches carry both
     *      as value; ERC20-quoted launches carry only the fee as value and the buy is pulled.
     */
    function _collectPayment(address _quote, uint256 _openingBuy) internal returns (uint128 openingValue) {
        uint256 fee = creationFee;

        if (_quote == address(0)) {
            if (msg.value != fee + _openingBuy) revert InsufficientPayment(msg.value, fee + _openingBuy);
            openingValue = openingSupplyValue;
        } else {
            if (msg.value != fee) revert UnexpectedNativePayment();
            openingValue = quoteOpeningValue[_quote];
            if (openingValue == 0) revert QuoteNotAccepted();

            // Pulled from the real caller, never from the resolved actor. A trusted forwarder or a
            // session key can claim to be anyone, so charging the resolved actor would let either
            // one spend a victim's standing approval. Neither holds funds, so an ERC20 opening buy
            // simply cannot be made through them — the same line Hup draws for tips.
            if (_openingBuy > 0) IERC20(_quote).safeTransferFrom(msg.sender, address(this), _openingBuy);
        }

        accruedFees += fee;
    }

    /**
     * @dev Deposits the entire supply as one single-sided range and hands the position straight to
     *      the locker. The range starts one aligned tick past the opening tick on the token's side
     *      and runs to the edge of the tick space, so the position is pure launch token at the
     *      opening price and buyers walk the price through it: the bonding curve.
     */
    function _mintFullSupplyPosition(
        PoolKey memory _key,
        address _token,
        bool _tokenIsCurrency0,
        uint160 _sqrtPriceX96
    ) internal returns (uint256 positionTokenId) {
        int24 currentTick = TickMath.getTickAtSqrtPrice(_sqrtPriceX96);
        (int24 tickLower, int24 tickUpper) = _fullSupplyRange(currentTick, _tokenIsCurrency0);

        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);

        uint128 liquidity = _tokenIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, TOTAL_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, TOTAL_SUPPLY);

        // The PositionManager pulls the supply through Permit2, so both approvals are needed and
        // both are scoped to this call
        IERC20(_token).forceApprove(address(permit2), TOTAL_SUPPLY);
        permit2.approve(_token, address(positionManager), uint160(TOTAL_SUPPLY), uint48(block.timestamp));

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            _key,
            tickLower,
            tickUpper,
            liquidity,
            _tokenIsCurrency0 ? uint128(TOTAL_SUPPLY) : uint128(0),
            _tokenIsCurrency0 ? uint128(0) : uint128(TOTAL_SUPPLY),
            address(locker),
            bytes("")
        );
        params[1] = abi.encode(_key.currency0, _key.currency1);

        positionTokenId = positionManager.nextTokenId();
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
    }

    /// @dev Pays the pool what a swap leg owes it, in native coin or through a synced transfer.
    function _settle(Currency _currency, uint256 _amount) internal {
        if (_currency.isAddressZero()) {
            poolManager.settle{value: _amount}();
        } else {
            poolManager.sync(_currency);
            IERC20(Currency.unwrap(_currency)).safeTransfer(address(poolManager), _amount);
            poolManager.settle();
        }
    }

    /**
     * @dev The opening sqrt price in the pool's currency order. Price is currency1-per-currency0
     *      in raw units, so with P0 = openingValue / TOTAL_SUPPLY:
     *        launch token as currency0 → price = P0     → sqrtPriceX96 = sqrt(V0 · 2¹⁹² / S)
     *        launch token as currency1 → price = 1 / P0 → sqrtPriceX96 = sqrt(S · 2¹⁹² / V0)
     *      Math.mulDiv carries the 512-bit intermediate, so no supply or valuation overflows.
     */
    function _openingSqrtPriceX96(bool _tokenIsCurrency0, uint128 _openingValue) internal pure returns (uint160) {
        uint256 ratioX192 = _tokenIsCurrency0
            ? Math.mulDiv(_openingValue, 1 << 192, TOTAL_SUPPLY)
            : Math.mulDiv(TOTAL_SUPPLY, 1 << 192, _openingValue);

        uint256 sqrtPrice = Math.sqrt(ratioX192);
        if (sqrtPrice <= TickMath.MIN_SQRT_PRICE || sqrtPrice >= TickMath.MAX_SQRT_PRICE) {
            revert InvalidOpeningValue();
        }

        return uint160(sqrtPrice);
    }

    /**
     * @dev The tick range holding the full supply single-sided, aligned to the pool's spacing. A
     *      position is entirely in the launch token exactly when the current tick sits outside the
     *      range on the token's side: strictly below tickLower when the token is currency0, at or
     *      above tickUpper when it is currency1.
     */
    function _fullSupplyRange(int24 _currentTick, bool _tokenIsCurrency0)
        internal
        pure
        returns (int24 tickLower, int24 tickUpper)
    {
        if (_tokenIsCurrency0) {
            // Range strictly above the current tick; buyers push the price up through it
            int24 lower = (_currentTick / TICK_SPACING) * TICK_SPACING;
            if (lower <= _currentTick) lower += TICK_SPACING;
            return (lower, MAX_USABLE_TICK);
        }

        // Token is currency1: range at or below the current tick; buys push the tick down through
        // it, which is the launch token's price rising
        int24 upper = (_currentTick / TICK_SPACING) * TICK_SPACING;
        if (upper > _currentTick) upper -= TICK_SPACING;
        return (-MAX_USABLE_TICK, upper);
    }

    /**
     * @dev Resolves the primary owner address based on burner session rules.
     */
    function _resolveActor(address _owner) internal view returns (address) {
        address sender = _msgSender();

        if (_owner == address(0) || _owner == sender) return sender;

        (address sessionKey, uint256 expiry) = hupContract.userSessions(_owner);
        if (sessionKey != sender) revert Unauthorized();
        if (expiry < block.timestamp) revert SessionExpired();

        return _owner;
    }

    /// @inheritdoc IHupLaunch
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupLaunch) returns (bool) {
        return trustedForwarders[forwarder];
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
}
