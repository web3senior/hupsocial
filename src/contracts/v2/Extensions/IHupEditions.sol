// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupEditions
 * @author Hup Labs
 * @notice Shared interface for the Hup Editions protocol — non-custodial sales of balance-based
 *         art. Covers LSP7 Digital Assets (LUKSO) and ERC1155 semi-fungibles, priced per edition
 *         and fillable in parts, paid in native coins, ERC20, or LSP7 tokens.
 * @dev The sibling of IHupTrade, which handles one-of-one assets (ERC721, LSP8). The two sets
 *      never overlap: an asset is balance-based or it is not, decided by its standard, so a
 *      listing is never ambiguous between the two protocols. Defines the public events, custom
 *      errors, structs, and interface used by clients and offchain indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🎨
 */
interface IHupEditions {
    // --- SHARED TYPES ---

    /// @notice Lifecycle state of a listing. `None` means the listingId does not exist.
    /// @dev A partially filled listing stays `Active`; it becomes `Sold` only when `remaining`
    ///      reaches zero.
    enum ListingStatus {
        None,
        Active,
        Sold,
        Cancelled
    }

    /// @notice The balance-based standard a listed collection speaks.
    enum AssetStandard {
        LSP7,
        ERC1155
    }

    /// @notice A non-custodial listing of fungible editions. The editions never leave the
    ///         seller's wallet: the contract holds only operator/approval rights and moves
    ///         editions at sale time.
    /// @dev `tokenId` is bytes32(0) for LSP7, which identifies an asset by contract alone;
    ///      ERC1155 ids are `bytes32(uint256(id))`. `unitPrice` is per edition, so a buyer taking
    ///      `quantity` pays `unitPrice * quantity`. `amount` is the quantity originally listed and
    ///      never changes; `remaining` counts down as fills settle.
    struct Listing {
        address seller;
        address collection;
        bytes32 tokenId;
        AssetStandard standard;
        address token;
        bool isTokenLsp7;
        uint256 unitPrice;
        uint256 amount;
        uint256 remaining;
        uint256 referralBps;
        uint256 listedAt;
        ListingStatus status;
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when editions are listed for sale. Together with ListingUpdated,
    ///         ListingCancelled, and Sold this is the single source of truth for offchain
    ///         indexers — full listing state is derivable from these four events alone.
    event Listed(uint256 indexed listingId, address indexed seller, address indexed collection, bytes32 tokenId, AssetStandard standard, address token, bool isTokenLsp7, uint256 unitPrice, uint256 amount, uint256 referralBps);

    /// @notice Emitted when a listing's unit price or payment terms are updated by its seller.
    /// @dev Quantity is never updated in place — changing it means cancelling and relisting, so
    ///      an indexer's `remaining` is only ever moved by Sold and ListingCancelled.
    event ListingUpdated(uint256 indexed listingId, address token, bool isTokenLsp7, uint256 unitPrice, uint256 referralBps);

    /// @notice Emitted when a listing is cancelled, carrying the quantity left unsold.
    /// @dev `invalidated` is true when the contract auto-cancelled a listing the seller could no
    ///      longer back (editions moved away, or the operator grant was reduced) while that same
    ///      seller relisted, rather than the seller cancelling explicitly.
    event ListingCancelled(uint256 indexed listingId, uint256 unsold, bool invalidated);

    /// @notice Emitted for every fill, whether partial or final.
    /// @dev `totalPrice` is gross for this fill; the seller received
    ///      `totalPrice - feeAmount - referralAmount`. `remaining` is the post-fill balance, so a
    ///      value of 0 means this fill closed the listing.
    ///
    ///      Unlike the one-of-one protocol's Sold, this does not repeat the seller, collection,
    ///      tokenId, or payment token. A listing can be filled many times, so duplicating five
    ///      static fields into every fill costs real log space — and because partial fills force
    ///      an indexer to carry listing rows anyway, it already has them keyed by listingId. The
    ///      four events remain the complete source of truth; a fill is simply joined to its
    ///      listing rather than self-contained.
    event Sold(uint256 indexed listingId, address indexed buyer, address indexed referral, uint256 quantity, uint256 totalPrice, uint256 feeAmount, uint256 referralAmount, uint256 remaining);

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
    /// @notice LSP7 identifies an asset by contract alone, so its listings must pass bytes32(0).
    error InvalidTokenId();
    /// @notice The LSP7 collection reports non-zero decimals, so a "quantity" would not be a whole
    ///         edition. Edition-style LSP7s are minted non-divisible.
    error DivisibleAsset();
    /// @notice The caller is not the listing's seller.
    error NotTokenOwner();
    /// @notice The seller's balance, or the allowance granted to this contract, is short of the
    ///         quantity being listed. `available` is the lesser of the two.
    error InsufficientBacking(uint256 required, uint256 available);
    /// @notice This seller already has an active, still-backed listing for the same asset.
    error DuplicateListing(uint256 existingListingId);
    error ListingNotActive();
    /// @notice The requested quantity exceeds what the listing still has unsold.
    error InsufficientSupply(uint256 requested, uint256 remaining);
    /// @notice The seller's editions moved, or the operator grant was reduced, since listing.
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
    /// @notice The id of this seller's active listing for the asset, or 0 when none. Unlike the
    ///         one-of-one protocol, the key includes the seller: many sellers hold editions of the
    ///         same asset and may list concurrently.
    function activeListingOf(address collection, bytes32 tokenId, address seller) external view returns (uint256);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Lists editions for sale. Non-custodial: the caller keeps the editions and must have
     *         granted this contract transfer rights beforehand — `authorizeOperator(editions,
     *         amount, "")` for LSP7, `setApprovalForAll(editions, true)` for ERC1155.
     * @dev If this seller has a leftover Active listing for the same asset that they can no longer
     *      back, it is auto-cancelled (ListingCancelled with invalidated=true) and replaced;
     *      a listing that is still fully backed reverts as a duplicate instead.
     * @param _seller The primary wallet holding the editions (or address(0) if caller is primary).
     * @param _collection The asset contract address.
     * @param _tokenId bytes32(0) for LSP7; `bytes32(uint256(id))` for ERC1155.
     * @param _standard Which balance-based standard `_collection` speaks.
     * @param _token The payment token, or address(0) for the native coin.
     * @param _isTokenLsp7 True if `_token` is an LSP7 Digital Asset instead of an ERC20.
     * @param _unitPrice Price of a single edition, in wei (native) or the payment token's base
     *        units. Must be > 0.
     * @param _amount How many editions to list. Must be > 0 and fully backed at list time.
     * @param _referralBps Share of each fill (basis points) paid to the buy-time referrer.
     * @return listingId The id of the created listing.
     */
    function list(address _seller, address _collection, bytes32 _tokenId, AssetStandard _standard, address _token, bool _isTokenLsp7, uint256 _unitPrice, uint256 _amount, uint256 _referralBps) external returns (uint256 listingId);

    /**
     * @notice Updates the unit price / payment terms of an active listing. Seller only. Quantity
     *         is not updatable — cancel and relist to change it.
     */
    function updateListing(uint256 _listingId, address _token, bool _isTokenLsp7, uint256 _unitPrice, uint256 _referralBps) external;

    /**
     * @notice Cancels an active listing, forfeiting whatever is still unsold. Seller only.
     */
    function cancelListing(uint256 _listingId) external;

    /**
     * @notice Buys `_quantity` editions from a listing. For native pricing, msg.value must exactly
     *         match `unitPrice * _quantity`. For token pricing, msg.value must be zero and the
     *         buyer must have pre-authorized this contract for that total — `approve` (ERC20) or
     *         `authorizeOperator` (LSP7).
     * @dev Partial fills are the norm: the listing stays Active and only closes when the last
     *      edition sells. The platform fee (tradeFeeBps) stays in the contract; the referral share
     *      goes to `_referral` when provided; the remainder goes directly to the seller's wallet.
     *      Fee-on-transfer/deflationary payment tokens are unsupported. Reverts with StaleListing
     *      if the seller can no longer back this quantity.
     * @param _buyer The primary wallet of the buyer (or address(0) if caller is primary).
     * @param _listingId The id of the listing to buy from.
     * @param _quantity How many editions to take. Must be > 0 and <= the listing's remaining.
     * @param _referral The referrer credited with the sale, or address(0) for none. Must be
     *        neither buyer nor seller.
     */
    function buy(address _buyer, uint256 _listingId, uint256 _quantity, address _referral) external payable;

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Returns a listing by id (status None when the id does not exist).
     */
    function getListing(uint256 _listingId) external view returns (Listing memory);

    /**
     * @notice Returns how many editions can actually be bought right now: the lesser of the
     *         listing's `remaining` and what the seller still holds and has authorized. Zero for
     *         any listing that is not Active. Clients should size their quantity picker on this
     *         rather than on `remaining` alone.
     */
    function availableOf(uint256 _listingId) external view returns (uint256);

    /**
     * @notice Returns whether `_quantity` editions are purchasable from this listing right now.
     */
    function isPurchasable(uint256 _listingId, uint256 _quantity) external view returns (bool);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    function setTradeFeeBps(uint256 _tradeFeeBps) external;
    function setHupContract(address _hupAddress) external;
    function withdrawAll(address payable _receiver) external;
    function withdrawAllToken(address _token, address _receiver, bool _isLsp7) external;
}
