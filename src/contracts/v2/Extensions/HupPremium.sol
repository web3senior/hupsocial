// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IHupPremium.sol";

/**
 * @title Hup Premium
 * @author Hup Labs
 * @notice Extension contract powering Hup's paid subscription — an account pays a plan's price
 *         in the native coin or in an accepted token, and holds premium until its expiry passes.
 * @dev Uses IHupPremium for shared events, errors, structs, and view structs. AccessControl for
 *      admin permissions, Pausable for emergency controls, and ReentrancyGuard for the refund,
 *      token-pull and withdrawal paths.
 *
 *      Deliberately NOT ERC2771: every entry point here moves value, and a sponsored or burner-
 *      session call would spend a key the account did not consciously reach for. Premium is
 *      bought from the connected wallet, so there is no forwarder to trust and no session to
 *      resolve. Identity is msg.sender throughout, which a Universal Profile satisfies as
 *      readily as an EOA — the UP itself is the caller when it routes through ERC725X execute().
 *
 *      Both token standards are supported because the chains this deploys to disagree: LUKSO's
 *      only stablecoin is an LSP7, while every EVM chain beside it uses ERC20. Which one a token
 *      is gets resolved once, when its price is set, and stored — probing ERC165 on every
 *      purchase would be three external calls to learn something that never changes.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji ⭐
 */
contract HupPremium is IHupPremium, Pausable, ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice May give premium away — a term or a standing comp — and nothing else. Pricing,
    ///         the treasury and the pause switch stay with ADMIN_ROLE.
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");

    /// @notice Longest address list a batch call accepts, so one call cannot be a gas bomb that
    ///         reverts after the caller has already paid for most of it.
    uint256 public constant MAX_BATCH = 200;

    /// @notice The plan ids seeded at construction. Admins may define others, but these two are
    ///         what the app offers and what clients look up by name.
    uint8 public constant PLAN_MONTHLY = 1;
    uint8 public constant PLAN_YEARLY = 2;

    /// @notice Longest term a single SOLD plan may run for. Bounds setPlan only — a public
    ///         plan of forty years is a typo, while a term a moderator names deliberately is not,
    ///         so grantPremium is not held to this.
    uint64 public constant MAX_PLAN_DURATION = 730 days;

    /// @dev LSP7DigitalAsset interface ids. Three of them because LUKSO shipped a new one with
    ///      several releases and the bridged USDC this was written for still answers to the
    ///      v0.14 id; a token is LSP7 if it claims any of them.
    bytes4 private constant _LSP7_INTERFACE_V14 = 0xc52d6008;
    bytes4 private constant _LSP7_INTERFACE_V15 = 0xb3c4928f;
    bytes4 private constant _LSP7_INTERFACE_V16 = 0xdaa746b7;

    /// @notice Unix seconds at which an account's premium lapses. Zero means it never had any.
    mapping(address => uint64) public expiresAt;

    /// @notice Purchasable terms by id. `price` on these is the NATIVE price.
    mapping(uint8 => Plan) public plans;

    /// @notice What each accepted token costs, per plan, in that token's own base units.
    mapping(uint8 => mapping(address => TokenPrice)) public tokenPrices;

    /// @notice How each known token has to be moved, resolved when its first price was set.
    mapping(address => TokenStandard) public tokenStandards;

    /// @notice Accounts holding premium with no expiry, until a moderator revokes it.
    mapping(address => bool) public complimentary;

    /// @notice How many accounts are on that list, so a client never has to count them.
    uint256 public complimentaryCount;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    /// @dev An admin is implicitly a moderator, so granting comp access never needs both roles.
    modifier onlyDirectModerator() {
        if (!hasRole(MODERATOR_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the premium contract and seeds the monthly and yearly plans.
     * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     * @param _monthlyPrice Native wei for one month, in this chain's coin.
     * @param _yearlyPrice Native wei for one year, in this chain's coin.
     */
    constructor(address _admin, uint256 _monthlyPrice, uint256 _yearlyPrice) {
        if (_admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        /* An admin already passes every moderator check, but holding the role explicitly is
           what lets a client list the moderators without special-casing the admin. */
        _grantRole(MODERATOR_ROLE, _admin);

        _writePlan(PLAN_MONTHLY, 30 days, _monthlyPrice, true);
        _writePlan(PLAN_YEARLY, 365 days, _yearlyPrice, true);
    }

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Buys or renews premium for the caller, paying in the native coin.
     * @param _planId The plan to buy.
     * @return expiry The account's expiry after this purchase.
     */
    function subscribe(uint8 _planId) external payable whenNotPaused nonReentrant returns (uint64 expiry) {
        return _subscribe(msg.sender, _planId);
    }

    /**
     * @notice Buys or renews premium for someone else — a gift. The caller pays; the named
     *         account holds the subscription and is what every event and view attributes it to.
     * @param _account The account that receives the premium term.
     * @param _planId The plan to buy.
     * @return expiry The account's expiry after this purchase.
     */
    function subscribeFor(address _account, uint8 _planId) external payable whenNotPaused nonReentrant returns (uint64 expiry) {
        if (_account == address(0)) revert InvalidAddress();

        return _subscribe(_account, _planId);
    }

    /**
     * @notice Buys or renews premium for the caller, paying in an accepted token.
     * @dev The caller must have approved this contract first — `approve` for an ERC20,
     *      `authorizeOperator` for an LSP7.
     * @param _planId The plan to buy.
     * @param _token The token to pay in. Never address(0); that is what `subscribe` is for.
     * @return expiry The account's expiry after this purchase.
     */
    function subscribeWithToken(uint8 _planId, address _token) external whenNotPaused nonReentrant returns (uint64 expiry) {
        return _subscribeWithToken(msg.sender, _planId, _token);
    }

    /**
     * @notice Gifts premium to someone else, paid in an accepted token.
     * @param _account The account that receives the premium term.
     * @param _planId The plan to buy.
     * @param _token The token to pay in.
     * @return expiry The account's expiry after this purchase.
     */
    function subscribeForWithToken(
        address _account,
        uint8 _planId,
        address _token
    ) external whenNotPaused nonReentrant returns (uint64 expiry) {
        if (_account == address(0)) revert InvalidAddress();

        return _subscribeWithToken(_account, _planId, _token);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    /// @notice Whether the account holds premium at this block, bought or comped.
    function isPremium(address _account) external view returns (bool) {
        return complimentary[_account] || expiresAt[_account] > block.timestamp;
    }

    function getPlan(uint8 _planId) external view returns (Plan memory) {
        return plans[_planId];
    }

    /// @dev One call for the whole price table, so the pricing page is a single RPC round trip.
    function getPlans(uint8[] calldata _planIds) external view returns (Plan[] memory page) {
        page = new Plan[](_planIds.length);

        for (uint256 i = 0; i < _planIds.length; i++) {
            page[i] = plans[_planIds[i]];
        }
    }

    /// @dev Same reasoning for the token column of that table.
    function getTokenPrices(uint8 _planId, address[] calldata _tokens) external view returns (TokenPrice[] memory page) {
        page = new TokenPrice[](_tokens.length);

        for (uint256 i = 0; i < _tokens.length; i++) {
            page[i] = tokenPrices[_planId][_tokens[i]];
        }
    }

    // --- ADMIN CONFIGURATION ---

    /**
     * @notice Defines or redefines a plan and its native price. Existing subscriptions are
     *         untouched — a term already bought was paid for under the terms of its own day.
     */
    function setPlan(uint8 _planId, uint64 _duration, uint256 _price, bool _enabled) external onlyDirectAdmin {
        _writePlan(_planId, _duration, _price, _enabled);
    }

    /**
     * @notice Repoints a plan's native price, keeping its duration. The lever the admin page
     *         pulls when the coin moves and the dollar target has not.
     */
    function setPlanPrice(uint8 _planId, uint256 _price) external onlyDirectAdmin {
        Plan storage plan = plans[_planId];
        if (plan.duration == 0) revert PlanUnavailable(_planId);

        plan.price = _price;

        emit PlanUpdated(_planId, plan.duration, _price, plan.enabled);
    }

    /**
     * @notice Sets what one token buys one plan for, and resolves how that token moves.
     * @dev Detection runs here, once, rather than on every purchase. `_enabled = false` takes
     *      the token off sale while keeping its resolved standard, so re-listing it later needs
     *      no second probe.
     * @param _planId The plan this price applies to.
     * @param _token The token contract.
     * @param _price The price in the token's own base units (6 decimals for most USDC).
     * @param _enabled Whether it is on sale.
     */
    function setTokenPrice(uint8 _planId, address _token, uint256 _price, bool _enabled) external onlyDirectAdmin {
        if (_token == address(0)) revert InvalidToken();
        if (plans[_planId].duration == 0) revert PlanUnavailable(_planId);

        TokenStandard standard = tokenStandards[_token];
        if (standard == TokenStandard.NONE) {
            standard = _detectStandard(_token);
            tokenStandards[_token] = standard;
            emit TokenStandardUpdated(_token, standard);
        }

        tokenPrices[_planId][_token] = TokenPrice({price: _price, enabled: _enabled});

        emit TokenPriceUpdated(_planId, _token, _price, _enabled, standard);
    }

    /**
     * @notice Overrides how a token moves, for the case detection got it wrong.
     * @dev A token that answers ERC165 dishonestly, or an LSP7 predating the interface ids this
     *      knows, would otherwise be unpayable. Setting NONE is refused: a token with no
     *      standard cannot be transferred, and quietly bricking a live price is worse than
     *      taking it off sale explicitly.
     */
    function setTokenStandard(address _token, TokenStandard _standard) external onlyDirectAdmin {
        if (_token == address(0)) revert InvalidToken();
        if (_standard == TokenStandard.NONE) revert InvalidToken();

        tokenStandards[_token] = _standard;

        emit TokenStandardUpdated(_token, _standard);
    }

    /**
     * @notice Credits premium without payment — support make-goods, and the accounts a launch
     *         chooses to comp. Extends from an unexpired term exactly as a purchase does, and
     *         expires on its own — for any term the moderator names. For premium that should
     *         never expire at all, use setComplimentary.
     */
    function grantPremium(address _account, uint64 _duration) external onlyDirectModerator {
        _grantPremium(_account, _duration);
    }

    /// @notice The same, to a list of accounts, all for the same term.
    function grantPremiumBatch(address[] calldata _accounts, uint64 _duration) external onlyDirectModerator {
        if (_accounts.length == 0 || _accounts.length > MAX_BATCH) revert InvalidBatch(_accounts.length);

        for (uint256 i = 0; i < _accounts.length; i++) {
            _grantPremium(_accounts[i], _duration);
        }
    }

    /**
     * @notice Puts an account on the complimentary list, or takes it off.
     * @dev Premium from this list never expires, which is exactly why it is a flag and not a
     *      very long term: a decision that has to be reversible cannot be written as a
     *      timestamp the contract will honour regardless.
     *
     *      Independent of any bought term — an account can hold both, and revoking the comp
     *      leaves whatever it actually paid for untouched.
     */
    function setComplimentary(address _account, bool _granted) external onlyDirectModerator {
        _setComplimentary(_account, _granted);
    }

    /// @notice The same, to a list of accounts, all set the same way.
    function setComplimentaryBatch(address[] calldata _accounts, bool _granted) external onlyDirectModerator {
        if (_accounts.length == 0 || _accounts.length > MAX_BATCH) revert InvalidBatch(_accounts.length);

        for (uint256 i = 0; i < _accounts.length; i++) {
            _setComplimentary(_accounts[i], _granted);
        }
    }

    function pause() external onlyDirectAdmin {
        _pause();
    }

    function unpause() external onlyDirectAdmin {
        _unpause();
    }

    /**
     * @notice Sweeps accumulated native revenue.
     * @dev `.call` rather than transfer so the treasury may itself be a Universal Profile whose
     *      LSP1 delegate needs more than the 2300 gas stipend.
     */
    function withdrawAll(address payable _receiver) external onlyDirectAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 balance = address(this).balance;
        if (balance == 0) revert TransferFailed();

        (bool success, ) = _receiver.call{value: balance}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(_receiver, balance);
    }

    /**
     * @notice Sweeps the full balance of one token. Native revenue has its own path above,
     *         because the two cannot be moved by the same call.
     */
    function withdrawToken(address _token, address _receiver) external onlyDirectAdmin nonReentrant {
        if (_token == address(0) || _receiver == address(0)) revert InvalidAddress();

        TokenStandard standard = tokenStandards[_token];

        if (standard == TokenStandard.LSP7) {
            uint256 balance = ILSP7Minimal(_token).balanceOf(address(this));
            if (balance == 0) revert TransferFailed();

            ILSP7Minimal(_token).transfer(address(this), _receiver, balance, true, "");
            emit TokenWithdrawal(_token, _receiver, balance);
            return;
        }

        /* An ERC20 by default, including a token never priced here — a stray airdrop into this
           contract is still recoverable rather than stuck forever. */
        uint256 erc20Balance = IERC20(_token).balanceOf(address(this));
        if (erc20Balance == 0) revert TransferFailed();

        IERC20(_token).safeTransfer(_receiver, erc20Balance);
        emit TokenWithdrawal(_token, _receiver, erc20Balance);
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
     * @dev Charges the plan's native price, extends the account's term, and refunds any
     *      overpayment. State is written before the refund leaves, and the entry points are
     *      nonReentrant, so a payer with a hostile receive hook re-enters nothing worth
     *      re-entering.
     */
    function _subscribe(address _account, uint8 _planId) internal returns (uint64 expiry) {
        Plan memory plan = plans[_planId];
        if (!plan.enabled || plan.duration == 0) revert PlanUnavailable(_planId);
        if (msg.value < plan.price) revert InsufficientPayment(msg.value, plan.price);

        expiry = _extend(_account, plan.duration);

        emit Subscribed(_account, msg.sender, _planId, plan.price, expiry);

        uint256 excess = msg.value - plan.price;
        if (excess > 0) {
            (bool success, ) = payable(msg.sender).call{value: excess}("");
            if (!success) revert TransferFailed();
        }
    }

    /**
     * @dev The same, paid in a token. The term is written before the pull for the same reason
     *      the native path refunds after: a revert anywhere below discards it along with the
     *      event, and nonReentrant closes the door a hostile token would re-enter through.
     */
    function _subscribeWithToken(address _account, uint8 _planId, address _token) internal returns (uint64 expiry) {
        if (_token == address(0)) revert InvalidToken();

        Plan memory plan = plans[_planId];
        if (!plan.enabled || plan.duration == 0) revert PlanUnavailable(_planId);

        TokenPrice memory quoted = tokenPrices[_planId][_token];
        if (!quoted.enabled) revert TokenNotAccepted(_planId, _token);

        expiry = _extend(_account, plan.duration);

        emit SubscribedWithToken(_account, msg.sender, _planId, _token, quoted.price, expiry);

        _pullToken(_token, quoted.price);
    }

    /**
     * @dev Moves `_amount` of `_token` from the payer to this contract, by whichever standard
     *      the token was resolved as.
     *
     *      The balance is measured on both sides rather than trusted: a fee-on-transfer token
     *      delivers less than it was asked for, and crediting a month of premium for a payment
     *      that arrived short is the one mistake this function exists to prevent.
     *
     *      `force: true` on the LSP7 path because this contract implements no LSP1 delegate —
     *      without it every transfer in would revert.
     */
    function _pullToken(address _token, uint256 _amount) internal {
        TokenStandard standard = tokenStandards[_token];

        if (standard == TokenStandard.LSP7) {
            uint256 balanceBefore = ILSP7Minimal(_token).balanceOf(address(this));
            ILSP7Minimal(_token).transfer(msg.sender, address(this), _amount, true, "");

            uint256 received = ILSP7Minimal(_token).balanceOf(address(this)) - balanceBefore;
            if (received < _amount) revert InsufficientPayment(received, _amount);
            return;
        }

        uint256 erc20Before = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

        uint256 erc20Received = IERC20(_token).balanceOf(address(this)) - erc20Before;
        if (erc20Received < _amount) revert InsufficientPayment(erc20Received, _amount);
    }

    function _grantPremium(address _account, uint64 _duration) internal {
        if (_account == address(0)) revert InvalidAddress();
        /* Only zero is refused. The moderator picks the term — days, a year, ten years — and
           anything large enough to be a mistake reverts on the overflow in _extend. */
        if (_duration == 0) revert InvalidPlan();

        uint64 expiry = _extend(_account, _duration);

        emit PremiumGranted(_account, msg.sender, _duration, expiry);
    }

    /// @dev No-ops on a repeat rather than reverting: a batch that re-lists an account already
    ///      on the list should finish, not fail halfway and leave the rest unset.
    function _setComplimentary(address _account, bool _granted) internal {
        if (_account == address(0)) revert InvalidAddress();
        if (complimentary[_account] == _granted) return;

        complimentary[_account] = _granted;
        if (_granted) complimentaryCount++;
        else complimentaryCount--;

        emit ComplimentarySet(_account, _granted, msg.sender);
    }

    /**
     * @dev Adds a term to an account, stacking onto an unexpired one rather than replacing it —
     *      renewing early must never burn the time already paid for.
     *
     *      No ceiling on how far ahead this reaches: someone buying years in advance has paid
     *      for every one of them, and a moderator granting a long term meant to. An absurd
     *      duration overflows uint64 and reverts under 0.8 rather than wrapping, so nonsense
     *      fails loudly instead of writing an expiry in the past.
     */
    function _extend(address _account, uint64 _duration) internal returns (uint64 expiry) {
        uint64 current = expiresAt[_account];
        uint64 base = current > block.timestamp ? current : uint64(block.timestamp);

        expiry = base + _duration;

        expiresAt[_account] = expiry;
    }

    function _writePlan(uint8 _planId, uint64 _duration, uint256 _price, bool _enabled) internal {
        if (_planId == 0) revert InvalidPlan();
        if (_duration == 0 || _duration > MAX_PLAN_DURATION) revert InvalidPlan();

        plans[_planId] = Plan({duration: _duration, price: _price, enabled: _enabled});

        emit PlanUpdated(_planId, _duration, _price, _enabled);
    }

    /// @dev LSP7 if it claims any LSP7 interface id, ERC20 otherwise — an ERC20 answers no
    ///      ERC165 at all, so "did not say it was LSP7" is the only signal available.
    function _detectStandard(address _token) internal view returns (TokenStandard) {
        if (_claimsInterface(_token, _LSP7_INTERFACE_V14)) return TokenStandard.LSP7;
        if (_claimsInterface(_token, _LSP7_INTERFACE_V15)) return TokenStandard.LSP7;
        if (_claimsInterface(_token, _LSP7_INTERFACE_V16)) return TokenStandard.LSP7;

        return TokenStandard.ERC20;
    }

    /// @dev try/catch because a plain ERC20 has no supportsInterface to call at all.
    function _claimsInterface(address _token, bytes4 _interfaceId) internal view returns (bool) {
        try IERC165(_token).supportsInterface(_interfaceId) returns (bool claimed) {
            return claimed;
        } catch {
            return false;
        }
    }

    receive() external payable {
        emit UnattributedDeposit(msg.sender, msg.value);
    }
}
