// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupTipper
 * @author Hup Labs
 * @notice Shared interface for the Hup Tipper protocol.
 * @dev Defines the protocol's public events, custom errors, and public interface used by
 *      HupTipper-compatible contracts, clients, and offchain indexers.
 * @custom:version 1.1.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💸
 */
interface IHupTipper {
    // --- SHARED EVENTS ---

    /// @notice Emitted for every tip. The single source of truth for offchain indexers — all
    ///         aggregate views (tippers per post, top supporters per creator, totals per token)
    ///         are derivable from this event alone.
    /// @dev `amount` is gross (pre-fee); the creator received `amount - feeAmount`. `memo` is
    ///      never stored — it exists only in this event, for optional client use (e.g. a short
    ///      message attached to the tip) without adding storage cost to every tip.
    event Tipped(uint256 indexed postId, address indexed tipper, address indexed creator, address token, bool isLsp7, uint256 amount, uint256 feeAmount, bytes memo);

    /// @notice Emitted when a trusted forwarder's status is updated.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    /// @notice Emitted when an ERC677 token is enabled or disabled for one-transaction tipping.
    event Erc677TokenUpdated(address indexed token, bool enabled);

    /// @notice Emitted when the percentage tip fee (in basis points) is updated.
    event TipFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the maximum tip memo byte length is updated.
    event MaxMemoBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when accumulated native fees are withdrawn by an admin.
    event Withdrawal(address indexed recipient, uint256 amount);

    /// @notice Emitted when accumulated token fees are withdrawn by an admin.
    event TokenWithdrawal(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
    event UnattributedDeposit(address indexed from, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidAmount();
    error ContentDeleted();
    /// @notice Tipping your own post is rejected so supporter stats can't be self-inflated.
    error SelfTip();
    error InsufficientPayment(uint256 provided, uint256 required);
    error UnexpectedNativePayment();
    error MemoTooLarge(uint256 length, uint256 maxLength);
    error InvalidMemoLimit();
    error InvalidFeeBps();
    error TransferFailed();
    error Unauthorized();
    error SessionExpired();
    /// @notice onTokenTransfer was called by a contract that is not a whitelisted ERC677 token.
    error UnsupportedToken();
    /// @notice An ERC677 tip carried no payload, so there is no postId to credit.
    error InvalidTipData();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function hupContract() external view returns (IHup);
    function ADMIN_ROLE() external view returns (bytes32);
    function trustedForwarders(address forwarder) external view returns (bool);
    /// @notice True if the token is whitelisted for one-transaction ERC677 tipping.
    function erc677Tokens(address token) external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);
    function tipFeeBps() external view returns (uint256);
    function FEE_DENOMINATOR() external view returns (uint256);
    function ABSOLUTE_MAX_TIP_FEE_BPS() external view returns (uint256);
    function maxMemoBytes() external view returns (uint256);
    function ABSOLUTE_MAX_MEMO_BYTES() external view returns (uint256);
    function MAX_BATCH_READ_COUNT() external view returns (uint256);
    /// @notice Total number of tips a post has received (currency-agnostic).
    function tipCount(uint256 postId) external view returns (uint256);
    /// @notice Cumulative gross amount (pre-fee) a post has been tipped in a specific token.
    /// @dev Tracked per-token (rather than one flat sum) because amounts in different tokens
    ///      aren't additive.
    function tippedByToken(uint256 postId, address token) external view returns (uint256);
    /// @notice Number of tips a specific tipper has sent to a post (currency-agnostic).
    function tipsFrom(uint256 postId, address tipper) external view returns (uint256);
    /// @notice A tipper's cumulative gross amount sent to a post in one specific token.
    function tipperAmountByToken(uint256 postId, address tipper, address token) external view returns (uint256);
    /// @notice Total number of tips a creator has received across all their posts.
    function creatorTipCount(address creator) external view returns (uint256);
    /// @notice Cumulative gross amount (pre-fee) a creator has been tipped in a specific token,
    ///         across all their posts.
    function creatorReceivedByToken(address creator, address token) external view returns (uint256);
    /// @notice Number of tips a specific supporter has sent to a creator, across all posts.
    function supporterTipCount(address creator, address supporter) external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Tips the creator of a Hup post. The recipient is resolved onchain from Hup Core,
     *         so a tip can never be redirected away from the post's creator.
     * @dev For native tips (`_token == address(0)`), msg.value must exactly match `_amount`. For
     *      token tips, msg.value must be zero and the tipper must have pre-authorized this
     *      contract for the amount — via `approve` (ERC20) or `authorizeOperator` (LSP7). The
     *      platform fee (tipFeeBps) stays in the contract; the remainder goes directly to the
     *      creator's wallet. Fee-on-transfer/deflationary tokens are unsupported: the contract
     *      pulls the gross amount and pushes the creator's share, so a transfer tax would eat
     *      into accumulated fees.
     * @param _tipper The primary wallet address of the tipper (or address(0) if caller is primary).
     * @param _postId The ID of the post in Hup whose creator receives the tip.
     * @param _amount The gross tip amount, in wei (native) or the token's base units.
     * @param _token The token the tip is paid in, or address(0) for the native token.
     * @param _isLsp7 True if `_token` is an LSP7 Digital Asset instead of an ERC20.
     * @param _memo Optional opaque data emitted with Tipped (e.g. a short message). Never
     *        stored — capped at maxMemoBytes since it's only ever calldata + a log.
     */
    function tip(address _tipper, uint256 _postId, uint256 _amount, address _token, bool _isLsp7, bytes calldata _memo) external payable;

    /**
     * @notice ERC677 receiver hook — settles a tip in a single transaction, with no prior approve.
     * @dev Called by the token itself during `transferAndCall`, after the tokens have already been
     *      moved to this contract. Only whitelisted tokens are accepted (`erc677Tokens`): the
     *      callback carries no proof of transfer beyond the identity of its caller, so an unlisted
     *      caller could otherwise forge Tipped events. Reverting here unwinds the transfer, so a
     *      rejected tip never leaves funds stranded. Burner sessions do not apply — the tokens
     *      must come from whoever holds them, and the token reports that holder as `_sender`.
     * @param _sender The address that called transferAndCall, i.e. the tipper.
     * @param _amount The gross tip amount, in the token's base units.
     * @param _data ABI-encoded `(uint256 postId, bytes memo)` identifying the post to credit.
     * @return Always true; ERC677 tokens require a truthy return for the transfer to stand.
     */
    function onTokenTransfer(address _sender, uint256 _amount, bytes calldata _data) external returns (bool);

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Returns the total number of unique addresses that have ever tipped a post.
     * @param _postId The ID of the post.
     */
    function getTipperCount(uint256 _postId) external view returns (uint256);

    /**
     * @notice Returns a page of a post's unique tippers, oldest-first, alongside each tipper's
     *         cumulative tip count on that post. Capped at MAX_BATCH_READ_COUNT per call to
     *         bound gas regardless of how many tippers a post has accumulated.
     * @param _postId The ID of the post.
     * @param _offset Index of the first tipper to return.
     * @param _limit Maximum tippers to return (clamped to MAX_BATCH_READ_COUNT; 0 uses the max).
     * @return tippers Addresses of tippers in this page.
     * @return counts Each tipper's cumulative tip count on this post (tipsFrom), same order as `tippers`.
     * @return total Total unique tipper count for this post.
     */
    function getTippers(uint256 _postId, uint256 _offset, uint256 _limit) external view returns (address[] memory tippers, uint256[] memory counts, uint256 total);

    /**
     * @notice Returns the total number of unique addresses that have ever tipped a creator.
     * @param _creator The creator's primary wallet address.
     */
    function getSupporterCount(address _creator) external view returns (uint256);

    /**
     * @notice Returns a page of a creator's unique supporters, oldest-first, alongside each
     *         supporter's cumulative tip count across all the creator's posts. Capped at
     *         MAX_BATCH_READ_COUNT per call.
     * @param _creator The creator's primary wallet address.
     * @param _offset Index of the first supporter to return.
     * @param _limit Maximum supporters to return (clamped to MAX_BATCH_READ_COUNT; 0 uses the max).
     * @return supporters Addresses of supporters in this page.
     * @return counts Each supporter's cumulative tip count for this creator (supporterTipCount), same order as `supporters`.
     * @return total Total unique supporter count for this creator.
     */
    function getSupporters(address _creator, uint256 _offset, uint256 _limit) external view returns (address[] memory supporters, uint256[] memory counts, uint256 total);

    /**
     * @notice Returns a page of the distinct tokens a post has ever been tipped in, alongside the
     *         cumulative gross amount tipped in each.
     * @dev Paginated — unlike a Bazaar listing's payment tokens, this set is tipper-controlled
     *      (any tipper can tip in any token), so it can grow unbounded and must not be read in
     *      full onchain.
     * @param _postId The ID of the post.
     * @param _offset Index of the first token to return.
     * @param _limit Maximum tokens to return (clamped to MAX_BATCH_READ_COUNT; 0 uses the max).
     * @return tokens Token addresses in this page (address(0) is the native token).
     * @return amounts Cumulative gross amount tipped in each token (tippedByToken), same order as `tokens`.
     * @return total Total distinct token count for this post.
     */
    function getTokensUsed(uint256 _postId, uint256 _offset, uint256 _limit) external view returns (address[] memory tokens, uint256[] memory amounts, uint256 total);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    /// @notice Enables or disables an ERC677 token for one-transaction tipping via onTokenTransfer.
    function setErc677Token(address _token, bool _enabled) external;
    function setTipFeeBps(uint256 _tipFeeBps) external;
    function setMaxMemoBytes(uint256 _maxMemoBytes) external;
    function withdrawAll(address payable _receiver) external;
    function withdrawAllToken(address _token, address _receiver, bool _isLsp7) external;
}
