// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HupLaunch} from "../../v2/Extensions/HupLaunch.sol";
import {HupLaunchLocker} from "../../v2/Extensions/HupLaunchLocker.sol";
import {IHupLaunch} from "../../v2/Extensions/IHupLaunch.sol";

/// @dev Interface fragment for probing the ERC721 owner of a v4 position.
interface IERC721Minimal {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title HupLaunch v4 fork test
 * @notice Runs the whole launch path against the REAL Uniswap v4 deployment on Base Sepolia, so
 *         the tick math, the Permit2 pull and the position mint are all exercised against
 *         production code rather than mocks.
 * @dev Run with:
 *        FOUNDRY_PROFILE=launch forge test --match-path "forge-launch/test/*" \
 *          --fork-url https://base-sepolia-rpc.publicnode.com -vv
 */
contract HupLaunchV4ForkTest is Test {
    using StateLibrary for IPoolManager;

    IPoolManager constant POOL_MANAGER = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408);
    address constant POSITION_MANAGER = 0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant HUP_CORE = 0xf6b33ecab0fa561300453c1bb1B520Ce544544ae;
    address constant FORWARDER = 0x18B86518709a6C0942F3adCD0CD528D1716e0A80;

    /// @dev The factory's own default ceiling, which is what these launches ask for.
    uint16 constant CREATOR_SHARE_BPS = 5_000;

    HupLaunch launchpad;
    HupLaunchLocker locker;

    address admin = makeAddr("admin");
    address creator = makeAddr("creator");

    function setUp() public {
        launchpad = new HupLaunch(HUP_CORE, FORWARDER, admin, address(POOL_MANAGER), POSITION_MANAGER, PERMIT2);
        locker = launchpad.locker();

        vm.deal(creator, 10 ether);
    }

    /// @dev The launch these tests reuse: the full creator share, paid to the creator. Makes
    ///      exactly one external call, so a vm.prank set by the caller lands on createLaunch.
    function _openLaunch(uint256 _buy) internal returns (uint256) {
        return launchpad.createLaunch{value: _buy}(
            address(0), "Babe", "BAB", CREATOR_SHARE_BPS, address(0), "ipfs://x", address(0), _buy
        );
    }

    function test_launchOpensALivePoolAndLocksTheSupply() public {
        vm.prank(creator);
        uint256 launchId = _openLaunch(0);

        IHupLaunch.Launch memory launch = launchpad.getLaunch(launchId);

        assertEq(launch.creator, creator, "creator not recorded");
        assertEq(launch.quote, address(0), "quote should be native");
        assertEq(launchpad.launchIdOf(launch.token), launchId, "reverse lookup broken");

        // The pool is live at the opening price
        (uint160 sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(PoolId.wrap(launch.poolId));
        assertGt(sqrtPriceX96, 0, "pool was never initialized");

        // The position exists and the locker owns it, with no way to get it back
        assertEq(IERC721Minimal(POSITION_MANAGER).ownerOf(launch.positionTokenId), address(locker), "position not locked");
        assertGt(IPositionManager(POSITION_MANAGER).getPositionLiquidity(launch.positionTokenId), 0, "no liquidity");

        // Nothing of the supply is left behind in the factory
        assertEq(IERC20(launch.token).balanceOf(address(launchpad)), 0, "factory still holds supply");
    }

    function test_openingBuyLandsWithTheCreatorInTheSameTransaction() public {
        uint256 buy = 0.05 ether;

        vm.prank(creator);
        uint256 launchId = _openLaunch(buy);

        IHupLaunch.Launch memory launch = launchpad.getLaunch(launchId);

        // The creator holds tokens bought in the same transaction the pool opened in, so there
        // is no block in which a sniper can get in ahead of them
        uint256 bought = IERC20(launch.token).balanceOf(creator);
        assertGt(bought, 0, "opening buy bought nothing");
        assertEq(IERC20(launch.token).balanceOf(address(launchpad)), 0, "factory kept part of the buy");
    }

    /**
     * @dev A launch pool is deliberately an ordinary Uniswap pool: canonical 1% tier, no hook,
     *      static LP fee. That is what makes it routable by every aggregator and by Hup's own
     *      swap page, which only probes the standard tiers.
     */
    function test_poolIsHooklessAtTheCanonicalTier() public {
        vm.prank(creator);
        uint256 launchId = _openLaunch(0);
        IHupLaunch.Launch memory launch = launchpad.getLaunch(launchId);
        PoolKey memory key = _keyFor(launch);

        assertEq(key.fee, launchpad.LAUNCH_FEE(), "pool is not at the launch tier");
        assertFalse(LPFeeLibrary.isDynamicFee(key.fee), "pool fee must be static");
        assertEq(address(key.hooks), address(0), "pool must carry no hook");
        assertEq(PoolId.unwrap(key.toId()), launch.poolId, "pool id mismatch");

        // The PoolManager agrees: the LP fee it charges is the static launch tier
        (,,, uint24 lpFee) = POOL_MANAGER.getSlot0(PoolId.wrap(launch.poolId));
        assertEq(lpFee, launchpad.LAUNCH_FEE(), "PoolManager charges a different fee");
    }

    /**
     * @dev A launch pool is an ordinary Uniswap pool: anyone may provide liquidity to it, and any
     *      position they open is theirs, earns its own share of the fee, and can be withdrawn at
     *      will. Only the launch's OWN position is the one nobody can withdraw.
     */
    function test_anyoneCanAddLiquidityToALaunchPool() public {
        vm.prank(creator);
        uint256 launchId = _openLaunch(0);
        IHupLaunch.Launch memory launch = launchpad.getLaunch(launchId);
        PoolKey memory key = _keyFor(launch);

        address outsider = makeAddr("outsider");
        vm.deal(outsider, 5 ether);

        // A range above the current price needs only currency0, which here is the native coin
        (, int24 currentTick,,) = POOL_MANAGER.getSlot0(PoolId.wrap(launch.poolId));
        int24 spacing = launchpad.TICK_SPACING();
        int24 lower = ((currentTick / spacing) * spacing) + spacing * 10;
        int24 upper = lower + spacing * 10;

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount0(
            TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), 1 ether
        );

        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP)
        );
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(key, lower, upper, liquidity, uint128(2 ether), uint128(0), outsider, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        params[2] = abi.encode(key.currency0, outsider);

        uint256 outsiderPositionId = IPositionManager(POSITION_MANAGER).nextTokenId();

        vm.prank(outsider);
        IPositionManager(POSITION_MANAGER).modifyLiquidities{value: 2 ether}(
            abi.encode(actions, params), block.timestamp
        );

        assertEq(
            IERC721Minimal(POSITION_MANAGER).ownerOf(outsiderPositionId), outsider, "outsider should own their position"
        );
        assertGt(
            IPositionManager(POSITION_MANAGER).getPositionLiquidity(outsiderPositionId), 0, "outsider added no liquidity"
        );
    }

    function test_creatorPicksTheirOwnShareAndItIsWhatGetsStamped() public {
        vm.prank(creator);
        uint256 launchId = launchpad.createLaunch(
            address(0), "Babe", "BAB", 1_000, address(0), "ipfs://x", address(0), 0
        );

        IHupLaunch.Launch memory launch = launchpad.getLaunch(launchId);
        assertEq(launch.creatorShareBps, 1_000, "the creator's own number was not stamped");

        (, address feeRecipient, uint16 shareBps,,) = locker.lockedPositions(launch.positionTokenId);
        assertEq(shareBps, 1_000, "locker pays a different share than the launch records");
        assertEq(feeRecipient, creator, "an unnamed recipient should be the creator");
    }

    function test_aShareAboveTheCeilingIsRejected() public {
        vm.prank(creator);
        vm.expectRevert(IHupLaunch.InvalidShareBps.selector);
        launchpad.createLaunch(
            address(0), "Babe", "BAB", CREATOR_SHARE_BPS + 1, address(0), "ipfs://x", address(0), 0
        );
    }

    function test_feeRecipientIsTheCreatorsToNameAndToMove() public {
        address treasury = makeAddr("treasury");
        address cofounder = makeAddr("cofounder");

        vm.prank(creator);
        uint256 launchId = launchpad.createLaunch(
            address(0), "Babe", "BAB", CREATOR_SHARE_BPS, treasury, "ipfs://x", address(0), 0
        );
        uint256 positionTokenId = launchpad.getLaunch(launchId).positionTokenId;

        (, address named,,,) = locker.lockedPositions(positionTokenId);
        assertEq(named, treasury, "the named recipient was not honoured");

        // Nobody else may repoint it, not even the address being paid
        vm.prank(treasury);
        vm.expectRevert(HupLaunchLocker.Unauthorized.selector);
        locker.setFeeRecipient(positionTokenId, cofounder);

        vm.prank(creator);
        locker.setFeeRecipient(positionTokenId, cofounder);

        (, address moved,,,) = locker.lockedPositions(positionTokenId);
        assertEq(moved, cofounder, "creator could not move their own fee");
    }

    function test_quoteAssetsCanBePricedInOneBatch() public {
        address[] memory quotes = new address[](3);
        quotes[0] = makeAddr("NVDA");
        quotes[1] = makeAddr("AAPL");
        quotes[2] = makeAddr("TSLA");

        uint128[] memory values = new uint128[](3);
        values[0] = 20 ether;
        values[1] = 30 ether;
        values[2] = 40 ether;

        vm.prank(admin);
        launchpad.setQuoteAssets(quotes, values);

        assertEq(launchpad.quoteOpeningValue(quotes[0]), 20 ether, "first asset unpriced");
        assertEq(launchpad.quoteOpeningValue(quotes[2]), 40 ether, "last asset unpriced");

        // A zero withdraws, so the same call that opens a registry can close part of it
        values[1] = 0;
        vm.prank(admin);
        launchpad.setQuoteAssets(quotes, values);
        assertEq(launchpad.quoteOpeningValue(quotes[1]), 0, "asset was not withdrawn");
    }

    function test_quoteBatchRejectsMismatchedAndOversizedInput() public {
        address[] memory quotes = new address[](2);
        quotes[0] = makeAddr("NVDA");
        quotes[1] = makeAddr("AAPL");
        uint128[] memory short = new uint128[](1);

        vm.prank(admin);
        vm.expectRevert(IHupLaunch.LengthMismatch.selector);
        launchpad.setQuoteAssets(quotes, short);

        uint256 tooMany = launchpad.MAX_QUOTE_BATCH() + 1;
        address[] memory many = new address[](tooMany);
        uint128[] memory manyValues = new uint128[](tooMany);
        for (uint256 i = 0; i < tooMany; i++) many[i] = address(uint160(i + 1));

        vm.prank(admin);
        vm.expectRevert(IHupLaunch.InvalidQuoteBatch.selector);
        launchpad.setQuoteAssets(many, manyValues);
    }

    function test_quoteBatchIsAdminOnly() public {
        address[] memory quotes = new address[](1);
        quotes[0] = makeAddr("NVDA");
        uint128[] memory values = new uint128[](1);
        values[0] = 20 ether;

        vm.prank(creator);
        vm.expectRevert(IHupLaunch.Unauthorized.selector);
        launchpad.setQuoteAssets(quotes, values);
    }

    // --- HELPERS ---

    function _keyFor(IHupLaunch.Launch memory _launch) internal view returns (PoolKey memory) {
        bool tokenIsCurrency0 = _launch.token < _launch.quote;

        return PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? _launch.token : _launch.quote),
            currency1: Currency.wrap(tokenIsCurrency0 ? _launch.quote : _launch.token),
            fee: launchpad.LAUNCH_FEE(),
            tickSpacing: launchpad.TICK_SPACING(),
            hooks: IHooks(address(0))
        });
    }
}
