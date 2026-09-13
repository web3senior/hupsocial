// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HupLaunch} from "../../v2/Extensions/HupLaunch.sol";
import {HupLaunchLocker} from "../../v2/Extensions/HupLaunchLocker.sol";
import {IHupLaunch} from "../../v2/Extensions/IHupLaunch.sol";

interface IERC721Minimal {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @dev A minimal v4 router. Real swaps are the only way to make the pool accrue real fees, which
 *      is the whole point of these tests: the locker's split can only be judged against fees
 *      Uniswap actually charged.
 */
contract SwapHelper is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function swap(PoolKey memory _key, bool _zeroForOne, uint256 _amountIn, address _recipient) external payable {
        poolManager.unlock(abi.encode(_key, _zeroForOne, _amountIn, _recipient));
    }

    function unlockCallback(bytes calldata _data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");

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

        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        if (delta0 < 0) _settle(key.currency0, uint256(uint128(-delta0)));
        if (delta1 < 0) _settle(key.currency1, uint256(uint128(-delta1)));
        if (delta0 > 0) poolManager.take(key.currency0, recipient, uint256(uint128(delta0)));
        if (delta1 > 0) poolManager.take(key.currency1, recipient, uint256(uint128(delta1)));

        return "";
    }

    function _settle(Currency _currency, uint256 _amount) internal {
        if (_currency.isAddressZero()) {
            poolManager.settle{value: _amount}();
        } else {
            poolManager.sync(_currency);
            IERC20(Currency.unwrap(_currency)).transfer(address(poolManager), _amount);
            poolManager.settle();
        }
    }

    receive() external payable {}
}

/**
 * @title HupLaunchLocker fork test
 * @notice Exercises the half of the launch stack the existing suite never touches: what happens
 *         to the fees after the pool starts trading. Runs against the real Uniswap v4 deployment
 *         on Base Sepolia so the collect, the split and the compound are judged against the
 *         PositionManager's actual accounting rather than a mock's.
 * @dev Run with:
 *        FOUNDRY_PROFILE=launch forge test --match-path "forge-launch/test/HupLaunchLocker.t.sol" \
 *          --fork-url https://base-sepolia-rpc.publicnode.com -vv
 */
contract HupLaunchLockerForkTest is Test {
    using StateLibrary for IPoolManager;

    IPoolManager constant POOL_MANAGER = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408);
    address constant POSITION_MANAGER = 0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant HUP_CORE = 0xf6b33ecab0fa561300453c1bb1B520Ce544544ae;
    address constant FORWARDER = 0x18B86518709a6C0942F3adCD0CD528D1716e0A80;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint16 constant CREATOR_SHARE_BPS = 5_000;

    HupLaunch launchpad;
    HupLaunchLocker locker;
    SwapHelper router;

    address admin = makeAddr("admin");
    address creator = makeAddr("creator");
    address trader = makeAddr("trader");
    address compounder = makeAddr("compounder");

    function setUp() public {
        launchpad = new HupLaunch(HUP_CORE, FORWARDER, admin, address(POOL_MANAGER), POSITION_MANAGER, PERMIT2);
        locker = launchpad.locker();
        router = new SwapHelper(POOL_MANAGER);

        vm.deal(creator, 100 ether);
        vm.deal(trader, 100 ether);
        vm.deal(compounder, 100 ether);
        vm.deal(address(router), 100 ether);
    }

    // --- FIXTURE ---

    /// @dev A launch with real two-sided trading behind it, which is the only state in which the
    ///      locker has anything to split.
    function _tradedLaunch() internal returns (IHupLaunch.Launch memory launch, PoolKey memory key) {
        return _tradedLaunch(2 ether);
    }

    /// @param _volume How much native to push through the pool, which sets how large the accrued
    ///        fees are relative to any later liquidity add.
    function _tradedLaunch(uint256 _volume) internal returns (IHupLaunch.Launch memory launch, PoolKey memory key) {
        vm.prank(creator);
        uint256 launchId = launchpad.createLaunch(
            address(0), "Babe", "BAB", CREATOR_SHARE_BPS, address(0), "ipfs://x", address(0), 0
        );

        launch = launchpad.getLaunch(launchId);
        key = _keyFor(launch);

        // Buys pay the fee in the quote asset (native), sells pay it in the launch token, so both
        // sides of the locker's split have something to work on
        router.swap{value: _volume}(key, true, _volume, trader);

        uint256 held = IERC20(launch.token).balanceOf(trader);
        assertGt(held, 0, "fixture: trader bought nothing");

        vm.prank(trader);
        IERC20(launch.token).transfer(address(router), held / 2);
        router.swap(key, false, held / 2, trader);
    }

    /// @dev Stocks the compounder with the token side and returns the liquidity add to attempt.
    ///      Dealt rather than bought, so readying the compounder does not itself accrue the fees
    ///      the test is measuring.
    function _readyCompounder(PoolKey memory _key, uint256 _tokenId, uint256 _tokens, uint256 _growthBps)
        internal
        returns (uint128 add, uint256 tokenBudget)
    {
        address token = Currency.unwrap(_key.currency1);
        deal(token, compounder, _tokens);

        uint128 liquidityBefore = IPositionManager(POSITION_MANAGER).getPositionLiquidity(_tokenId);
        add = uint128((uint256(liquidityBefore) * _growthBps) / 10_000);
        tokenBudget = _tokens;

        vm.prank(compounder);
        IERC20(token).approve(address(locker), type(uint256).max);
    }

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

    // --- COLLECT ---

    /**
     * @dev The baseline the whole fee policy rests on: a bare collect credits the creator and the
     *      protocol in the quote asset, burns the configured share of the token side, and parks
     *      the remainder as the jar's bounty.
     */
    function test_collectSplitsQuoteFeesAndBurnsTheTokenSide() public {
        (IHupLaunch.Launch memory launch,) = _tradedLaunch();
        uint256 tokenId = launch.positionTokenId;

        uint256 burnedBefore = IERC20(launch.token).balanceOf(DEAD);

        locker.collect(tokenId);

        uint256 creatorCredit = locker.claimable(creator, address(0));
        uint256 protocolCredit = locker.claimable(admin, address(0));

        assertGt(creatorCredit, 0, "creator was credited nothing from the buy fees");
        assertGt(protocolCredit, 0, "protocol was credited nothing from the buy fees");

        // Creator takes 50%, protocol 10%, so the creator's cut is five times the protocol's
        assertApproxEqRel(creatorCredit, protocolCredit * 5, 0.01e18, "quote split is off");

        assertGt(locker.burned(tokenId), 0, "no sell fees were burned");
        assertEq(
            IERC20(launch.token).balanceOf(DEAD) - burnedBefore,
            locker.burned(tokenId),
            "burn ledger disagrees with the dead address"
        );

        assertGt(locker.pendingBounty0(tokenId) + locker.pendingBounty1(tokenId), 0, "jar got nothing");
    }

    /// @dev Collect is permissionless by design — a creator is never hostage to a compounder.
    function test_anyoneCanCollectAndItPaysThemNothing() public {
        (IHupLaunch.Launch memory launch,) = _tradedLaunch();

        address stranger = makeAddr("stranger");
        uint256 balanceBefore = stranger.balance;

        vm.prank(stranger);
        locker.collect(launch.positionTokenId);

        assertEq(stranger.balance, balanceBefore, "a bare collect must not pay its caller");
        assertGt(locker.claimable(creator, address(0)), 0, "collect credited no one");
    }

    // --- COMPOUND ---

    /**
     * @dev The one that matters. compound() adds liquidity to the locked position BEFORE it
     *      collects, and Uniswap v4 credits a position's accrued fees into the delta of any
     *      liquidity modification. If those fees land in the compounder's settlement rather than
     *      in the locker's split, the creator, the protocol and the burn are paid nothing and the
     *      compounder takes the lot — the fee policy silently bypassed by its own jar mechanism.
     */
    function test_compoundCannotSwallowTheCreatorAndProtocolSplit() public {
        // Two launches traded identically. One is harvested with collect(), the other with
        // compound(). Whatever the second pays out differently is the jar's doing, not the
        // fixture's — which is the only way to read the numbers below as a bug rather than as
        // a pool that simply never earned anything.
        (IHupLaunch.Launch memory viaCollect,) = _tradedLaunch(0.2 ether);
        (IHupLaunch.Launch memory viaCompound, PoolKey memory key) = _tradedLaunch(0.2 ether);

        // Control: the ordinary path credits everyone
        locker.collect(viaCollect.positionTokenId);
        uint256 controlCreator = locker.claimable(creator, address(0));
        uint256 controlBurn = locker.burned(viaCollect.positionTokenId);

        assertGt(controlCreator, 0, "control: collect credited the creator nothing");
        assertGt(controlBurn, 0, "control: collect burned nothing");

        // Subject: the same fees, harvested through the jar instead
        uint256 tokenId = viaCompound.positionTokenId;
        (uint128 add, uint256 tokenBudget) = _readyCompounder(key, tokenId, 50_000_000 ether, 500);

        uint256 creatorBefore = locker.claimable(creator, address(0));
        uint256 protocolBefore = locker.claimable(admin, address(0));

        vm.prank(compounder);
        locker.compound{value: 20 ether}(tokenId, add, uint128(20 ether), uint128(tokenBudget));

        assertGt(
            locker.claimable(creator, address(0)) - creatorBefore,
            0,
            "compound paid the creator nothing: fees were absorbed into the compounder's liquidity add"
        );
        assertGt(
            locker.claimable(admin, address(0)) - protocolBefore,
            0,
            "compound paid the protocol nothing: fees were absorbed into the compounder's liquidity add"
        );
        assertGt(locker.burned(tokenId), 0, "compound burned nothing of the sell fees");
    }

    /**
     * @dev The same absorption seen from the other side. While the increase ran first, a position
     *      that had earned more on a side than the add consumed there left that currency's delta
     *      positive and SETTLE_PAIR reverted with DeltaNotNegative — the jar unusable for exactly
     *      the positions it was designed for. Harvesting first removes the credit from the delta,
     *      so a fee-rich position is now the easy case rather than the impossible one.
     */
    function test_compoundWorksOnAFeeRichPosition() public {
        (IHupLaunch.Launch memory launch, PoolKey memory key) = _tradedLaunch(2 ether);
        uint256 tokenId = launch.positionTokenId;

        (uint128 add, uint256 tokenBudget) = _readyCompounder(key, tokenId, 50_000_000 ether, 25);

        vm.prank(compounder);
        locker.compound{value: 20 ether}(tokenId, add, uint128(20 ether), uint128(tokenBudget));

        assertGt(locker.claimable(creator, address(0)), 0, "fee-rich compound credited the creator nothing");
        assertGt(locker.burned(tokenId), 0, "fee-rich compound burned nothing");
    }

    /// @dev The jar's price of admission. Below 0.2% growth the pot stays put.
    function test_compoundRejectsAnUndersizedBounty() public {
        (IHupLaunch.Launch memory launch, PoolKey memory key) = _tradedLaunch();
        uint256 tokenId = launch.positionTokenId;

        router.swap{value: 1 ether}(key, true, 1 ether, compounder);

        uint128 liquidityBefore = IPositionManager(POSITION_MANAGER).getPositionLiquidity(tokenId);
        uint128 tooSmall = uint128((uint256(liquidityBefore) * 5) / 10_000);

        vm.prank(compounder);
        IERC20(launch.token).approve(address(locker), type(uint256).max);

        vm.prank(compounder);
        vm.expectRevert();
        locker.compound{value: 5 ether}(tokenId, tooSmall, uint128(5 ether), type(uint128).max);
    }

    /// @dev A compounder must not be able to walk away with more native than it put in plus the
    ///      pot it is owed — the refund path is measured against balances the locker holds for
    ///      other people.
    function test_compoundDoesNotDrainTheLockerForOtherPeoplesMoney() public {
        (IHupLaunch.Launch memory launch, PoolKey memory key) = _tradedLaunch();
        uint256 tokenId = launch.positionTokenId;

        // Bank a collect first, so the locker is holding money that belongs to the creator and
        // the protocol at the moment the compounder arrives
        locker.collect(tokenId);
        uint256 owedToOthers = locker.claimable(creator, address(0)) + locker.claimable(admin, address(0));
        assertGt(owedToOthers, 0, "fixture: nobody is owed anything");

        (uint128 add, uint256 tokenBudget) = _readyCompounder(key, tokenId, 50_000_000 ether, 500);

        vm.prank(compounder);
        locker.compound{value: 20 ether}(tokenId, add, uint128(20 ether), uint128(tokenBudget));

        // Whatever the compounder took, the creator and the protocol must still be able to draw
        // everything the ledger says they are owed
        uint256 creatorOwed = locker.claimable(creator, address(0));
        uint256 protocolOwed = locker.claimable(admin, address(0));

        assertGe(
            address(locker).balance,
            creatorOwed + protocolOwed,
            "locker cannot cover its own ledger after a compound"
        );

        vm.prank(creator);
        locker.claim(address(0), creator);

        vm.prank(admin);
        locker.claim(address(0), admin);
    }

    // --- CLAIM ---

    function test_claimEmptiesTheLedgerAndPays() public {
        (IHupLaunch.Launch memory launch,) = _tradedLaunch();
        locker.collect(launch.positionTokenId);

        uint256 owed = locker.claimable(creator, address(0));
        uint256 before = creator.balance;

        vm.prank(creator);
        locker.claim(address(0), creator);

        assertEq(creator.balance - before, owed, "claim paid the wrong amount");
        assertEq(locker.claimable(creator, address(0)), 0, "ledger row not cleared");

        vm.prank(creator);
        vm.expectRevert(HupLaunchLocker.NothingToClaim.selector);
        locker.claim(address(0), creator);
    }

    /// @dev claimFor exists so a recipient that cannot call claim itself is never a dead balance.
    ///      It must only ever push to the account it is settling.
    function test_claimForPushesOnlyToItsOwnAccount() public {
        (IHupLaunch.Launch memory launch,) = _tradedLaunch();
        locker.collect(launch.positionTokenId);

        uint256 owed = locker.claimable(creator, address(0));
        uint256 before = creator.balance;

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        locker.claimFor(creator, address(0));

        assertEq(creator.balance - before, owed, "claimFor did not pay the account it settled");
        assertEq(locker.claimable(creator, address(0)), 0, "ledger row not cleared");
    }

    // --- PERMANENCE ---

    /**
     * @dev "Locked forever" has to be a property of the code, not a promise. The locker exposes no
     *      path that moves the NFT or decreases its liquidity, and the PositionManager will not
     *      take instructions about it from anyone else.
     */
    function test_theLockedPositionCanNeverLeaveTheLocker() public {
        (IHupLaunch.Launch memory launch,) = _tradedLaunch();
        uint256 tokenId = launch.positionTokenId;

        assertEq(IERC721Minimal(POSITION_MANAGER).ownerOf(tokenId), address(locker), "position is not in the locker");

        // Neither the creator nor the admin can move it through the PositionManager
        address[2] memory pretenders = [creator, admin];
        for (uint256 i = 0; i < pretenders.length; i++) {
            vm.prank(pretenders[i]);
            (bool ok,) = POSITION_MANAGER.call(
                abi.encodeWithSignature(
                    "transferFrom(address,address,uint256)", address(locker), pretenders[i], tokenId
                )
            );
            assertFalse(ok, "an outsider moved the locked position");
        }

        assertEq(IERC721Minimal(POSITION_MANAGER).ownerOf(tokenId), address(locker), "position left the locker");
    }

    function test_registerIsFactoryOnly() public {
        (IHupLaunch.Launch memory launch,) = _tradedLaunch();

        vm.prank(admin);
        vm.expectRevert(HupLaunchLocker.Unauthorized.selector);
        locker.register(launch.positionTokenId, admin, admin, 5_000, true);
    }

    function test_feeRecipientIsCreatorOnlyAndDoesNotMoveEarnedFees() public {
        (IHupLaunch.Launch memory launch,) = _tradedLaunch();
        uint256 tokenId = launch.positionTokenId;

        locker.collect(tokenId);
        uint256 earnedBefore = locker.claimable(creator, address(0));
        assertGt(earnedBefore, 0, "fixture: creator earned nothing");

        address successor = makeAddr("successor");

        vm.prank(admin);
        vm.expectRevert(HupLaunchLocker.Unauthorized.selector);
        locker.setFeeRecipient(tokenId, successor);

        vm.prank(creator);
        locker.setFeeRecipient(tokenId, successor);

        // Already-earned fees stay with whoever earned them
        assertEq(locker.claimable(creator, address(0)), earnedBefore, "repointing moved money already earned");
    }
}
