// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IUniswapV3Minimal.sol";

/**
 * @title Hup Launch Locker
 * @author Hup Labs
 * @notice Holds every Hup Launch Uniswap position forever. "Liquidity locked forever" is not a
 *         timelock or a promise — this contract simply has no function that decreases liquidity
 *         or transfers a position out, so the principal is unreachable by construction.
 * @dev Fees auto-compound by the token-jar rule (Hayden Adams' pools.trade mechanism): anyone
 *      may claim a position's accumulated LP fees, provided they grow that position's liquidity
 *      by at least 0.2% with their own capital in the same call. Fees pile up; the moment they
 *      are worth more than the 0.2% add, claiming is profitable and a searcher compounds the
 *      pool unprompted — no keeper, no admin, no performance fee. On quiet chains Hup can call
 *      it manually; the rule is permissionless either way.
 *
 *      The creator's cut mirrors pools.trade's "5bps of the LP fee on each buy, paid in ETH":
 *      v3 charges its fee on the swap's input token, so buy fees accrue on the WNATIVE side and
 *      sell fees on the token side. The creator's share is therefore taken from the native side
 *      only — sellers never pay the creator — booked to a pull ledger, and unwrapped to native
 *      coin on claim.
 *
 *      This contract is deliberately admin-free: no roles, no pause, no rescue. There is nothing
 *      to rug because there is nothing anyone — including Hup — can reach.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🔒
 */
contract HupLaunchLocker is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    uint256 public constant FEE_DENOMINATOR = 10_000;

    /// @notice Minimum liquidity growth a compounder must add to claim the fee pot: 0.2%.
    uint256 public constant MIN_COMPOUND_BOUNTY_BPS = 20;

    INonfungiblePositionManagerMinimal public immutable positionManager;
    IWETH9Minimal public immutable wnative;

    /// @notice The HupLaunch factory that registers positions here. The only privileged caller,
    ///         and its only privilege is registration — never withdrawal.
    address public immutable launchpad;

    struct LockedPosition {
        address creator;
        /// @dev Creator's share of native-side collected fees, in bps of fees (0 = opted out)
        uint16 creatorShareBps;
        /// @dev True when WNATIVE is the pool's token0 — decides which collect leg is "native"
        bool nativeIsToken0;
        bool registered;
    }

    /// @notice Maps a position NFT id to its lock record
    mapping(uint256 => LockedPosition) public lockedPositions;

    /// @notice Fees collected but not yet claimed by a compounder, per position, per pool token.
    ///         This pot is the jar's bounty — it only ever grows until a compound empties it.
    mapping(uint256 => uint256) public pendingBounty0;
    mapping(uint256 => uint256) public pendingBounty1;

    /// @notice A creator's claimable native-side fees, held as WNATIVE and unwrapped on claim
    mapping(address => uint256) public creatorFees;

    // --- EVENTS ---

    /// @notice Emitted when the factory locks a freshly minted position here.
    event PositionRegistered(uint256 indexed tokenId, address indexed creator, uint16 creatorShareBps);

    /// @notice Emitted on a bare collect: fees moved from the pool into the bounty pot.
    event FeesCollected(uint256 indexed tokenId, address indexed caller, uint256 creatorCut, uint256 bounty0, uint256 bounty1);

    /// @notice Emitted when a compounder grows the position and takes the pot. The creator's cut
    ///         of the same collect is reported by the paired FeesCollected event.
    event Compounded(uint256 indexed tokenId, address indexed caller, uint128 liquidityAdded, uint256 paid0, uint256 paid1);

    /// @notice Emitted when a creator withdraws their accrued fee share, in native coin.
    event CreatorFeesClaimed(address indexed creator, address indexed receiver, uint256 amount);

    // --- ERRORS ---

    error Unauthorized();
    error InvalidAddress();
    error NotRegistered();
    error AlreadyRegistered();
    error BountyTooSmall(uint256 added, uint256 required);
    error NothingToClaim();
    error TransferFailed();

    // --- LOGIC ---

    /// @param _positionManager The chain's Uniswap NonfungiblePositionManager.
    /// @param _wnative The chain's canonical wrapped-native token.
    constructor(address _positionManager, address _wnative) {
        if (_positionManager == address(0) || _wnative == address(0)) revert InvalidAddress();

        positionManager = INonfungiblePositionManagerMinimal(_positionManager);
        wnative = IWETH9Minimal(_wnative);
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
     * @param _creatorShareBps Creator's share of native-side fees in bps of fees (0 = opted out).
     * @param _nativeIsToken0 True when WNATIVE sorts as the pool's token0.
     */
    function register(uint256 _tokenId, address _creator, uint16 _creatorShareBps, bool _nativeIsToken0) external {
        if (msg.sender != launchpad) revert Unauthorized();
        if (lockedPositions[_tokenId].registered) revert AlreadyRegistered();

        lockedPositions[_tokenId] = LockedPosition({
            creator: _creator,
            creatorShareBps: _creatorShareBps,
            nativeIsToken0: _nativeIsToken0,
            registered: true
        });

        emit PositionRegistered(_tokenId, _creator, _creatorShareBps);
    }

    /**
     * @notice Pulls a position's accrued LP fees out of the pool: books the creator's cut and
     *         parks the remainder in the bounty pot for the next compounder.
     * @dev Permissionless so creators are never hostage to a compounder showing up — their cut
     *      books on any collect. Deliberately does NOT pay the caller: the only way to take the
     *      pot is compound(), which requires growing the position first.
     * @param _tokenId The locked position to collect for.
     */
    function collect(uint256 _tokenId) external nonReentrant {
        _collect(_tokenId, msg.sender);
    }

    /**
     * @notice The jar: grow the position by at least 0.2% with your own tokens and the entire
     *         accumulated fee pot — freshly collected plus anything parked by earlier bare
     *         collects — is yours.
     * @dev The caller must approve this contract for both pool tokens first (the native side as
     *      WNATIVE). Unused amounts are refunded, so overshooting the desired amounts is safe.
     *      Profitable exactly when the pot outweighs the 0.2% add — which is what makes the
     *      compounding autonomous.
     * @param _tokenId The locked position to compound.
     * @param _amount0Desired Token0 the caller offers toward the liquidity add.
     * @param _amount1Desired Token1 the caller offers toward the liquidity add.
     * @return liquidityAdded Liquidity actually minted into the position.
     */
    function compound(uint256 _tokenId, uint256 _amount0Desired, uint256 _amount1Desired)
        external
        nonReentrant
        returns (uint128 liquidityAdded)
    {
        LockedPosition memory locked = lockedPositions[_tokenId];
        if (!locked.registered) revert NotRegistered();
        if (_amount0Desired == 0 && _amount1Desired == 0) revert BountyTooSmall(0, 1);

        (, , address token0, address token1, , , , uint128 liquidityBefore, , , , ) = positionManager.positions(_tokenId);

        // Pull the caller's contribution and let the position manager draw from it
        if (_amount0Desired > 0) {
            IERC20(token0).safeTransferFrom(msg.sender, address(this), _amount0Desired);
            IERC20(token0).forceApprove(address(positionManager), _amount0Desired);
        }
        if (_amount1Desired > 0) {
            IERC20(token1).safeTransferFrom(msg.sender, address(this), _amount1Desired);
            IERC20(token1).forceApprove(address(positionManager), _amount1Desired);
        }

        (uint128 added, uint256 used0, uint256 used1) = positionManager.increaseLiquidity(
            INonfungiblePositionManagerMinimal.IncreaseLiquidityParams({
                tokenId: _tokenId,
                amount0Desired: _amount0Desired,
                amount1Desired: _amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            })
        );

        uint256 required = (uint256(liquidityBefore) * MIN_COMPOUND_BOUNTY_BPS) / FEE_DENOMINATOR;
        if (uint256(added) < required || added == 0) revert BountyTooSmall(added, required);

        // Fresh fees join the parked pot, creator cut booked along the way
        _collect(_tokenId, msg.sender);

        uint256 paid0 = pendingBounty0[_tokenId];
        uint256 paid1 = pendingBounty1[_tokenId];
        pendingBounty0[_tokenId] = 0;
        pendingBounty1[_tokenId] = 0;

        // Pot plus refund of whatever the liquidity add didn't consume
        uint256 refund0 = _amount0Desired - used0;
        uint256 refund1 = _amount1Desired - used1;
        if (paid0 + refund0 > 0) IERC20(token0).safeTransfer(msg.sender, paid0 + refund0);
        if (paid1 + refund1 > 0) IERC20(token1).safeTransfer(msg.sender, paid1 + refund1);

        emit Compounded(_tokenId, msg.sender, added, paid0, paid1);

        return added;
    }

    /**
     * @notice Withdraws the caller's accrued creator fees, unwrapped to native coin.
     * @param _receiver Where to send the native coin.
     */
    function claimCreatorFees(address _receiver) external nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 amount = creatorFees[msg.sender];
        if (amount == 0) revert NothingToClaim();

        creatorFees[msg.sender] = 0;
        wnative.withdraw(amount);

        (bool success, ) = _receiver.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit CreatorFeesClaimed(msg.sender, _receiver, amount);
    }

    // --- INTERNAL HELPERS ---

    /**
     * @dev Collects a position's owed fees from the pool into this contract, books the creator's
     *      native-side cut, and adds the remainder to the bounty pot.
     */
    function _collect(uint256 _tokenId, address _caller) internal {
        LockedPosition memory locked = lockedPositions[_tokenId];
        if (!locked.registered) revert NotRegistered();

        (uint256 collected0, uint256 collected1) = positionManager.collect(
            INonfungiblePositionManagerMinimal.CollectParams({
                tokenId: _tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        uint256 nativeCollected = locked.nativeIsToken0 ? collected0 : collected1;
        uint256 creatorCut = (nativeCollected * locked.creatorShareBps) / FEE_DENOMINATOR;
        if (creatorCut > 0) creatorFees[locked.creator] += creatorCut;

        uint256 bounty0 = collected0 - (locked.nativeIsToken0 ? creatorCut : 0);
        uint256 bounty1 = collected1 - (locked.nativeIsToken0 ? 0 : creatorCut);
        pendingBounty0[_tokenId] += bounty0;
        pendingBounty1[_tokenId] += bounty1;

        emit FeesCollected(_tokenId, _caller, creatorCut, bounty0, bounty1);
    }

    /// @dev Accepts native coin only from WNATIVE unwrapping during claimCreatorFees.
    receive() external payable {
        if (msg.sender != address(wnative)) revert Unauthorized();
    }
}
