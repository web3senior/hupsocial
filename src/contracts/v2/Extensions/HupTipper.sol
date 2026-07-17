// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./IHupTipper.sol";
import "./ILSP7Minimal.sol";

/**
 * @title Hup Tipper
 * @author Hup Labs
 * @notice Extension contract enabling users to tip post creators in native coins, ERC20, or LSP7
 *         tokens. Tips are forwarded directly to the creator's wallet; every tip emits a Tipped
 *         event so offchain indexers can list tippers per post and top supporters per creator.
 * @dev Uses IHupTipper for shared events, errors, and view signatures. Integrates with Hup Core
 *      via IHup — the tip recipient is always the post's onchain creator, never a caller-supplied
 *      address. Supports rotatable ERC2771 trusted forwarders for meta-transactions,
 *      AccessControl for admin permissions, Pausable for emergency controls, and ReentrancyGuard
 *      for protected payout distribution. Resolves burner session keys to primary wallets.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💸
 */
contract HupTipper is IHupTipper, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_TIP_FEE_BPS = 1_000;
    uint256 public constant ABSOLUTE_MAX_MEMO_BYTES = 2_048;
    uint256 public constant MAX_BATCH_READ_COUNT = 50;

    /// @notice The Hup Core contract instance
    IHup public immutable hupContract;

    /// @notice Total number of tips a post has received (currency-agnostic)
    mapping(uint256 => uint256) public tipCount;

    /// @notice Maps Hup postId to token to cumulative gross amount (pre-fee) tipped in that
    ///         token. Tracked per-token because amounts in different tokens aren't additive.
    mapping(uint256 => mapping(address => uint256)) public tippedByToken;

    /// @notice Maps Hup postId to tipper to number of tips sent (currency-agnostic)
    mapping(uint256 => mapping(address => uint256)) public tipsFrom;

    /// @notice Maps Hup postId to tipper to token to cumulative gross amount tipped. Lets a
    ///         tipper's activity on a post be broken out by exactly which token(s) they tipped in.
    mapping(uint256 => mapping(address => mapping(address => uint256))) public tipperAmountByToken;

    /// @notice Total number of tips a creator has received across all their posts
    mapping(address => uint256) public creatorTipCount;

    /// @notice Maps creator to token to cumulative gross amount (pre-fee) received across all
    ///         their posts
    mapping(address => mapping(address => uint256)) public creatorReceivedByToken;

    /// @notice Maps creator to supporter to number of tips received from that supporter,
    ///         across all the creator's posts (currency-agnostic)
    mapping(address => mapping(address => uint256)) public supporterTipCount;

    mapping(address => bool) public trustedForwarders;

    /// @notice Percentage fee charged on each tip, in basis points (100 = 1%)
    uint256 public tipFeeBps = 0;

    /// @notice The maximum allowed byte length for a tip's memo field
    uint256 public maxMemoBytes = 256;

    /// @notice Unique tipper addresses per postId, insertion-ordered (never removed from), for
    ///         paginated onchain reads via getTippers
    mapping(uint256 => EnumerableSet.AddressSet) private _tippersOf;

    /// @notice Unique supporter addresses per creator, insertion-ordered, for paginated onchain
    ///         reads via getSupporters
    mapping(address => EnumerableSet.AddressSet) private _supportersOf;

    /// @notice Distinct tokens a post has ever been tipped in. Tipper-controlled (any tipper can
    ///         tip in any token) so — unlike a Bazzar listing's payment tokens — it can grow
    ///         unbounded and is only ever read paginated via getTokensUsed.
    mapping(uint256 => EnumerableSet.AddressSet) private _tokensOf;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the tipper contract.
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

    function tip(
        address _tipper,
        uint256 _postId,
        uint256 _amount,
        address _token,
        bool _isLsp7,
        bytes calldata _memo
    ) external payable whenNotPaused nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        if (_memo.length > maxMemoBytes) revert MemoTooLarge(_memo.length, maxMemoBytes);

        address tipper = _resolveActor(_tipper);

        // Query the core Hup contract — the recipient is always the post's onchain creator, so
        // a tip can never be redirected to a caller-supplied address
        IHup.ContentView memory content = hupContract.getContent(_postId, address(0));

        if (content.isDeleted) revert ContentDeleted();

        address creator = content.creator;
        if (creator == address(0)) revert InvalidAddress();
        if (creator == tipper) revert SelfTip();

        bool isLsp7 = _token != address(0) && _isLsp7;

        if (_token == address(0)) {
            if (msg.value != _amount) revert InsufficientPayment(msg.value, _amount);
        } else {
            if (msg.value != 0) revert UnexpectedNativePayment();
        }

        // Record the tip (gross, pre-fee — same convention as Bazzar's revenueByToken)
        tipCount[_postId] += 1;
        tippedByToken[_postId][_token] += _amount;
        tipsFrom[_postId][tipper] += 1;
        tipperAmountByToken[_postId][tipper][_token] += _amount;
        creatorTipCount[creator] += 1;
        creatorReceivedByToken[creator][_token] += _amount;
        supporterTipCount[creator][tipper] += 1;
        _tippersOf[_postId].add(tipper);
        _supportersOf[creator].add(tipper);
        _tokensOf[_postId].add(_token);

        // Split payment: platform fee stays in the contract, remainder goes straight to the
        // creator's wallet. Fee-on-transfer/deflationary tokens are unsupported: the contract
        // pulls the gross amount and pushes the creator's share, so a transfer tax would eat
        // into accumulated fees.
        uint256 feeAmount = (_amount * tipFeeBps) / FEE_DENOMINATOR;

        if (_token == address(0)) {
            (bool success, ) = creator.call{value: _amount - feeAmount}("");
            if (!success) revert TransferFailed();
        } else if (isLsp7) {
            // LSP7 (LUKSO): tipper must have called authorizeOperator(tipper contract, amount) beforehand
            ILSP7Minimal token = ILSP7Minimal(_token);
            token.transfer(tipper, address(this), _amount, true, "");
            token.transfer(address(this), creator, _amount - feeAmount, true, "");
        } else {
            IERC20 token = IERC20(_token);
            token.safeTransferFrom(tipper, address(this), _amount);
            token.safeTransfer(creator, _amount - feeAmount);
        }

        emit Tipped(_postId, tipper, creator, _token, isLsp7, _amount, feeAmount, _memo);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getTipperCount(uint256 _postId) external view returns (uint256) {
        return _tippersOf[_postId].length();
    }

    function getTippers(
        uint256 _postId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory tippers, uint256[] memory counts, uint256 total) {
        EnumerableSet.AddressSet storage all = _tippersOf[_postId];
        total = all.length();

        if (_offset >= total) {
            return (new address[](0), new uint256[](0), total);
        }

        uint256 limit = (_limit == 0 || _limit > MAX_BATCH_READ_COUNT) ? MAX_BATCH_READ_COUNT : _limit;
        uint256 end = _offset + limit;
        if (end > total) end = total;

        uint256 resultLength = end - _offset;
        tippers = new address[](resultLength);
        counts = new uint256[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            address tipper = all.at(_offset + i);
            tippers[i] = tipper;
            counts[i] = tipsFrom[_postId][tipper];
        }
    }

    function getSupporterCount(address _creator) external view returns (uint256) {
        return _supportersOf[_creator].length();
    }

    function getSupporters(
        address _creator,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory supporters, uint256[] memory counts, uint256 total) {
        EnumerableSet.AddressSet storage all = _supportersOf[_creator];
        total = all.length();

        if (_offset >= total) {
            return (new address[](0), new uint256[](0), total);
        }

        uint256 limit = (_limit == 0 || _limit > MAX_BATCH_READ_COUNT) ? MAX_BATCH_READ_COUNT : _limit;
        uint256 end = _offset + limit;
        if (end > total) end = total;

        uint256 resultLength = end - _offset;
        supporters = new address[](resultLength);
        counts = new uint256[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            address supporter = all.at(_offset + i);
            supporters[i] = supporter;
            counts[i] = supporterTipCount[_creator][supporter];
        }
    }

    function getTokensUsed(
        uint256 _postId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory tokens, uint256[] memory amounts, uint256 total) {
        EnumerableSet.AddressSet storage all = _tokensOf[_postId];
        total = all.length();

        if (_offset >= total) {
            return (new address[](0), new uint256[](0), total);
        }

        uint256 limit = (_limit == 0 || _limit > MAX_BATCH_READ_COUNT) ? MAX_BATCH_READ_COUNT : _limit;
        uint256 end = _offset + limit;
        if (end > total) end = total;

        uint256 resultLength = end - _offset;
        tokens = new address[](resultLength);
        amounts = new uint256[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            address token = all.at(_offset + i);
            tokens[i] = token;
            amounts[i] = tippedByToken[_postId][token];
        }
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

    function setTipFeeBps(uint256 _tipFeeBps) external onlyDirectAdmin {
        if (_tipFeeBps > ABSOLUTE_MAX_TIP_FEE_BPS) revert InvalidFeeBps();

        uint256 oldValue = tipFeeBps;
        tipFeeBps = _tipFeeBps;

        emit TipFeeUpdated(oldValue, _tipFeeBps);
    }

    function setMaxMemoBytes(uint256 _maxMemoBytes) external onlyDirectAdmin {
        if (_maxMemoBytes == 0 || _maxMemoBytes > ABSOLUTE_MAX_MEMO_BYTES) {
            revert InvalidMemoLimit();
        }

        uint256 oldValue = maxMemoBytes;
        maxMemoBytes = _maxMemoBytes;

        emit MaxMemoBytesUpdated(oldValue, _maxMemoBytes);
    }

    function withdrawAll(address payable _receiver) external onlyDirectAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 balance = address(this).balance;
        if (balance == 0) revert TransferFailed();

        (bool success, ) = _receiver.call{value: balance}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(_receiver, balance);
    }

    function withdrawAllToken(address _token, address _receiver, bool _isLsp7) external onlyDirectAdmin nonReentrant {
        if (_token == address(0) || _receiver == address(0)) revert InvalidAddress();

        uint256 balance = IERC20(_token).balanceOf(address(this));
        if (balance == 0) revert TransferFailed();

        if (_isLsp7) {
            ILSP7Minimal(_token).transfer(address(this), _receiver, balance, true, "");
        } else {
            IERC20(_token).safeTransfer(_receiver, balance);
        }

        emit TokenWithdrawal(_token, _receiver, balance);
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
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupTipper) returns (bool) {
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

    receive() external payable {
        emit UnattributedDeposit(msg.sender, msg.value);
    }
}
