// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupSell
 * @author Hup Labs
 * @notice Shared interface for the Hup Sell protocol.
 * @dev Defines the protocol's public structs, events, custom errors, and public interface used by
 *      HupSell-compatible contracts, clients, and offchain indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🔐
 */
interface IHupSell {
    // --- SHARED STRUCTS ---

    /// @dev A single gated-content listing tied to a Hup post. `contentURI` points at a blob the
    ///      SELLER encrypted client-side; this contract never sees a plaintext or a content key.
    struct Listing {
        uint256 price; // Price for one grant, in wei (native) or the payment token's base units
        uint256 quantity; // Remaining buyer slots; restored when a purchase is refunded
        bool isActive; // Flag indicating if the listing accepts new purchases
        address seller; // The post creator (grants keys, receives payment when no vault is set)
        address vault; // Optional payout address — address(0) pays the seller
        string contentURI; // Pointer to the client-encrypted content (e.g. an IPFS CID)
        address paymentToken; // Token the listing is priced in, or address(0) for the native token
        bool isLsp7; // True if paymentToken is an LSP7 Digital Asset (LUKSO) instead of an ERC20
        uint256 totalSold; // Cumulative COMPLETED sales — incremented on grant, never on purchase
    }

    /// @dev One buyer's escrowed purchase of one listing. Fields are ordered to pack into two
    ///      slots. `paymentToken`, `isLsp7` and `feeBps` are snapshotted at purchase time so a
    ///      later seller-side edit can never change what a pending escrow refunds or pays out.
    struct Purchase {
        uint256 amount; // Gross value held in escrow — exactly what a refund returns
        address paymentToken; // The token escrowed, snapshotted at purchase
        uint48 paidAt; // Purchase timestamp; the refund window is measured from here
        uint16 feeBps; // Buy fee snapshotted at purchase, applied only when the escrow releases
        bool isLsp7; // Token standard snapshotted at purchase
        bool granted; // True once the seller published a wrapped key — makes the escrow unrefundable
        bool refunded; // True once the buyer pulled their refund — makes the purchase ungrantable
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when a post creator lists gated content for sale.
    event ItemListed(uint256 indexed postId, address indexed seller, uint256 price, uint256 quantity, address paymentToken, bool isLsp7, address vault, string contentURI);

    /// @notice Emitted when a seller updates a listing.
    event ItemUpdated(uint256 indexed postId, uint256 price, uint256 quantity, bool isActive, address paymentToken, bool isLsp7, address vault, string contentURI);

    /// @notice Emitted when a buyer escrows payment for a listing.
    /// @dev `buyerPubKey` is the buyer's ECIES public key, carried in the event so a seller can
    ///      wrap the content key from log data alone — no extra read, and no database anywhere in
    ///      the path. This is the whole reason the key is a purchase argument rather than a
    ///      separate registration step.
    event ItemPurchased(uint256 indexed postId, address indexed buyer, address indexed seller, uint256 amount, address paymentToken, bytes buyerPubKey);

    /// @notice Emitted when the seller publishes the content key wrapped to a buyer's public key,
    ///         which simultaneously releases that buyer's escrow.
    event AccessGranted(uint256 indexed postId, address indexed buyer, uint256 netAmount, uint256 feeAmount);

    /// @notice Emitted when a buyer pulls their escrow back after the grant window expired.
    event PurchaseRefunded(uint256 indexed postId, address indexed buyer, uint256 amount);

    /// @notice Emitted when a buyer publishes a replacement public key and asks for a re-grant.
    /// @dev Carries no refund entitlement — see requestRegrant.
    event RegrantRequested(uint256 indexed postId, address indexed buyer, bytes buyerPubKey);

    /// @notice Emitted when a trusted forwarder's status is updated.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    /// @notice Emitted when the flat listing fee is updated.
    event ListingFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the percentage buy fee (in basis points) is updated.
    event BuyFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the maximum content URI byte length is updated.
    event MaxContentURIBytesUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when accumulated native fees are withdrawn by an admin.
    event Withdrawal(address indexed recipient, uint256 amount);

    /// @notice Emitted when accumulated token fees are withdrawn by an admin.
    event TokenWithdrawal(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
    event UnattributedDeposit(address indexed from, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error ContentDeleted();
    error NotCreator();
    error NotSeller();
    error AlreadyListed();
    error AlreadyPurchased();
    error AlreadyGranted();
    error AlreadyRefunded();
    /// @notice The listing's price, payment token, or token standard no longer matches what the
    ///         buyer committed to.
    error ListingChanged(uint256 currentPrice, address currentToken, bool currentIsLsp7);
    error InvalidPrice();
    error InvalidQuantity();
    error ListingNotActive();
    error InsufficientPayment(uint256 provided, uint256 required);
    error InsufficientFee();
    error InvalidFeeBps();
    error UnexpectedNativePayment();
    error OutOfStock();
    error TransferFailed();
    error NoPurchase();
    error RefundWindowOpen(uint256 claimableAt);
    error PubKeyTooLarge(uint256 length, uint256 maxLength);
    error WrappedKeyTooLarge(uint256 length, uint256 maxLength);
    error EmptyKey();
    error ContentURITooLarge(uint256 length, uint256 maxLength);
    error InvalidURILimit();
    error ArrayLengthMismatch();
    error BatchTooLarge();
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
            address vault,
            string memory contentURI,
            address paymentToken,
            bool isLsp7,
            uint256 totalSold
        );
    function purchases(uint256 postId, address buyer)
        external
        view
        returns (uint256 amount, address paymentToken, uint48 paidAt, uint16 feeBps, bool isLsp7, bool granted, bool refunded);
    /// @notice The content key wrapped to a buyer's public key — the entire access record, onchain.
    function wrappedKeys(uint256 postId, address buyer) external view returns (bytes memory);
    /// @notice The ECIES public key a buyer supplied, which the seller wraps the content key to.
    function buyerPubKeys(uint256 postId, address buyer) external view returns (bytes memory);
    function ADMIN_ROLE() external view returns (bytes32);
    function trustedForwarders(address forwarder) external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);
    function listingFee() external view returns (uint256);
    function buyFeeBps() external view returns (uint256);
    function FEE_DENOMINATOR() external view returns (uint256);
    function ABSOLUTE_MAX_BUY_FEE_BPS() external view returns (uint256);
    function GRANT_WINDOW() external view returns (uint256);
    function MAX_PUBKEY_BYTES() external view returns (uint256);
    function MAX_WRAPPED_KEY_BYTES() external view returns (uint256);
    function MAX_BATCH_SIZE() external view returns (uint256);
    function MAX_BUYERS_BATCH_READ_COUNT() external view returns (uint256);
    function maxContentURIBytes() external view returns (uint256);
    function ABSOLUTE_MAX_CONTENT_URI_BYTES() external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Lists gated content for sale against a Hup post.
     * @dev Only the original post creator can list it. Reverts with AlreadyListed if the post
     *      already has a listing — edits (including reactivation) must use updateListing so sales
     *      history is never silently reset.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _postId The ID of the post in Hup.
     * @param _price The price for one grant.
     * @param _quantity How many buyers may purchase before the listing sells out.
     * @param _paymentToken The token the listing is priced in, or address(0) for the native token.
     * @param _isLsp7 True if `_paymentToken` is an LSP7 Digital Asset instead of an ERC20.
     * @param _vault Optional payout address for sale proceeds, or address(0) to pay the seller.
     * @param _contentURI Pointer to the seller-encrypted content blob.
     * @param _sellerWrappedKey The listing's content key wrapped to the SELLER's own public key.
     *        Required, and the only copy they will ever have: it is what lets them re-read their
     *        own content to edit it, and what lets them wrap the key for each buyer. A seller who
     *        loses the vault identity behind it cannot grant or edit that listing again.
     */
    function listItem(
        address _owner,
        uint256 _postId,
        uint256 _price,
        uint256 _quantity,
        address _paymentToken,
        bool _isLsp7,
        address _vault,
        string calldata _contentURI,
        bytes calldata _sellerWrappedKey
    ) external payable;

    /**
     * @notice Updates a listing's price, stock, active status, payment token, vault, or content URI.
     * @dev Only the seller. Pending escrows are unaffected: each Purchase snapshots its own token,
     *      standard and fee at purchase time.
     *
     *      Deliberately cannot change the content key. Every buyer already holds that one key
     *      wrapped to them, so a new key would silently break every past sale. A seller editing
     *      the content decrypts with the key from wrappedKeys[postId][seller], re-encrypts under
     *      the same key, and points _contentURI at the new blob.
     */
    function updateListing(
        address _owner,
        uint256 _postId,
        uint256 _price,
        uint256 _quantity,
        bool _isActive,
        address _paymentToken,
        bool _isLsp7,
        address _vault,
        string calldata _contentURI
    ) external;

    /**
     * @notice Deactivates an active listing. Only the seller.
     */
    function cancelListing(address _owner, uint256 _postId) external;

    /**
     * @notice Escrows payment for one grant and publishes the buyer's public key for the seller.
     * @dev One purchase per buyer per listing. Funds are held by this contract, NOT forwarded to
     *      the seller — they move only when the seller grants access, or back to the buyer after
     *      GRANT_WINDOW. That escrow is what makes a seller-grants model trustless: a seller who
     *      takes payment and withholds the key never gets paid.
     *
     *      For native listings msg.value must exactly match the price. For token listings
     *      msg.value must be zero and the buyer must have pre-authorized this contract via
     *      `approve` (ERC20) or `authorizeOperator` (LSP7). Fee-on-transfer tokens are unsupported.
     * @param _owner The primary wallet address of the buyer (or address(0) if caller is primary).
     * @param _postId The ID of the listed post.
     * @param _expectedPrice The price the buyer saw when signing — must match the listing.
     * @param _expectedToken The payment token the buyer saw when signing — must match the listing.
     * @param _expectedIsLsp7 The token standard the buyer saw when signing — must match the listing.
     * @param _buyerPubKey The buyer's ECIES public key, derived client-side. The seller wraps the
     *        content key to this. Never a wallet private key and never derivable from one here.
     */
    function buy(
        address _owner,
        uint256 _postId,
        uint256 _expectedPrice,
        address _expectedToken,
        bool _expectedIsLsp7,
        bytes calldata _buyerPubKey
    ) external payable;

    /**
     * @notice Publishes the content key wrapped to one buyer's public key and releases their escrow.
     * @dev Only the seller. This is the only path by which a seller is paid.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _postId The ID of the listed post.
     * @param _buyer The buyer being granted access.
     * @param _wrappedKey The listing's content key, ECIES-encrypted to the buyer's public key.
     */
    function grantAccess(address _owner, uint256 _postId, address _buyer, bytes calldata _wrappedKey) external;

    /**
     * @notice Batch form of grantAccess — settles up to MAX_BATCH_SIZE buyers in one transaction.
     * @dev Skips (rather than reverts on) buyers who have no open purchase, so a batch prepared
     *      from a stale snapshot is not wholly rejected because one buyer refunded meanwhile.
     */
    function grantAccessBatch(
        address _owner,
        uint256 _postId,
        address[] calldata _buyers,
        bytes[] calldata _wrappedKeys
    ) external;

    /**
     * @notice Returns a buyer's full escrow after the seller failed to grant within GRANT_WINDOW.
     * @dev Buyer-pulled, never pushed. Refusing after a grant is what keeps the two paths
     *      mutually exclusive: an escrow is released to the seller or returned to the buyer,
     *      never both.
     */
    function claimRefund(uint256 _postId) external;

    /**
     * @notice Publishes a replacement public key and asks the seller to re-grant.
     * @dev For a buyer who lost their client-side identity (new PIN, new device with no vault).
     *      Deliberately does NOT clear `granted` or reopen the refund window — otherwise a buyer
     *      who had already read the content could re-arm a refund and take both.
     */
    function requestRegrant(address _owner, uint256 _postId, bytes calldata _buyerPubKey) external;

    // --- VIEW FUNCTIONS ---

    function getListing(uint256 _postId) external view returns (Listing memory);
    function getPurchase(uint256 _postId, address _buyer) external view returns (Purchase memory);

    /**
     * @notice True when a buyer may currently pull a refund.
     */
    function isRefundable(uint256 _postId, address _buyer) external view returns (bool);

    /**
     * @notice The timestamp from which a buyer's escrow becomes refundable, or 0 if there is no
     *         open purchase.
     */
    function refundableAt(uint256 _postId, address _buyer) external view returns (uint256);

    function getBuyerCount(uint256 _postId) external view returns (uint256);

    /**
     * @notice A page of a listing's buyers, oldest-first, with each one's grant state. This is
     *         what a seller's client reads to find who is still awaiting a key.
     */
    function getBuyers(
        uint256 _postId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory buyers, bool[] memory granted, bool[] memory refunded, uint256 total);

    /**
     * @notice A page of buyers still awaiting a key, with the public key to wrap for each.
     * @dev The seller's grant queue in one call — addresses and public keys together, so a client
     *      can build a grantAccessBatch without a second round trip per buyer.
     */
    function getPendingGrants(
        uint256 _postId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory buyers, bytes[] memory pubKeys, uint256 scanned);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    function setListingFee(uint256 _listingFee) external;
    function setBuyFeeBps(uint256 _buyFeeBps) external;
    function setMaxContentURIBytes(uint256 _maxContentURIBytes) external;

    /**
     * @notice Withdraws accumulated native fees.
     * @dev Withdraws only `collectedNative` — fees this contract has actually earned. Escrowed
     *      buyer funds are excluded by construction, so an admin can never touch them.
     */
    function withdrawFees(address payable _receiver) external;

    /**
     * @notice Withdraws accumulated fees in one payment token.
     * @dev Bounded by `collectedToken[_token]` for the same reason as withdrawFees.
     */
    function withdrawTokenFees(address _token, address _receiver, bool _isLsp7) external;

    function collectedNative() external view returns (uint256);
    function collectedToken(address token) external view returns (uint256);
}
