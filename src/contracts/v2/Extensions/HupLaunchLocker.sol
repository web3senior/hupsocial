// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

/**
 * @title Hup Launch Locker
 * @author Hup Labs
 * @notice Holds every Hup Launch Uniswap position forever. "Liquidity locked forever" is not a
 *         timelock or a promise — this contract simply has no function that decreases liquidity
 *         or transfers a position out, so the principal is unreachable by construction.
 * @dev Fees auto-compound by the token-jar rule (Hayden Adams' pools.trade mechanism): anyone may
 *      claim a position's accumulated fees, provided they grow that position's liquidity by at
 *      least 0.2% with their own capital in the same call. Fees pile up; the moment they are worth
 *      more than the 0.2% add, claiming is profitable and a searcher compounds the pool unprompted
 *      — no keeper, no admin, no performance fee. On quiet chains Hup can call it manually; the
 *      rule is permissionless either way.
 *
 *      Where the fee lands decides who it pays. Uniswap charges the fee on a swap's input, so buys
 *      pay in the quote asset and sells pay in the launch token. That split is the whole fee
 *      policy here: the quote side is income, divided between the creator, the protocol, and the
 *      jar; the token side is supply, and a fixed share of it is burned outright. Sellers fund the
 *      burn, buyers fund the creator, and whatever is left in either currency deepens the pool.
 *
 *      Every share is immutable: the protocol's and the burn's at deployment, a creator's at the
 *      moment their launch is registered. There are no roles, no pause, and no rescue. The only
 *      thing anyone may change is where their own claim is delivered — the protocol recipient can
 *      hand its claim to a successor, and a creator can repoint theirs — which moves no money that
 *      was already earned. There is nothing to rug because there is nothing anyone, including Hup,
 *      can reach.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🔒
 */
contract HupLaunchLocker is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;

    // --- STATE VARIABLES ---

    uint256 public constant FEE_DENOMINATOR = 10_000;

    /// @notice Minimum liquidity growth a compounder must add to claim the fee pot: 0.2%.
    uint256 public constant MIN_COMPOUND_BOUNTY_BPS = 20;

    /// @notice Ceiling on the combined creator and protocol take of quote-side fees.
    uint256 public constant ABSOLUTE_MAX_TAKE_BPS = 9_000;

    IPositionManager public immutable positionManager;
    IPoolManager public immutable poolManager;
    IAllowanceTransfer public immutable permit2;

    /// @notice The HupLaunch factory that registers positions here. The only privileged caller,
    ///         and its only privilege is registration — never withdrawal.
    address public immutable launchpad;

    /// @notice Protocol share of quote-side fees, in bps of fees. Fixed at deployment.
    uint16 public immutable protocolShareBps;

    /// @notice Share of token-side fees burned on every collect, in bps of fees. Fixed at
    ///         deployment, and the burn is a transfer to the dead address, not a promise.
    uint16 public immutable burnShareBps;

    /// @notice Who may claim the protocol's share. Holds no other power, and may only ever hand
    ///         the claim to a successor.
    address public protocolRecipient;

    struct LockedPosition {
        address creator;
        /// @dev Where the creator's share is credited. The creator's own address unless they
        ///      pointed it somewhere else, which they may do at any time.
        address feeRecipient;
        /// @dev Creator's share of quote-side fees, in bps of fees (0 = opted out)
        uint16 creatorShareBps;
        /// @dev True when the quote asset sorts as the pool's currency0
        bool quoteIsCurrency0;
        bool registered;
    }

    /// @notice Maps a position NFT id to its lock record
    mapping(uint256 => LockedPosition) public lockedPositions;

    /// @notice Fees collected but not yet claimed by a compounder, per position, per currency.
    ///         This pot is the jar's bounty — it only ever grows until a compound empties it.
    mapping(uint256 => uint256) public pendingBounty0;
    mapping(uint256 => uint256) public pendingBounty1;

    /// @notice Claimable fees per account, per currency. Creators and the protocol draw from the
    ///         same ledger, because both are owed the quote asset the launch is priced in.
    mapping(address => mapping(address => uint256)) public claimable;

    /// @notice Total launch tokens burned out of sell fees, per position.
    mapping(uint256 => uint256) public burned;

    // --- EVENTS ---

    /// @notice Emitted when the factory locks a freshly minted position here.
    event PositionRegistered(
        uint256 indexed tokenId, address indexed creator, address indexed feeRecipient, uint16 creatorShareBps
    );

    /// @notice Emitted when a creator repoints where their share of fees is paid.
    event FeeRecipientUpdated(uint256 indexed tokenId, address indexed from, address indexed to);

    /// @notice Emitted on a collect: what the creator and protocol were credited, what was burned,
    ///         and what went to the bounty pot.
    event FeesCollected(
        uint256 indexed tokenId,
        address indexed caller,
        uint256 creatorCut,
        uint256 protocolCut,
        uint256 burnedAmount,
        uint256 bounty0,
        uint256 bounty1
    );

    /// @notice Emitted when a compounder grows the position and takes the pot.
    event Compounded(uint256 indexed tokenId, address indexed caller, uint128 liquidityAdded, uint256 paid0, uint256 paid1);

    /// @notice Emitted when an account withdraws accrued fees.
    event FeesClaimed(address indexed account, address indexed currency, address indexed receiver, uint256 amount);

    /// @notice Emitted when the protocol claim is handed to a successor.
    event ProtocolRecipientTransferred(address indexed from, address indexed to);

    // --- ERRORS ---

    error Unauthorized();
    error InvalidAddress();
    error InvalidShareBps();
    error NotRegistered();
    error AlreadyRegistered();
    error BountyTooSmall(uint256 added, uint256 required);
    error NothingToClaim();
    error TransferFailed();

    // --- LOGIC ---

    /// @param _positionManager The chain's Uniswap v4 PositionManager.
    /// @param _poolManager The chain's Uniswap v4 PoolManager.
    /// @param _permit2 The canonical Permit2 deployment.
    /// @param _protocolRecipient Initial holder of the protocol claim.
    /// @param _protocolShareBps Protocol share of quote-side fees, fixed forever.
    /// @param _burnShareBps Share of token-side fees burned on collect, fixed forever.
    constructor(
        address _positionManager,
        address _poolManager,
        address _permit2,
        address _protocolRecipient,
        uint16 _protocolShareBps,
        uint16 _burnShareBps
    ) {
        if (
            _positionManager == address(0) || _poolManager == address(0) || _permit2 == address(0)
                || _protocolRecipient == address(0)
        ) revert InvalidAddress();
        if (_protocolShareBps > ABSOLUTE_MAX_TAKE_BPS || _burnShareBps > FEE_DENOMINATOR) {
            revert InvalidShareBps();
        }

        positionManager = IPositionManager(_positionManager);
        poolManager = IPoolManager(_poolManager);
        permit2 = IAllowanceTransfer(_permit2);
        protocolRecipient = _protocolRecipient;
        protocolShareBps = _protocolShareBps;
        burnShareBps = _burnShareBps;
        launchpad = msg.sender;
    }

    /// @notice ERC721 receive hook — accepts position NFTs from the position manager only.
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(positionManager)) revert Unauthorized();
        return this.onERC721Received.selector;
    }

    /**
     * @notice Records a freshly locked position's fee routing. Factory-only, once per position.
     * @param _tokenId The position NFT id (already owned by this contract).
     * @param _creator The launch creator, primary wallet.
     * @param _feeRecipient Where the creator's share is credited.
     * @param _creatorShareBps Creator's share of quote-side fees in bps (0 = opted out).
     * @param _quoteIsCurrency0 True when the quote asset sorts as the pool's currency0.
     */
    function register(
        uint256 _tokenId,
        address _creator,
        address _feeRecipient,
        uint16 _creatorShareBps,
        bool _quoteIsCurrency0
    ) external {
        if (msg.sender != launchpad) revert Unauthorized();
        if (lockedPositions[_tokenId].registered) revert AlreadyRegistered();
        if (_creator == address(0) || _feeRecipient == address(0)) revert InvalidAddress();
        if (uint256(_creatorShareBps) + protocolShareBps > ABSOLUTE_MAX_TAKE_BPS) revert InvalidShareBps();

        lockedPositions[_tokenId] = LockedPosition({
            creator: _creator,
            feeRecipient: _feeRecipient,
            creatorShareBps: _creatorShareBps,
            quoteIsCurrency0: _quoteIsCurrency0,
            registered: true
        });

        emit PositionRegistered(_tokenId, _creator, _feeRecipient, _creatorShareBps);
    }

    /**
     * @notice Repoints where a launch's creator fee is paid. Creator-only, any number of times.
     * @dev The launch creator stays the authority forever — handing the fee to a splitter, a
     *      treasury or a co-founder is a payout instruction, never a transfer of control, so a
     *      creator can always take it back. Fees already credited stay with whoever earned them:
     *      this moves future collects only, and the previous recipient can still claim what they
     *      were owed.
     * @param _tokenId The locked position whose creator fee is being repointed.
     * @param _to The new recipient.
     */
    function setFeeRecipient(uint256 _tokenId, address _to) external {
        LockedPosition storage locked = lockedPositions[_tokenId];
        if (!locked.registered) revert NotRegistered();
        if (msg.sender != locked.creator) revert Unauthorized();
        if (_to == address(0)) revert InvalidAddress();

        address from = locked.feeRecipient;
        locked.feeRecipient = _to;

        emit FeeRecipientUpdated(_tokenId, from, _to);
    }

    /**
     * @notice Pulls a position's accrued fees out of the pool: credits the creator and protocol,
     *         burns the sell-fee share, and parks the remainder in the pot for the next compounder.
     * @dev Permissionless so creators are never hostage to a compounder showing up. Deliberately
     *      does NOT pay the caller: the only way to take the pot is compound().
     * @param _tokenId The locked position to collect for.
     */
    function collect(uint256 _tokenId) external nonReentrant {
        _collect(_tokenId, msg.sender);
    }

    /**
     * @notice The jar: grow the position by at least 0.2% with your own capital and the entire
     *         accumulated fee pot — freshly collected plus anything parked by earlier bare
     *         collects — is yours.
     * @dev Approve this contract for whichever pool currencies you are adding, and send native
     *      coin as value when one of them is native. Profitable exactly when the pot outweighs the
     *      0.2% add, which is what makes the compounding autonomous.
     * @param _tokenId The locked position to compound.
     * @param _liquidity Liquidity to add to the position.
     * @param _amount0Max Most of currency0 the caller will pay.
     * @param _amount1Max Most of currency1 the caller will pay.
     * @return liquidityAdded Liquidity actually minted into the position.
     */
    function compound(uint256 _tokenId, uint128 _liquidity, uint128 _amount0Max, uint128 _amount1Max)
        external
        payable
        nonReentrant
        returns (uint128 liquidityAdded)
    {
        LockedPosition memory locked = lockedPositions[_tokenId];
        if (!locked.registered) revert NotRegistered();

        uint128 liquidityBefore = positionManager.getPositionLiquidity(_tokenId);
        uint256 required = (uint256(liquidityBefore) * MIN_COMPOUND_BOUNTY_BPS) / FEE_DENOMINATOR;
        if (_liquidity == 0 || uint256(_liquidity) < required) revert BountyTooSmall(_liquidity, required);

        (PoolKey memory key,) = positionManager.getPoolAndPositionInfo(_tokenId);

        // Harvest before touching liquidity, never after: v4 credits a position's accrued fees
        // into the delta of any liquidity modification, so an increase running first settles
        // those fees against the compounder's own contribution and leaves the split nothing to
        // divide.
        _collect(_tokenId, msg.sender);

        // What the locker already owed other people before this call, the fees just collected
        // included. Native value sent with the call is already sitting in the balance, so it is
        // excluded here to keep the caller's own contribution out of everyone else's money.
        uint256 pre0 = key.currency0.balanceOfSelf() - (key.currency0.isAddressZero() ? msg.value : 0);
        uint256 pre1 = key.currency1.balanceOfSelf() - (key.currency1.isAddressZero() ? msg.value : 0);

        _pull(key.currency0, _amount0Max);
        _pull(key.currency1, _amount1Max);

        // SWEEP returns whatever the add did not consume, so an overshoot is refundable rather
        // than stranded in the position manager
        bytes memory actions = abi.encodePacked(
            uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP), uint8(Actions.SWEEP)
        );
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(_tokenId, _liquidity, _amount0Max, _amount1Max, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        params[2] = abi.encode(key.currency0, address(this));
        params[3] = abi.encode(key.currency1, address(this));

        uint256 nativeValue = key.currency0.isAddressZero() ? msg.value : 0;
        positionManager.modifyLiquidities{value: nativeValue}(abi.encode(actions, params), block.timestamp);

        liquidityAdded = positionManager.getPositionLiquidity(_tokenId) - liquidityBefore;
        if (uint256(liquidityAdded) < required) revert BountyTooSmall(liquidityAdded, required);

        // Measured against the pre-add balances, so the refund is the caller's own leftovers and
        // nothing that belongs to the creator, the protocol, or the pot
        uint256 refund0 = key.currency0.balanceOfSelf() - pre0;
        uint256 refund1 = key.currency1.balanceOfSelf() - pre1;

        uint256 paid0 = pendingBounty0[_tokenId];
        uint256 paid1 = pendingBounty1[_tokenId];
        pendingBounty0[_tokenId] = 0;
        pendingBounty1[_tokenId] = 0;

        if (paid0 + refund0 > 0) key.currency0.transfer(msg.sender, paid0 + refund0);
        if (paid1 + refund1 > 0) key.currency1.transfer(msg.sender, paid1 + refund1);

        emit Compounded(_tokenId, msg.sender, liquidityAdded, paid0, paid1);
    }

    /**
     * @notice Withdraws the caller's accrued fees in one currency.
     * @param _currency The asset to withdraw; address(0) for the chain native coin.
     * @param _receiver Where to send it.
     */
    function claim(address _currency, address _receiver) external nonReentrant {
        _claim(msg.sender, _currency, _receiver);
    }

    /**
     * @notice Pays an account its accrued fees, to itself.
     * @dev Permissionless, and deliberately without a receiver argument: it can only push what an
     *      account is already owed to that same account, so it redirects nothing. This is what
     *      lets a fee recipient be a contract that cannot call `claim` for itself — a payment
     *      split, a treasury — instead of a balance nobody can ever move.
     * @param _account Whose ledger row to settle.
     * @param _currency The asset to withdraw; address(0) for the chain native coin.
     */
    function claimFor(address _account, address _currency) external nonReentrant {
        _claim(_account, _currency, _account);
    }

    /**
     * @notice Hands the protocol claim to a successor. Callable only by the current holder, and it
     *         confers no power beyond claiming the protocol share of future collects.
     */
    function transferProtocolRecipient(address _to) external {
        if (msg.sender != protocolRecipient) revert Unauthorized();
        if (_to == address(0)) revert InvalidAddress();

        protocolRecipient = _to;

        emit ProtocolRecipientTransferred(msg.sender, _to);
    }

    // --- INTERNAL HELPERS ---

    /// @dev Empties one ledger row and pays it out. Native transfers forward all gas, so a smart
    ///      contract account with receive logic is never broken by a stipend.
    function _claim(address _account, address _currency, address _receiver) internal {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 amount = claimable[_account][_currency];
        if (amount == 0) revert NothingToClaim();

        claimable[_account][_currency] = 0;
        Currency.wrap(_currency).transfer(_receiver, amount);

        emit FeesClaimed(_account, _currency, _receiver, amount);
    }

    /**
     * @dev Collects a position's owed fees from the pool into this contract, splits the quote side
     *      between the creator, the protocol and the pot, and burns the configured share of the
     *      token side before the rest joins the pot.
     */
    function _collect(uint256 _tokenId, address _caller) internal {
        LockedPosition memory locked = lockedPositions[_tokenId];
        if (!locked.registered) revert NotRegistered();

        (PoolKey memory key,) = positionManager.getPoolAndPositionInfo(_tokenId);

        uint256 before0 = key.currency0.balanceOfSelf();
        uint256 before1 = key.currency1.balanceOfSelf();

        // A zero-liquidity decrease is how v4 says "pay me only what the position has earned"
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(_tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, address(this));

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        uint256 collected0 = key.currency0.balanceOfSelf() - before0;
        uint256 collected1 = key.currency1.balanceOfSelf() - before1;

        (uint256 quoteCollected, uint256 tokenCollected) =
            locked.quoteIsCurrency0 ? (collected0, collected1) : (collected1, collected0);

        address quoteCurrency =
            Currency.unwrap(locked.quoteIsCurrency0 ? key.currency0 : key.currency1);
        Currency tokenCurrency = locked.quoteIsCurrency0 ? key.currency1 : key.currency0;

        // Buys pay in the quote asset: income, split creator / protocol / jar
        uint256 creatorCut = (quoteCollected * locked.creatorShareBps) / FEE_DENOMINATOR;
        uint256 protocolCut = (quoteCollected * protocolShareBps) / FEE_DENOMINATOR;
        if (creatorCut > 0) claimable[locked.feeRecipient][quoteCurrency] += creatorCut;
        if (protocolCut > 0) claimable[protocolRecipient][quoteCurrency] += protocolCut;

        // Sells pay in the launch token: supply, so a fixed share of it stops existing
        uint256 burnAmount = (tokenCollected * burnShareBps) / FEE_DENOMINATOR;
        if (burnAmount > 0) {
            burned[_tokenId] += burnAmount;
            tokenCurrency.transfer(address(0xdEaD), burnAmount);
        }

        uint256 quoteToPot = quoteCollected - creatorCut - protocolCut;
        uint256 tokenToPot = tokenCollected - burnAmount;

        (uint256 bounty0, uint256 bounty1) =
            locked.quoteIsCurrency0 ? (quoteToPot, tokenToPot) : (tokenToPot, quoteToPot);
        pendingBounty0[_tokenId] += bounty0;
        pendingBounty1[_tokenId] += bounty1;

        emit FeesCollected(_tokenId, _caller, creatorCut, protocolCut, burnAmount, bounty0, bounty1);
    }

    /// @dev Draws a compounder's contribution in and readies it for the position manager to take.
    function _pull(Currency _currency, uint128 _amount) internal {
        if (_amount == 0 || _currency.isAddressZero()) return;

        address token = Currency.unwrap(_currency);
        IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);
        IERC20(token).forceApprove(address(permit2), _amount);
        permit2.approve(token, address(positionManager), _amount, uint48(block.timestamp));
    }

    /// @dev Accepts native coin from the pool manager on collects and from compounders as value.
    receive() external payable {}
}
