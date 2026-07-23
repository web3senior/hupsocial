// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IHupPredict.sol";
import "./ILSP7Minimal.sol";

/**
 * @title Hup Predict
 * @author Hup Labs
 * @notice Extension contract powering friendly parimutuel prediction markets on Hup. A creator
 *         opens a multi-outcome market with a judge panel; bettors stake native coins, ERC20, or
 *         LSP7 tokens into per-outcome pools; when a judge resolves, winners split the whole pot
 *         pro-rata minus a protocol fee snapshotted at creation. Cancellation, an empty winning
 *         pool, or judge inaction past the resolve window all flip the market to full refunds,
 *         so stakes can never be stranded.
 * @dev Uses IHupPredict for shared structs, events, errors, and view signatures. Integrates with
 *      Hup Core via IHup only to resolve burner session keys to primary wallets. Supports
 *      rotatable ERC2771 trusted forwarders for meta-transactions, AccessControl for
 *      admin/moderator permissions, Pausable for emergency controls, and ReentrancyGuard for
 *      protected staking and settlement. All payouts are pull-based via claim(); resolution is
 *      O(1) regardless of bettor count. Fee-on-transfer/deflationary tokens are unsupported: the
 *      contract escrows gross stakes and pays out computed shares, so a transfer tax would eat
 *      into other bettors' funds. Winner payouts use floor division; the dust (at most
 *      winnerCount - 1 wei per market) stays in the contract.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🎯
 */
contract HupPredict is IHupPredict, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_FEE_BPS = 1_000;
    uint256 public constant MIN_RESOLVE_WINDOW = 1 days;
    uint256 public constant MAX_RESOLVE_WINDOW = 90 days;
    uint256 public constant MAX_OUTCOME_COUNT = 16;
    uint256 public constant MAX_JUDGES = 8;
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2_048;

    /// @notice The Hup Core contract instance (burner session resolution only). Admin-rotatable
    ///         so a Hup Core redeploy doesn't strand live markets behind a stale session source.
    IHup public hupContract;

    /// @notice Maps market id to its market
    mapping(uint256 => Market) private _markets;

    /// @notice The id the next market will receive; ids start at 1 so 0 means "not found"
    uint256 public nextMarketId = 1;

    /// @notice Maps market id to its judge panel (any listed judge can close/resolve/cancel)
    mapping(uint256 => address[]) private _judges;

    /// @notice Maps market id to judge address to panel membership (pending or confirmed)
    mapping(uint256 => mapping(address => bool)) public isJudge;

    /// @notice Maps market id to judge address to role acceptance. Listing attaches a name;
    ///         only confirming grants power — unconfirmed judges cannot close, resolve, or
    ///         cancel, so nobody judges a market they never agreed to.
    mapping(uint256 => mapping(address => bool)) public judgeConfirmed;

    /// @notice Maps market id to outcome id to that outcome's pool
    mapping(uint256 => mapping(uint8 => uint256)) public outcomePools;

    /// @notice Maps market id to bettor to outcome id to that bettor's stake on the outcome
    mapping(uint256 => mapping(address => mapping(uint8 => uint256))) public stakes;

    /// @notice Maps market id to bettor to their total stake across all outcomes
    mapping(uint256 => mapping(address => uint256)) public totalStakeOf;

    /// @notice Maps market id to bettor to whether they have claimed winnings or a refund
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    /// @notice Protocol fees accrued from resolved pots, per stake token (address(0) = native).
    ///         Tracked separately from escrowed pools so admin withdrawal can never touch stakes.
    mapping(address => uint256) public accruedFees;

    /// @notice Remembers the LSP7 flag of every token ever used, so fee withdrawal transfers
    ///         with the right standard without trusting an admin-supplied flag
    mapping(address => bool) public isLsp7Token;

    /// @notice True once a token's standard was proven by a successful stake transfer. Locking
    ///         on proof (not on creation) means a wrong flag can never stick — it would have
    ///         reverted the transfer — and nobody can poison a token by front-registering it.
    mapping(address => bool) private _tokenTypeLocked;

    mapping(address => bool) public trustedForwarders;

    /// @notice Platform fee in basis points snapshotted into newly created markets (100 = 1%)
    uint256 public predictFeeBps = 100;

    /// @notice Creator fee in basis points snapshotted into newly created markets (100 = 1%).
    ///         Taken from resolved pots only — canceled and refunded markets pay no fees, so
    ///         cancellation is never profitable for a creator.
    uint256 public creatorFeeBps = 100;

    /// @notice Maps creator to stake token to their claimable accrued creator fees. A separate
    ///         pull-based ledger like accruedFees, so escrowed pools are never touched.
    mapping(address => mapping(address => uint256)) public creatorFees;

    /// @notice Surcharge (in native wei) for the featured tier — paid at creation or via
    ///         upgradeToFeatured. Accrues to the fee ledger, never to the escrowed pools.
    uint256 public featuredFee = 0;

    /// @notice How long judges have to resolve after betting ends before anyone can enable
    ///         refunds. Applies from closedAt when betting was closed early, otherwise from the
    ///         betting deadline.
    uint256 public resolveWindow = 7 days;

    /// @notice The maximum allowed byte length for a market's metadata field
    uint256 public maxMetadataBytes = 256;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    modifier onlyDirectModerator() {
        if (!hasRole(MODERATOR_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the predict contract.
     * @param _hupAddress Address of the deployed core Hup contract.
     * @param _trustedForwarder Address of the initial EIP-2771 trusted forwarder (or address(0) to skip).
     * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     */
    constructor(address _hupAddress, address _trustedForwarder, address _admin) ERC2771Context(_trustedForwarder) {
        if (_hupAddress == address(0) || _admin == address(0)) revert InvalidAddress();

        hupContract = IHup(_hupAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        if (_trustedForwarder != address(0)) {
            trustedForwarders[_trustedForwarder] = true;
            emit TrustedForwarderUpdated(_trustedForwarder, true);
        }
    }

    // --- MUTATIVE LOGIC ---

    function createMarket(
        address _owner,
        address _token,
        bool _isTokenLsp7,
        uint64 _bettingOpensAt,
        uint64 _bettingDeadline,
        uint8 _outcomeCount,
        bool _featured,
        address[] calldata _judgeList,
        string calldata _metadata
    ) external payable whenNotPaused returns (uint256 marketId) {
        // Creation itself stays free; the only payment ever due here is the featured surcharge
        if (msg.value != (_featured ? featuredFee : 0)) revert InsufficientFee();
        if (bytes(_metadata).length == 0) revert InvalidMetadata();
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }
        if (_bettingDeadline <= block.timestamp) revert InvalidDeadline();
        // A future open time carves an upcoming phase out of the window; it must leave
        // room to actually bet. Past or zero open times mean betting starts immediately.
        if (_bettingOpensAt >= _bettingDeadline) revert InvalidDeadline();
        if (_outcomeCount < 2 || _outcomeCount > MAX_OUTCOME_COUNT) revert InvalidOutcomeCount();
        if (_judgeList.length > MAX_JUDGES) revert InvalidJudges();

        address creator = _resolveActor(_owner);
        bool isTokenLsp7 = _token != address(0) && _isTokenLsp7;

        if (_token != address(0)) {
            // Once the standard is proven (first successful bet), conflicting markets are
            // rejected outright instead of being born unbettable; before proof the flag is
            // just a hint the first working transfer will confirm or correct
            if (_tokenTypeLocked[_token]) {
                if (isLsp7Token[_token] != isTokenLsp7) revert TokenStandardMismatch();
            } else {
                isLsp7Token[_token] = isTokenLsp7;
            }
        }

        marketId = nextMarketId++;

        _markets[marketId] = Market({
            creator: creator,
            token: _token,
            isTokenLsp7: isTokenLsp7,
            bettingOpensAt: _bettingOpensAt,
            bettingDeadline: _bettingDeadline,
            closedAt: 0,
            outcomeCount: _outcomeCount,
            winningOutcome: 0,
            state: MarketState.Open,
            feeBps: uint16(predictFeeBps),
            creatorFeeBps: uint16(creatorFeeBps),
            featured: _featured,
            hidden: false,
            totalPool: 0,
            metadata: _metadata
        });

        // An empty panel defaults to the creator judging their own market — the screenshot case.
        // Creating a market is consent: the creator self-confirms; everyone else starts pending.
        if (_judgeList.length == 0) {
            _judges[marketId].push(creator);
            isJudge[marketId][creator] = true;
            judgeConfirmed[marketId][creator] = true;
        } else {
            for (uint256 i = 0; i < _judgeList.length; i++) {
                address judge = _judgeList[i];
                if (judge == address(0)) revert InvalidAddress();
                if (isJudge[marketId][judge]) revert InvalidJudges();

                _judges[marketId].push(judge);
                isJudge[marketId][judge] = true;
                if (judge == creator) judgeConfirmed[marketId][judge] = true;
            }
        }

        emit MarketCreated(marketId, creator, _token, isTokenLsp7, _bettingOpensAt, _bettingDeadline, _outcomeCount, uint16(predictFeeBps), uint16(creatorFeeBps), _judges[marketId], _metadata);

        // Emitted after MarketCreated so log-order indexers see the market before its flag
        if (_featured) {
            // The surcharge joins the fee ledger — the escrowed pools never see it
            if (msg.value > 0) accruedFees[address(0)] += msg.value;

            emit MarketFeatured(marketId, msg.value);
        }
    }

    function placeBet(address _owner, uint256 _marketId, uint8 _outcome, uint256 _amount) external payable whenNotPaused nonReentrant {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        if (market.hidden) revert MarketInactive();
        if (market.state != MarketState.Open) revert MarketNotOpen();
        if (block.timestamp < market.bettingOpensAt) revert BettingNotOpen();
        if (block.timestamp >= market.bettingDeadline) revert BettingDeadlinePassed();
        if (_outcome >= market.outcomeCount) revert InvalidOutcome();
        if (_amount == 0) revert InvalidAmount();

        address bettor = _resolveActor(_owner);
        address token = market.token;

        if (token == address(0)) {
            if (msg.value != _amount) revert InsufficientPayment(msg.value, _amount);
        } else {
            if (msg.value != 0) revert UnexpectedNativePayment();
        }

        stakes[_marketId][bettor][_outcome] += _amount;
        totalStakeOf[_marketId][bettor] += _amount;
        outcomePools[_marketId][_outcome] += _amount;
        market.totalPool += _amount;

        if (token != address(0)) {
            // Exact-amount escrow: the pools were credited `_amount`, and the token escrow is
            // shared across every market staking this token, so a transfer that delivers fewer
            // units (fee-on-transfer and similar) would default on other markets' claimants.
            // LSP7 shares ERC20's balanceOf(address) selector, so one read covers both.
            uint256 balanceBefore = IERC20(token).balanceOf(address(this));
            if (market.isTokenLsp7) {
                // LSP7 (LUKSO): bettor must have called authorizeOperator(predict contract, amount)
                ILSP7Minimal(token).transfer(bettor, address(this), _amount, true, "");
            } else {
                IERC20(token).safeTransferFrom(bettor, address(this), _amount);
            }
            if (IERC20(token).balanceOf(address(this)) - balanceBefore != _amount) revert UnsupportedToken();

            // The transfer above succeeded under this market's flag — that PROVES the token's
            // standard, so lock it for fee withdrawal and future market creation
            if (!_tokenTypeLocked[token]) {
                _tokenTypeLocked[token] = true;
                isLsp7Token[token] = market.isTokenLsp7;
            }
        }

        emit BetPlaced(_marketId, bettor, _outcome, _amount, outcomePools[_marketId][_outcome], market.totalPool);
    }

    function closeBetting(uint256 _marketId) external whenNotPaused {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        if (market.state != MarketState.Open) revert MarketNotOpen();

        // Raw msg.sender on purpose — every market-control action must be signed by the
        // actor's own key; neither burner sessions nor ERC2771 forwarders are honored
        address actor = msg.sender;
        if (actor != market.creator && !judgeConfirmed[_marketId][actor]) revert NotJudge();

        // Closing after the deadline anchors on the deadline so a late close can never push the
        // refund-eligibility time further out than judge inaction would have
        uint64 closedAt = uint64(block.timestamp) < market.bettingDeadline ? uint64(block.timestamp) : market.bettingDeadline;

        market.state = MarketState.Closed;
        market.closedAt = closedAt;

        emit BettingClosed(_marketId, actor, closedAt);
    }

    function resolve(uint256 _marketId, uint8 _winningOutcome) external whenNotPaused {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        if (_winningOutcome >= market.outcomeCount) revert InvalidOutcome();

        // Resolvable once betting can no longer continue: explicitly closed, or deadline passed
        bool closable = market.state == MarketState.Open && block.timestamp >= market.bettingDeadline;
        if (market.state != MarketState.Closed && !closable) revert MarketNotResolvable();

        // Raw msg.sender on purpose — verdicts must be signed by the judge's own key, so
        // neither burner sessions nor ERC2771 forwarders are honored here
        address judge = msg.sender;
        if (!judgeConfirmed[_marketId][judge]) revert NotJudge();

        uint256 winningPool = outcomePools[_marketId][_winningOutcome];

        // Nobody backed the actual outcome — there is no winner to pay, so refund everyone
        if (winningPool == 0 && market.totalPool > 0) {
            market.state = MarketState.Refunding;

            emit RefundsEnabled(_marketId, judge);
            return;
        }

        uint256 feeAmount = (market.totalPool * market.feeBps) / FEE_DENOMINATOR;
        uint256 creatorFeeAmount = (market.totalPool * market.creatorFeeBps) / FEE_DENOMINATOR;

        market.state = MarketState.Resolved;
        market.winningOutcome = _winningOutcome;

        if (feeAmount > 0) {
            accruedFees[market.token] += feeAmount;
        }
        if (creatorFeeAmount > 0) {
            creatorFees[market.creator][market.token] += creatorFeeAmount;

            emit CreatorFeeAccrued(_marketId, market.creator, market.token, creatorFeeAmount);
        }

        emit MarketResolved(_marketId, _winningOutcome, judge, feeAmount);
    }

    function cancelMarket(uint256 _marketId) external whenNotPaused {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        if (market.state != MarketState.Open && market.state != MarketState.Closed) revert MarketNotRefundable();

        // Raw msg.sender on purpose — see closeBetting
        address actor = msg.sender;
        if (actor != market.creator && !judgeConfirmed[_marketId][actor]) revert NotJudge();

        market.state = MarketState.Refunding;

        emit MarketCanceled(_marketId, actor);
    }

    // Deliberately NOT pausable, like claim(): pause can never strand escrow. Whatever
    // happens to judges or admins, once the resolve window lapses anyone can flip the
    // market to Refunding and every bettor can exit in full.
    function enableRefunds(uint256 _marketId) external {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();

        uint256 eligibleAt = _refundEligibleAt(market);
        if (eligibleAt == 0 || block.timestamp < eligibleAt) revert MarketNotRefundable();

        market.state = MarketState.Refunding;

        emit RefundsEnabled(_marketId, msg.sender);
    }

    function claim(address _owner, uint256 _marketId) external nonReentrant {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();

        address account = _resolveActor(_owner);
        if (hasClaimed[_marketId][account]) revert AlreadyClaimed();

        uint256 amount;

        if (market.state == MarketState.Resolved) {
            uint256 winningStake = stakes[_marketId][account][market.winningOutcome];
            if (winningStake == 0) revert NothingToClaim();

            // Winners split the whole pot minus the platform and creator fees, pro-rata by
            // winning stake. Each fee floors separately — exactly what resolve() accrued.
            uint256 distributable = market.totalPool -
                (market.totalPool * market.feeBps) / FEE_DENOMINATOR -
                (market.totalPool * market.creatorFeeBps) / FEE_DENOMINATOR;
            amount = (winningStake * distributable) / outcomePools[_marketId][market.winningOutcome];
        } else if (market.state == MarketState.Refunding) {
            amount = totalStakeOf[_marketId][account];
            if (amount == 0) revert NothingToClaim();
        } else {
            revert NothingToClaim();
        }

        hasClaimed[_marketId][account] = true;

        _payout(market.token, market.isTokenLsp7, account, amount);

        if (market.state == MarketState.Resolved) {
            emit WinningsClaimed(_marketId, account, amount);
        } else {
            emit RefundClaimed(_marketId, account, amount);
        }
    }

    // Deliberately NOT pausable, like claim(): earned fees are the creator's money and a
    // pause can never strand them.
    function claimCreatorFees(address _owner, address _token) external nonReentrant {
        address creator = _resolveActor(_owner);

        uint256 amount = creatorFees[creator][_token];
        if (amount == 0) revert NothingToClaim();

        creatorFees[creator][_token] = 0;

        // Fees only accrue from resolved pots, which require bets — so the token's standard
        // flag is always proven-locked by the time anything is claimable here
        _payout(_token, _token != address(0) && isLsp7Token[_token], creator, amount);

        emit CreatorFeesClaimed(creator, _token, amount);
    }

    function confirmJudging(uint256 _marketId) external whenNotPaused {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        // Confirming stays open while the market can still be judged — even after betting
        // closed, a late acceptance is exactly what rescues an unresolved market
        if (market.state != MarketState.Open && market.state != MarketState.Closed) revert MarketNotOpen();

        // Raw msg.sender on purpose — consent must come from the judge's own key ─ so this can't be gasless
        address judge = msg.sender;
        if (!isJudge[_marketId][judge]) revert NotJudge();
        if (judgeConfirmed[_marketId][judge]) revert AlreadyConfirmed();

        judgeConfirmed[_marketId][judge] = true;

        emit JudgeConfirmed(_marketId, judge);
    }

    // Also not pausable: a judge can always detach their name and power from a market,
    // and the last judge leaving a funded market opens refunds — pause blocks neither.
    function renounceJudge(uint256 _marketId) external {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        if (market.state != MarketState.Open && market.state != MarketState.Closed) revert MarketNotOpen();

        // Raw msg.sender on purpose — see closeBetting
        address judge = msg.sender;
        if (!isJudge[_marketId][judge]) revert NotJudge();

        // Unlike creator removal, stepping down is allowed even after bets exist — it can
        // only reduce judging power, never redirect funds
        address[] storage panel = _judges[_marketId];
        for (uint256 i = 0; i < panel.length; i++) {
            if (panel[i] == judge) {
                panel[i] = panel[panel.length - 1];
                panel.pop();
                break;
            }
        }
        isJudge[_marketId][judge] = false;
        judgeConfirmed[_marketId][judge] = false;

        emit JudgeRemoved(_marketId, judge);

        // Nobody left to resolve a funded market — refund now instead of burning the window.
        // An empty unfunded panel stays Open so the creator can rebuild it before bets.
        if (panel.length == 0 && market.totalPool > 0) {
            market.state = MarketState.Refunding;

            emit RefundsEnabled(_marketId, judge);
        }
    }

    function addJudge(address _owner, uint256 _marketId, address _judge) external whenNotPaused {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        if (_judge == address(0)) revert InvalidAddress();
        if (market.state != MarketState.Open) revert MarketNotOpen();
        // The panel bettors saw when staking is the panel that resolves
        if (market.totalPool != 0) revert MarketHasBets();

        if (_resolveActor(_owner) != market.creator) revert NotCreator();
        if (isJudge[_marketId][_judge]) revert InvalidJudges();
        if (_judges[_marketId].length >= MAX_JUDGES) revert InvalidJudges();

        _judges[_marketId].push(_judge);
        isJudge[_marketId][_judge] = true;
        if (_judge == market.creator) judgeConfirmed[_marketId][_judge] = true;

        emit JudgeAdded(_marketId, _judge);
    }

    function removeJudge(address _owner, uint256 _marketId, address _judge) external whenNotPaused {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        if (market.state != MarketState.Open) revert MarketNotOpen();
        if (market.totalPool != 0) revert MarketHasBets();

        if (_resolveActor(_owner) != market.creator) revert NotCreator();
        if (!isJudge[_marketId][_judge]) revert InvalidJudges();

        address[] storage panel = _judges[_marketId];
        if (panel.length == 1) revert InvalidJudges();

        for (uint256 i = 0; i < panel.length; i++) {
            if (panel[i] == _judge) {
                panel[i] = panel[panel.length - 1];
                panel.pop();
                break;
            }
        }
        isJudge[_marketId][_judge] = false;
        judgeConfirmed[_marketId][_judge] = false;

        emit JudgeRemoved(_marketId, _judge);
    }

    function updateMarketMetadata(address _owner, uint256 _marketId, uint8 _outcomeCount, string calldata _metadata) external whenNotPaused {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        if (market.state != MarketState.Open) revert MarketNotOpen();
        if (market.hidden) revert MarketInactive();
        // The question bettors staked on can never change under them — metadata locks with
        // the judge panel at the first bet
        if (market.totalPool != 0) revert MarketHasBets();
        if (_resolveActor(_owner) != market.creator) revert NotCreator();
        if (_outcomeCount < 2 || _outcomeCount > MAX_OUTCOME_COUNT) revert InvalidOutcomeCount();
        if (bytes(_metadata).length == 0) revert InvalidMetadata();
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }

        // Resizing outcomes is safe in this window: no bets exist, so every outcome pool is
        // still zero and no stake can reference a removed outcome id
        market.outcomeCount = _outcomeCount;
        market.metadata = _metadata;

        emit MarketMetadataUpdated(_marketId, _outcomeCount, _metadata);
    }

    function upgradeToFeatured(address _owner, uint256 _marketId) external payable whenNotPaused {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();
        if (market.state != MarketState.Open) revert MarketNotOpen();
        if (market.hidden) revert MarketInactive();
        if (market.featured) revert AlreadyFeatured();

        if (_resolveActor(_owner) != market.creator) revert NotCreator();
        if (msg.value != featuredFee) revert InsufficientFee();

        market.featured = true;
        if (msg.value > 0) accruedFees[address(0)] += msg.value;

        emit MarketFeatured(_marketId, msg.value);
    }

    function setHidden(uint256 _marketId, bool _hidden) external onlyDirectModerator {
        Market storage market = _markets[_marketId];
        if (market.creator == address(0)) revert MarketNotFound();

        market.hidden = _hidden;

        emit MarketHiddenSet(_marketId, _hidden, msg.sender);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getMarket(uint256 _marketId) external view returns (Market memory) {
        return _markets[_marketId];
    }

    function getJudges(uint256 _marketId) external view returns (address[] memory) {
        return _judges[_marketId];
    }

    function getOutcomePools(uint256 _marketId) external view returns (uint256[] memory pools) {
        uint256 count = _markets[_marketId].outcomeCount;
        pools = new uint256[](count);

        for (uint8 i = 0; i < count; i++) {
            pools[i] = outcomePools[_marketId][i];
        }
    }

    function getPosition(uint256 _marketId, address _account)
        external
        view
        returns (uint256[] memory stakesPerOutcome, uint256 totalStake, bool claimed)
    {
        uint256 count = _markets[_marketId].outcomeCount;
        stakesPerOutcome = new uint256[](count);

        for (uint8 i = 0; i < count; i++) {
            stakesPerOutcome[i] = stakes[_marketId][_account][i];
        }

        totalStake = totalStakeOf[_marketId][_account];
        claimed = hasClaimed[_marketId][_account];
    }

    function claimableAmount(uint256 _marketId, address _account) external view returns (uint256) {
        Market storage market = _markets[_marketId];
        if (hasClaimed[_marketId][_account]) return 0;

        if (market.state == MarketState.Resolved) {
            uint256 winningStake = stakes[_marketId][_account][market.winningOutcome];
            if (winningStake == 0) return 0;

            uint256 distributable = market.totalPool -
                (market.totalPool * market.feeBps) / FEE_DENOMINATOR -
                (market.totalPool * market.creatorFeeBps) / FEE_DENOMINATOR;
            return (winningStake * distributable) / outcomePools[_marketId][market.winningOutcome];
        }

        if (market.state == MarketState.Refunding) {
            return totalStakeOf[_marketId][_account];
        }

        return 0;
    }

    function refundEligibleAt(uint256 _marketId) external view returns (uint256) {
        return _refundEligibleAt(_markets[_marketId]);
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
        if (_hupAddress == address(0) || _hupAddress.code.length == 0) revert InvalidAddress();

        // Probe the session getter so a fat-fingered address can't silently break the
        // burner-session path. This catches EOAs and contracts that don't answer the
        // selector — a wrong-but-live contract returning well-shaped garbage still passes.
        try IHup(_hupAddress).userSessions(address(0)) returns (address, uint256) {
            // any decodable answer proves the interface resolves
        } catch {
            revert InvalidAddress();
        }

        address oldValue = address(hupContract);
        hupContract = IHup(_hupAddress);

        emit HupContractUpdated(oldValue, _hupAddress);
    }

    function setPredictFeeBps(uint256 _feeBps) external onlyDirectAdmin {
        // The combined take is what winners actually lose, so the cap covers both fees
        if (_feeBps + creatorFeeBps > ABSOLUTE_MAX_FEE_BPS) revert InvalidFeeBps();

        uint256 oldValue = predictFeeBps;
        predictFeeBps = _feeBps;

        emit PredictFeeUpdated(oldValue, _feeBps);
    }

    function setCreatorFeeBps(uint256 _feeBps) external onlyDirectAdmin {
        if (_feeBps + predictFeeBps > ABSOLUTE_MAX_FEE_BPS) revert InvalidFeeBps();

        uint256 oldValue = creatorFeeBps;
        creatorFeeBps = _feeBps;

        emit CreatorFeeUpdated(oldValue, _feeBps);
    }

    function setFeaturedFee(uint256 _featuredFee) external onlyDirectAdmin {
        uint256 oldValue = featuredFee;
        featuredFee = _featuredFee;

        emit FeaturedFeeUpdated(oldValue, _featuredFee);
    }

    function setResolveWindow(uint256 _resolveWindow) external onlyDirectAdmin {
        if (_resolveWindow < MIN_RESOLVE_WINDOW || _resolveWindow > MAX_RESOLVE_WINDOW) {
            revert InvalidResolveWindow();
        }

        uint256 oldValue = resolveWindow;
        resolveWindow = _resolveWindow;

        emit ResolveWindowUpdated(oldValue, _resolveWindow);
    }

    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external onlyDirectAdmin {
        if (_maxMetadataBytes == 0 || _maxMetadataBytes > ABSOLUTE_MAX_METADATA_BYTES) {
            revert InvalidMetadataLimit();
        }

        uint256 oldValue = maxMetadataBytes;
        maxMetadataBytes = _maxMetadataBytes;

        emit MaxMetadataBytesUpdated(oldValue, _maxMetadataBytes);
    }

    /**
     * @notice Withdraws accrued protocol fees for one stake token. Escrowed pools are untouched —
     *         only the fee ledger is withdrawable.
     * @param _token The stake token (address(0) for native fees).
     * @param _receiver The recipient of the fees.
     */
    function withdrawFees(address _token, address _receiver) external onlyDirectAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 amount = accruedFees[_token];
        if (amount == 0) revert TransferFailed();

        accruedFees[_token] = 0;

        _payout(_token, _token != address(0) && isLsp7Token[_token], _receiver, amount);

        emit FeesWithdrawn(_token, _receiver, amount);
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
     * @dev Returns when enableRefunds unlocks: resolve window past the effective end of betting
     *      (closedAt when betting was closed early, otherwise the betting deadline). Zero once
     *      the market is already settled.
     */
    function _refundEligibleAt(Market storage market) internal view returns (uint256) {
        if (market.creator == address(0)) return 0;
        if (market.state == MarketState.Resolved || market.state == MarketState.Refunding) return 0;

        uint256 anchor = market.closedAt != 0 ? market.closedAt : market.bettingDeadline;
        return anchor + resolveWindow;
    }

    /**
     * @dev Sends stakes or fees out in the market's payment standard, reverting on failure.
     */
    function _payout(address _token, bool _isTokenLsp7, address _to, uint256 _amount) internal {
        if (_amount == 0) return;

        if (_token == address(0)) {
            (bool success, ) = _to.call{value: _amount}("");
            if (!success) revert TransferFailed();
        } else if (_isTokenLsp7) {
            ILSP7Minimal(_token).transfer(address(this), _to, _amount, true, "");
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
        }
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
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupPredict) returns (bool) {
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

    /// @dev Every legitimate native payment enters through a payable function (createMarket,
    ///      upgradeToFeatured, placeBet), so a plain transfer can only be a mistake — reject it
    ///      rather than lock the funds in escrow forever with no recovery path.
    receive() external payable {
        revert UnexpectedNativePayment();
    }
}
