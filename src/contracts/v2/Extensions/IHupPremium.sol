// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title ILSP7Minimal
 * @author Hup Labs
 * @notice The three LSP7 functions this contract needs, declared locally.
 * @dev Deliberately not an `@lukso/lsp7-contracts` import: that package carries its own nested
 *      OpenZeppelin 4.9.6, and pulling it in would drag HupPremium out of the workspace's OZ
 *      5.6.1 profile for the sake of three selectors. `transfer` has kept the selector
 *      transfer(address,address,uint256,bool,bytes) across every LSP7 version — only the fourth
 *      parameter's NAME changed (allowNonLSP1Recipient -> force), which a selector never sees.
 */
interface ILSP7Minimal {
    function balanceOf(address account) external view returns (uint256);

    function decimals() external view returns (uint8);

    function transfer(address from, address to, uint256 amount, bool force, bytes memory data) external;
}

/**
 * @title IHupPremium
 * @author Hup Labs
 * @notice Shared interface for Hup Premium — a paid subscription whose whole state is one
 *         expiry timestamp per account.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used
 *      by HupPremium-compatible contracts, clients, and offchain indexers.
 *
 *      A plan carries ONE native price, in the wei of the chain it is deployed to, and may
 *      additionally accept tokens at prices set per (plan, token). The two are separate on
 *      purpose: a native price is a peg an admin has to maintain against a moving coin, while a
 *      stablecoin price is simply the price. Clients must read both rather than assume either.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji ⭐
 */
interface IHupPremium {
    // --- SHARED STRUCTS ---

    /// @dev One purchasable term. `price` is the NATIVE price; token prices live beside it in
    ///      `tokenPrices`. Duration never changes in practice; price tracks the coin.
    struct Plan {
        uint64 duration; // Seconds of premium this plan grants
        uint256 price; // Native wei charged for it
        bool enabled; // False takes the plan off sale without erasing its terms
    }

    /// @dev What one token buys one plan for. `enabled` is separate from a zero price so an
    ///      accepted-but-free token can never be confused with an unconfigured one.
    struct TokenPrice {
        uint256 price; // In the token's own base units
        bool enabled;
    }

    /// @dev How a token has to be moved. Resolved once when a price is set, never per purchase.
    enum TokenStandard {
        NONE,
        ERC20,
        LSP7
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when premium is bought, renewed, or gifted with the native coin.
    /// @dev `payer` differs from `account` only for a gift. `paid` is the plan price actually
    ///      charged, never the raw msg.value, so indexers can sum revenue without subtracting
    ///      refunded overpayment.
    event Subscribed(address indexed account, address indexed payer, uint8 indexed planId, uint256 paid, uint64 expiresAt);

    /// @notice Emitted when premium is bought, renewed, or gifted with a token.
    /// @dev Separate from `Subscribed` rather than carrying a zero-address token on it, so the
    ///      native event keeps the signature every existing indexer and client already parses.
    event SubscribedWithToken(
        address indexed account,
        address indexed payer,
        uint8 indexed planId,
        address token,
        uint256 paid,
        uint64 expiresAt
    );

    /// @notice Emitted when a moderator credits premium without payment — support and make-goods.
    /// @dev The term expires on its own. For premium that should simply not expire, see
    ///      ComplimentarySet, which is a flag rather than a term.
    event PremiumGranted(address indexed account, address indexed admin, uint64 duration, uint64 expiresAt);

    /// @notice Emitted when an account is added to, or removed from, the complimentary list.
    /// @dev Deliberately not expressed as a very long grantPremium: a comp is a standing
    ///      decision someone may need to take back, and a term already written cannot be.
    event ComplimentarySet(address indexed account, bool granted, address indexed moderator);

    /// @notice Emitted when a plan's terms or native price change, and on each plan seeded at construction.
    event PlanUpdated(uint8 indexed planId, uint64 duration, uint256 price, bool enabled);

    /// @notice Emitted when a token's price for a plan is set, repriced, or withdrawn from sale.
    /// @dev Carries the resolved standard so an indexer never has to probe the token itself.
    event TokenPriceUpdated(uint8 indexed planId, address indexed token, uint256 price, bool enabled, TokenStandard standard);

    /// @notice Emitted when a token's resolved standard is overridden by an admin.
    event TokenStandardUpdated(address indexed token, TokenStandard standard);

    /// @notice Emitted when accumulated native revenue is withdrawn by an admin.
    event Withdrawal(address indexed recipient, uint256 amount);

    /// @notice Emitted when accumulated token revenue is withdrawn by an admin.
    event TokenWithdrawal(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
    event UnattributedDeposit(address indexed from, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidPlan();
    /// @notice The plan id is not on sale — never defined, or withdrawn by an admin.
    error PlanUnavailable(uint8 planId);
    /// @notice This plan does not take this token, or no longer does.
    error TokenNotAccepted(uint8 planId, address token);
    /// @notice address(0) means "the native coin", which the token entry points never handle.
    error InvalidToken();
    error InsufficientPayment(uint256 sent, uint256 price);
    error TransferFailed();
    error Unauthorized();
    /// @notice A batch was empty or longer than MAX_BATCH.
    error InvalidBatch(uint256 length);

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function expiresAt(address account) external view returns (uint64);
    function plans(uint8 planId) external view returns (uint64 duration, uint256 price, bool enabled);
    function tokenPrices(uint8 planId, address token) external view returns (uint256 price, bool enabled);
    function tokenStandards(address token) external view returns (TokenStandard standard);
    function PLAN_MONTHLY() external view returns (uint8);
    function PLAN_YEARLY() external view returns (uint8);
    function MAX_BATCH() external view returns (uint256);
    function ADMIN_ROLE() external view returns (bytes32);
    function MODERATOR_ROLE() external view returns (bytes32);
    /// @notice Premium that does not expire, until a moderator takes it back.
    function complimentary(address account) external view returns (bool);
    function complimentaryCount() external view returns (uint256);

    // --- VIEWS ---

    function isPremium(address account) external view returns (bool);
    function getPlan(uint8 planId) external view returns (Plan memory);
    function getPlans(uint8[] calldata planIds) external view returns (Plan[] memory);
    function getTokenPrices(uint8 planId, address[] calldata tokens) external view returns (TokenPrice[] memory);

    // --- LOGIC ---

    function subscribe(uint8 planId) external payable returns (uint64 expiry);
    function subscribeFor(address account, uint8 planId) external payable returns (uint64 expiry);
    function subscribeWithToken(uint8 planId, address token) external returns (uint64 expiry);
    function subscribeForWithToken(address account, uint8 planId, address token) external returns (uint64 expiry);
}
