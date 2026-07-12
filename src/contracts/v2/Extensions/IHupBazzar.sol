// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupBazzar
 * @author Hup Labs
 * @notice Shared interface for the Hup Bazzar protocol.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used
 *      by HupBazzar-compatible contracts, clients, and offchain indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🛍️
 */
interface IHupBazzar {
    // --- SHARED STRUCTS ---

    /// @dev Defines the structure for a single item listing tied to a Hup post.
    struct Listing {
        uint256 price; // Price per item, in wei (native) or the payment token's base units
        uint256 quantity; // Remaining stock available for purchase
        bool isActive; // Flag indicating if listing is active
        address seller; // Address of the item seller (receives payment)
        string metadata; // Optional pointer (e.g. an IPFS CID of server-encrypted content) unlocked on purchase
        address paymentToken; // Token the listing is priced in, or address(0) for the native token
        bool isLsp7; // True if paymentToken is an LSP7 Digital Asset (LUKSO) instead of an ERC20
        uint256 totalSold; // Cumulative units sold, never reset by price/quantity edits (currency-agnostic)
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when a post creator lists a new item for sale.
    event ItemListed(uint256 indexed postId, address indexed seller, uint256 price, uint256 quantity, address paymentToken, bool isLsp7, string metadata);

    /// @notice Emitted when a seller updates a listing's price, stock, active status, payment token, or metadata.
    event ItemUpdated(uint256 indexed postId, uint256 price, uint256 quantity, bool isActive, address paymentToken, bool isLsp7, string metadata);

    /// @notice Emitted when an operator records an externally settled purchase (e.g. an x402 payment).
    event PurchaseGranted(uint256 indexed postId, address indexed buyer, address indexed operator, uint256 quantity);

    /// @notice Emitted when accumulated ERC20 fees are withdrawn by an admin.
    event TokenWithdrawal(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when the maximum listing metadata byte length is updated.
    event MaxMetadataBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when a buyer successfully purchases from a listing.
    /// @dev `paymentToken` and `feeAmount` are included so indexers can attribute each sale to a
    ///      settlement token and fee without replaying listing state. `feeAmount` is 0 for
    ///      operator-granted purchases (settled outside the contract). `memo` is never stored —
    ///      it exists only in this event, for optional future use (e.g. an order reference)
    ///      without adding storage cost to every purchase.
    event ItemBought(uint256 indexed postId, address indexed buyer, address indexed seller, uint256 price, uint256 quantityBought, address paymentToken, uint256 feeAmount, bytes memo);

    /// @notice Emitted when a trusted forwarder's status is updated.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    /// @notice Emitted when the flat listing fee is updated.
    event ListingFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the percentage buy fee (in basis points) is updated.
    event BuyFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when accumulated fees are withdrawn by an admin.
    event Withdrawal(address indexed recipient, uint256 amount);

    /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
    event UnattributedDeposit(address indexed from, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error ContentDeleted();
    error NotCreator();
    error AlreadyListed();
    /// @notice The listing's price or payment token no longer matches what the buyer committed to.
    error ListingChanged(uint256 currentPrice, address currentToken);
    error InvalidPrice();
    error InvalidQuantity();
    error ListingNotActive();
    error InsufficientPayment(uint256 provided, uint256 required);
    error InsufficientFee();
    error InvalidFeeBps();
    error MetadataTooLarge(uint256 length, uint256 maxLength);
    error InvalidMetadataLimit();
    error UnexpectedNativePayment();
    error OutOfStock();
    error TransferFailed();
    error NotSeller();
    error Unauthorized();
    error SessionExpired();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function hupContract() external view returns (IHup);
    function listings(uint256 postId)
        external
        view
        returns (
            uint256 price,
            uint256 quantity,
            bool isActive,
            address seller,
            string memory metadata,
            address paymentToken,
            bool isLsp7,
            uint256 totalSold
        );
    function amountPurchased(uint256 postId, address buyer) external view returns (uint256);
    /// @notice Cumulative gross revenue (pre-fee) a listing has earned in a specific payment token.
    /// @dev Tracked per-token (rather than one flat sum) so revenue stays correct even if a seller
    ///      changes a listing's payment token after some sales already happened in a different one.
    function revenueByToken(uint256 postId, address token) external view returns (uint256);
    /// @notice A buyer's cumulative quantity purchased in one specific payment token.
    /// @dev Lets amountPurchased's total be broken out by exactly which token(s) a buyer paid
    ///      with, correct even across multiple payment-token switches on a listing.
    function buyerAmountByToken(uint256 postId, address buyer, address token) external view returns (uint256);
    function ADMIN_ROLE() external view returns (bytes32);
    function OPERATOR_ROLE() external view returns (bytes32);
    function trustedForwarders(address forwarder) external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);
    function listingFee() external view returns (uint256);
    function buyFeeBps() external view returns (uint256);
    function FEE_DENOMINATOR() external view returns (uint256);
    function ABSOLUTE_MAX_BUY_FEE_BPS() external view returns (uint256);
    function maxMetadataBytes() external view returns (uint256);
    function ABSOLUTE_MAX_METADATA_BYTES() external view returns (uint256);
    function MAX_BUYERS_BATCH_READ_COUNT() external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Lists a new item for sale associated with a Hup post.
     * @dev Only the original post creator can list it for sale. Reverts with AlreadyListed if the
     *      post already has a listing — edits (including reactivation) must use updateListing so
     *      purchase history (totalSold, buyers, revenue) is never silently reset.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _postId The ID of the post in Hup.
     * @param _price The price per unit, in wei (native) or the payment token's base units.
     * @param _quantity The initial stock quantity available.
     * @param _paymentToken The token the listing is priced in, or address(0) for the native token.
     * @param _isLsp7 True if `_paymentToken` is an LSP7 Digital Asset instead of an ERC20.
     * @param _metadata Optional pointer (e.g. an IPFS CID of server-encrypted content) unlocked on purchase.
     */
    function listItem(
        address _owner,
        uint256 _postId,
        uint256 _price,
        uint256 _quantity,
        address _paymentToken,
        bool _isLsp7,
        string calldata _metadata
    ) external payable;

    /**
     * @notice Updates the pricing, quantity, active status, payment token, and/or metadata of a listing.
     * @dev Only the seller of the listing can execute this.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _postId The ID of the listed post.
     * @param _price The new price per unit.
     * @param _quantity The new remaining stock quantity.
     * @param _isActive True to enable sales, false to temporarily deactivate listings.
     * @param _paymentToken The new payment token, or address(0) for the native token.
     * @param _isLsp7 True if `_paymentToken` is an LSP7 Digital Asset instead of an ERC20.
     * @param _metadata The updated content pointer.
     */
    function updateListing(
        address _owner,
        uint256 _postId,
        uint256 _price,
        uint256 _quantity,
        bool _isActive,
        address _paymentToken,
        bool _isLsp7,
        string calldata _metadata
    ) external;

    /**
     * @notice Deactivates an active listing.
     * @dev Only the seller of the listing can execute this.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _postId The ID of the listed post.
     */
    function cancelListing(address _owner, uint256 _postId) external;

    /**
     * @notice Purchases a specified quantity of items from a listing.
     * @dev For native listings, msg.value must exactly match price * quantityBought. For token
     *      listings, msg.value must be zero and the buyer must have pre-authorized the bazzar for
     *      the total — via `approve` (ERC20) or `authorizeOperator` (LSP7). Reverts with
     *      ListingChanged if the listing's price or payment token differs from what the buyer
     *      committed to, so a seller-side updateListing can never drain a standing allowance.
     *      Fee-on-transfer/deflationary payment tokens are unsupported.
     * @param _buyer The primary wallet address of the buyer (or address(0) if caller is primary).
     * @param _postId The ID of the listed post.
     * @param _quantityBought The number of items to purchase.
     * @param _expectedPrice The per-unit price the buyer saw when signing — must match the listing.
     * @param _expectedToken The payment token the buyer saw when signing — must match the listing.
     * @param _memo Optional opaque data emitted with ItemBought (e.g. a future order reference).
     *        Never stored — capped at maxMetadataBytes since it's only ever calldata + a log.
     */
    function buyItem(
        address _buyer,
        uint256 _postId,
        uint256 _quantityBought,
        uint256 _expectedPrice,
        address _expectedToken,
        bytes calldata _memo
    ) external payable;

    /**
     * @notice Records a purchase that was settled outside this contract (e.g. an x402 USDC payment
     *         submitted via EIP-3009 transferWithAuthorization directly to the seller).
     * @dev Callable only by OPERATOR_ROLE. Decrements stock and credits `amountPurchased` exactly
     *      like buyItem, but moves no funds — settlement is verified by the operator offchain.
     *      Revenue is credited in the listing's current payment token at the listing price, so
     *      the operator MUST only grant purchases that actually settled in that token at (or
     *      above) that price — otherwise revenue stats are inflated.
     * @param _postId The ID of the listed post.
     * @param _buyer The buyer to credit the purchase to.
     * @param _quantity The number of items purchased.
     * @param _memo Optional opaque data emitted with ItemBought. See buyItem.
     */
    function grantPurchase(uint256 _postId, address _buyer, uint256 _quantity, bytes calldata _memo) external;

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Retrieves listing details for a post.
     * @param _postId The ID of the post.
     * @return Listing struct containing price, quantity, active status, and seller.
     */
    function getListing(uint256 _postId) external view returns (Listing memory);

    /**
     * @notice Returns the total number of unique addresses that have ever bought from a listing.
     * @param _postId The ID of the post.
     */
    function getBuyerCount(uint256 _postId) external view returns (uint256);

    /**
     * @notice Returns a page of a listing's unique buyers, oldest-first, alongside each buyer's
     *         cumulative quantity purchased. Capped at MAX_BUYERS_BATCH_READ_COUNT per call to
     *         bound gas regardless of how many buyers a listing has accumulated.
     * @param _postId The ID of the post.
     * @param _offset Index of the first buyer to return.
     * @param _limit Maximum buyers to return (clamped to MAX_BUYERS_BATCH_READ_COUNT; 0 uses the max).
     * @return buyers Addresses of buyers in this page.
     * @return amounts Each buyer's cumulative quantity purchased (amountPurchased), same order as `buyers`.
     * @return total Total unique buyer count for this listing.
     */
    function getBuyers(
        uint256 _postId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory buyers, uint256[] memory amounts, uint256 total);

    /**
     * @notice Returns every distinct payment token a listing has ever been purchased under.
     * @dev Unpaginated — bounded by how many times a seller has changed a listing's payment
     *      token, not by buyer or purchase count, so it can't grow unbounded like buyers can.
     * @param _postId The ID of the post.
     */
    function getTokensUsed(uint256 _postId) external view returns (address[] memory);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    function setListingFee(uint256 _listingFee) external;
    function setBuyFeeBps(uint256 _buyFeeBps) external;
    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external;
    function withdrawAll(address payable _receiver) external;
    function withdrawAllToken(address _token, address _receiver, bool _isLsp7) external;
}
