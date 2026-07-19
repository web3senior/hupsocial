// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupTrade
 * @author Hup Labs
 * @notice Shared interface for the Hup Trade protocol — non-custodial NFT sales embedded in
 *         Hup posts. Supports both ERC721 and LSP8 collections, priced in native coins, ERC20,
 *         or LSP7 tokens.
 * @dev Defines the protocol's public events, custom errors, structs, and public interface used
 *      by HupTrade-compatible contracts, clients, and offchain indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🖼️
 */
interface IHupTrade {
    // --- SHARED TYPES ---

    /// @notice Lifecycle state of a listing. `None` means the listingId does not exist.
    enum ListingStatus {
        None,
        Active,
        Sold,
        Cancelled
    }

    /// @notice A non-custodial NFT listing. The token never leaves the seller's wallet: the
    ///         contract only holds operator/approval rights and moves the token at sale time.
    /// @dev `tokenId` is stored as bytes32 for both standards; ERC721 ids are `uint256(tokenId)`.
    ///      `referralBps` is the share of the price paid to the referrer supplied at buy time
    ///      (e.g. the reposter whose share led to the sale); it falls back to the seller when no
    ///      referrer is provided.
    struct Listing {
        address seller;
        address collection;
        bytes32 tokenId;
        bool isLsp8;
        address token;
        bool isTokenLsp7;
        uint256 price;
        uint256 referralBps;
        uint256 listedAt;
        ListingStatus status;
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when a token is listed for sale. Together with ListingUpdated,
    ///         ListingCancelled, and Sold this is the single source of truth for offchain
    ///         indexers — full listing state is derivable from these four events alone.
    event Listed(uint256 indexed listingId, address indexed seller, address indexed collection, bytes32 tokenId, bool isLsp8, address token, bool isTokenLsp7, uint256 price, uint256 referralBps);

    /// @notice Emitted when a listing's price or payment terms are updated by its seller.
    event ListingUpdated(uint256 indexed listingId, address token, bool isTokenLsp7, uint256 price, uint256 referralBps);

    /// @notice Emitted when a listing is cancelled. `invalidated` is true when the contract
    ///         auto-cancelled a stale listing (the token changed hands outside a sale) while the
    ///         current owner relisted, rather than the seller cancelling explicitly.
    event ListingCancelled(uint256 indexed listingId, bool invalidated);

    /// @notice Emitted for every completed sale.
    /// @dev `price` is gross; the seller received `price - feeAmount - referralAmount`. The
    ///      seller/collection/tokenId are duplicated from Listed so indexers can record a trade
    ///      without a listing lookup.
    event Sold(uint256 indexed listingId, address indexed buyer, address indexed referral, address seller, address collection, bytes32 tokenId, address token, bool isTokenLsp7, uint256 price, uint256 feeAmount, uint256 referralAmount);

    /// @notice Emitted when a trusted forwarder's status is updated.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    /// @notice Emitted when the percentage trade fee (in basis points) is updated.
    event TradeFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when the Hup Core contract reference (burner session source) is rotated.
    event HupContractUpdated(address oldValue, address newValue);

    /// @notice Emitted when accumulated native fees are withdrawn by an admin.
    event Withdrawal(address indexed recipient, uint256 amount);

    /// @notice Emitted when accumulated token fees are withdrawn by an admin.
    event TokenWithdrawal(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
    event UnattributedDeposit(address indexed from, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidAmount();
    error InvalidFeeBps();
    error InvalidReferralBps();
    /// @notice The caller is not the token's current owner (list) or the listing's seller (update/cancel).
    error NotTokenOwner();
    /// @notice The contract has not been granted approval (ERC721) / operator rights (LSP8) for the token.
    error NotOperator();
    /// @notice The token already has an active listing by its current owner.
    error DuplicateListing(uint256 existingListingId);
    error ListingNotActive();
    /// @notice The listed token changed hands or the operator grant was revoked since listing.
    error StaleListing();
    /// @notice Buying your own listing is rejected.
    error SelfPurchase();
    /// @notice The referrer must be neither the buyer nor the seller.
    error InvalidReferral();
    error InsufficientPayment(uint256 provided, uint256 required);
    error UnexpectedNativePayment();
    error TransferFailed();
    error Unauthorized();
    error SessionExpired();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    function hupContract() external view returns (IHup);
    function ADMIN_ROLE() external view returns (bytes32);
    function trustedForwarders(address forwarder) external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);
    function tradeFeeBps() external view returns (uint256);
    function FEE_DENOMINATOR() external view returns (uint256);
    function ABSOLUTE_MAX_TRADE_FEE_BPS() external view returns (uint256);
    function MAX_REFERRAL_BPS() external view returns (uint256);
    /// @notice Total number of listings ever created; listing ids are 1..listingCount.
    function listingCount() external view returns (uint256);
    /// @notice The id of the token's currently active listing, or 0 when none.
    function activeListingOf(address collection, bytes32 tokenId) external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Lists an NFT for sale. Non-custodial: the caller keeps the token and must have
     *         granted this contract transfer rights beforehand — `approve(trade, tokenId)` or
     *         `setApprovalForAll(trade, true)` for ERC721, `authorizeOperator(trade, tokenId, "")`
     *         for LSP8.
     * @dev If the token has a leftover Active listing whose seller no longer owns the token, it
     *      is auto-cancelled (ListingCancelled with invalidated=true) and replaced.
     * @param _seller The primary wallet that owns the token (or address(0) if caller is primary).
     * @param _collection The NFT contract address.
     * @param _tokenId The token id as bytes32 (ERC721 ids are `bytes32(uint256(id))`).
     * @param _isLsp8 True if `_collection` is an LSP8 Identifiable Digital Asset instead of an ERC721.
     * @param _token The payment token, or address(0) for the native coin.
     * @param _isTokenLsp7 True if `_token` is an LSP7 Digital Asset instead of an ERC20.
     * @param _price The sale price in wei (native) or the payment token's base units. Must be > 0.
     * @param _referralBps Share of the price (basis points) paid to the buy-time referrer.
     * @return listingId The id of the created listing.
     */
    function list(address _seller, address _collection, bytes32 _tokenId, bool _isLsp8, address _token, bool _isTokenLsp7, uint256 _price, uint256 _referralBps) external returns (uint256 listingId);

    /**
     * @notice Updates the price / payment terms of an active listing. Seller only.
     */
    function updateListing(uint256 _listingId, address _token, bool _isTokenLsp7, uint256 _price, uint256 _referralBps) external;

    /**
     * @notice Cancels an active listing. Seller only.
     */
    function cancelListing(uint256 _listingId) external;

    /**
     * @notice Buys a listed NFT. For native pricing, msg.value must exactly match the listing
     *         price. For token pricing, msg.value must be zero and the buyer must have
     *         pre-authorized this contract for the price — `approve` (ERC20) or
     *         `authorizeOperator` (LSP7).
     * @dev The platform fee (tradeFeeBps) stays in the contract; the referral share goes to
     *      `_referral` when provided (falls back to the seller otherwise); the remainder goes
     *      directly to the seller's wallet. Fee-on-transfer/deflationary payment tokens are
     *      unsupported. Reverts with StaleListing if the token moved or the operator grant was
     *      revoked since listing.
     * @param _buyer The primary wallet of the buyer (or address(0) if caller is primary).
     * @param _listingId The id of the listing to buy.
     * @param _referral The referrer credited with the sale (e.g. the reposter whose share led
     *        here), or address(0) for none. Must be neither buyer nor seller.
     */
    function buy(address _buyer, uint256 _listingId, address _referral) external payable;

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Returns a listing by id (status None when the id does not exist).
     */
    function getListing(uint256 _listingId) external view returns (Listing memory);

    /**
     * @notice Returns whether a listing is currently purchasable: Active, seller still owns the
     *         token, and this contract still holds transfer rights. Clients should gate their
     *         buy UI on this rather than on status alone.
     */
    function isPurchasable(uint256 _listingId) external view returns (bool);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    function setTradeFeeBps(uint256 _tradeFeeBps) external;
    function setHupContract(address _hupAddress) external;
    function withdrawAll(address payable _receiver) external;
    function withdrawAllToken(address _token, address _receiver, bool _isLsp7) external;
}
