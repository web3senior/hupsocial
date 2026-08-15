// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./../IHup.sol";

/**
 * @title IHupOffers
 * @author Hup Labs
 * @notice Shared interface for the Hup Offers protocol — escrow-backed buy offers and OTC deals
 *         on every asset kind Hup trades: one-of-one NFTs (ERC721, LSP8), balance-based editions
 *         (ERC1155, non-divisible LSP7), and fungible tokens (divisible LSP7, ERC20, the native
 *         coin itself). The offerer escrows the payment side up front — native coins, ERC20, or
 *         LSP7 — so a fill can never bounce on a stale allowance; the asset side stays
 *         non-custodial and is delivered by whoever fills the offer. Whitelisted ERC677 tokens
 *         (e.g. GoodDollar) can fund or fill an offer in a single transferAndCall transaction.
 * @dev The buy-side complement of IHupTrade (one-of-one listings) and IHupEditions (edition
 *      listings). One contract covers all six asset standards because an offer's shape does not
 *      diverge across them the way a listing's does: a one-of-one offer is simply a quantity
 *      offer with amount = 1. Defines the protocol's public events, custom errors, structs, and
 *      public interface used by HupOffers-compatible contracts, clients, and offchain indexers.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🤝
 */
interface IHupOffers {
    // --- SHARED TYPES ---

    /// @notice Lifecycle state of an offer. `None` means the offerId does not exist.
    /// @dev A partially filled offer stays `Active`; it becomes `Filled` only when `remaining`
    ///      reaches zero. Expiry is lazy: an expired offer stays `Active` in storage but refuses
    ///      fills, and the offerer reclaims its escrow through cancelOffer.
    enum OfferStatus {
        None,
        Active,
        Filled,
        Cancelled
    }

    /// @notice The standard of the asset an offer wants to receive. `NATIVE` is the chain's own
    ///         coin, which has no contract: its delivery is the value attached to the fill call.
    enum AssetStandard {
        ERC721,
        LSP8,
        ERC1155,
        LSP7,
        ERC20,
        NATIVE
    }

    /// @notice An escrow-backed offer. `price` is the TOTAL payment escrowed in this contract
    ///         for the full `amount` of the asset; the asset side is non-custodial and checked
    ///         only at fill time.
    /// @dev `tokenId` is bytes32(0) for the contract-identified standards (LSP7, ERC20, NATIVE);
    ///      ERC721/ERC1155 ids are `bytes32(uint256(id))`. `partialFillable` is resolved at
    ///      creation: true for whole-unit assets (ERC1155, 0-decimal LSP7 editions) where fills
    ///      pay `price * quantity / amount` exactly (price must divide evenly by amount); false
    ///      for one-of-ones and divisible fungibles (LSP7 with decimals, ERC20, NATIVE), which
    ///      fill all-or-nothing so no rounding can exist. `counterparty` locks who may fill —
    ///      address(0) means anyone — turning a negotiated OTC deal into a private settlement
    ///      that cannot be sniped. `remaining` counts down as fills settle; the escrow still
    ///      held is always `price * remaining / amount`.
    /// @dev `feeBps` is the platform fee as it stood when the offer was made, not as it stands
    ///      when the offer settles. Reading it live would let an admin raise the rate under a
    ///      pending offer and take up to the cap out of a seller's proceeds after they had
    ///      already decided to fill; snapshotting means the terms a seller reads are the terms
    ///      they get, and a rate change only ever applies to offers made after it.
    struct Offer {
        address offerer;
        address counterparty;
        address collection;
        bytes32 tokenId;
        AssetStandard standard;
        bool partialFillable;
        address token;
        bool isTokenLsp7;
        uint256 price;
        uint256 amount;
        uint256 remaining;
        uint256 expiresAt;
        uint256 createdAt;
        uint256 feeBps;
        OfferStatus status;
    }

    // --- SHARED EVENTS ---

    /// @notice Emitted when an offer is created and its escrow locked. Together with OfferFilled
    ///         and OfferCancelled this is the single source of truth for offchain indexers —
    ///         full offer state is derivable from these three events alone.
    event OfferMade(uint256 indexed offerId, address indexed offerer, address indexed collection, bytes32 tokenId, AssetStandard standard, bool partialFillable, address token, bool isTokenLsp7, uint256 price, uint256 amount, uint256 expiresAt, address counterparty);

    /// @notice Emitted for every fill, whether partial or final.
    /// @dev `payout` is gross for this fill; the seller received `payout - feeAmount` from
    ///      escrow. `remaining` is the post-fill balance, so a value of 0 means this fill closed
    ///      the offer. Static offer fields are not repeated — an offer can be filled many times,
    ///      and an indexer already carries offer rows keyed by offerId from OfferMade, so a fill
    ///      is joined to its offer rather than self-contained (the same rationale as the
    ///      editions protocol's Sold).
    event OfferFilled(uint256 indexed offerId, address indexed seller, uint256 quantity, uint256 payout, uint256 feeAmount, uint256 remaining);

    /// @notice Emitted when an offer is cancelled and its remaining escrow refunded, carrying
    ///         the quantity left unfilled. `replaced` is true when the contract auto-cancelled
    ///         the offerer's previous active offer on the same asset to make room for a new one,
    ///         rather than the offerer cancelling explicitly.
    event OfferCancelled(uint256 indexed offerId, uint256 unfilled, bool replaced);

    /// @notice Emitted when an ERC677 token is enabled or disabled for one-transaction
    ///         offer funding and filling via onTokenTransfer.
    event Erc677TokenUpdated(address indexed token, bool enabled);

    /// @notice Emitted when a trusted forwarder's status is updated.
    event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

    /// @notice Emitted when the percentage offer fee (in basis points) is updated. Applies to
    ///         offers made after it: existing offers settle at the rate they snapshotted.
    event OfferFeeUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Emitted when accrued fees for a payment token (address(0) = native) are withdrawn
    ///         by an admin. Escrowed offer funds can never be withdrawn — only accrued fees.
    event FeesWithdrawn(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when the contract receives a plain, unattributed native token deposit.
    ///         The value is added to the native fee pool so it stays recoverable — per-offer
    ///         escrow accounting is untouched by it.
    event UnattributedDeposit(address indexed from, uint256 amount);

    // --- SHARED ERRORS ---

    error InvalidAddress();
    error InvalidAmount();
    error InvalidFeeBps();
    /// @notice The expiry is in the past, or further out than MAX_OFFER_LIFETIME.
    error InvalidExpiry();
    /// @notice Contract-identified standards (LSP7, ERC20, NATIVE) must pass bytes32(0).
    error InvalidTokenId();
    /// @notice A partial-fillable offer's total price must divide evenly by its amount, so every
    ///         fill settles exactly with no rounding remainder.
    error IndivisiblePrice();
    /// @notice The asset and the payment token cannot be the same thing — including offering
    ///         native for native.
    error SameToken();
    /// @notice Offering on a one-of-one token you currently own is rejected.
    error SelfOffer();
    /// @notice Filling your own offer is rejected; so is locking an offer to yourself.
    error SelfFill();
    error OfferNotActive();
    error OfferExpired();
    /// @notice The offer is locked to a specific counterparty, and the caller is not it.
    error NotCounterparty();
    /// @notice All-or-nothing offers (one-of-ones and divisible fungibles) must be filled with
    ///         the exact remaining quantity.
    error PartialFillNotAllowed();
    /// @notice The requested quantity exceeds what the offer still seeks.
    error InsufficientRemaining(uint256 requested, uint256 remaining);
    /// @notice The seller cannot back this fill: for one-of-ones, they don't own the token or
    ///         this contract lacks transfer rights (available is 0 or 1); for balance-based
    ///         assets, their balance or the allowance granted to this contract is short.
    error InsufficientBacking(uint256 required, uint256 available);
    error InsufficientPayment(uint256 provided, uint256 required);
    /// @notice The payment token delivered less than the offer's price — a fee-on-transfer or
    ///         rebasing token. Escrow is credited at face value, so accepting a short delivery
    ///         would let this offer's refunds and payouts draw on other offers' escrow in the
    ///         same token.
    error EscrowShortfall(uint256 expected, uint256 received);
    /// @notice A contract offerer on an ERC1155 offer that cannot receive one. safeTransferFrom
    ///         calls onERC1155Received, so such an offer could never be filled, and every
    ///         attempt would burn a seller's gas.
    error UnsupportedReceiver();
    error UnexpectedNativePayment();
    /// @notice onTokenTransfer was called by a contract that is not a whitelisted ERC677 token.
    error UnsupportedToken();
    /// @notice An ERC677 payload is missing, malformed, carries an unknown action, or targets an
    ///         offer whose asset is not the calling token.
    error InvalidOfferData();
    error TransferFailed();
    error Unauthorized();
    error SessionExpired();

    // --- STATE GETTERS ---

    function version() external pure returns (string memory);
    /// @notice The Hup Core reference used to resolve burner sessions. Fixed at deployment.
    function hupContract() external view returns (IHup);
    function ADMIN_ROLE() external view returns (bytes32);
    function trustedForwarders(address forwarder) external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);
    function offerFeeBps() external view returns (uint256);
    function FEE_DENOMINATOR() external view returns (uint256);
    function ABSOLUTE_MAX_OFFER_FEE_BPS() external view returns (uint256);
    /// @notice The furthest into the future an offer's expiry may sit at creation time.
    function MAX_OFFER_LIFETIME() external view returns (uint256);
    /// @notice ERC677 payload action byte: fund and create a new offer.
    function ERC677_ACTION_MAKE() external view returns (uint8);
    /// @notice ERC677 payload action byte: deliver the asset side and fill an existing offer.
    function ERC677_ACTION_FILL() external view returns (uint8);
    /// @notice Total number of offers ever created; offer ids are 1..offerCount.
    function offerCount() external view returns (uint256);
    /// @notice The id of this offerer's active offer on the asset, or 0 when none. One active
    ///         offer per asset per offerer; making another auto-cancels and refunds the old one.
    ///         NATIVE-asset offers key under collection address(0).
    function activeOfferOf(address collection, bytes32 tokenId, address offerer) external view returns (uint256);
    /// @notice Fees accrued and withdrawable per payment token (address(0) = native). Everything
    ///         else the contract holds is live offer escrow and cannot be touched by admins.
    function accruedFees(address token) external view returns (uint256);
    /// @notice True if the token is whitelisted for one-transaction ERC677 funding and filling.
    function erc677Tokens(address token) external view returns (bool);

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Creates an offer and escrows its full payment. For native payment, msg.value must
     *         exactly match `_price`. For token payment, msg.value must be zero and the offerer
     *         must have pre-authorized this contract for `_price` — `approve` (ERC20) or
     *         `authorizeOperator` (LSP7). Whitelisted ERC677 tokens can skip the approval and
     *         fund in one transaction via transferAndCall instead (see onTokenTransfer).
     * @dev If the offerer already has an active offer on the same asset, it is auto-cancelled
     *      and its remaining escrow refunded (OfferCancelled with replaced=true) before the new
     *      offer is created. One-of-one standards force `_amount` = 1 and reject offering on a
     *      token the offerer currently owns. Partial-fillable standards (ERC1155, 0-decimal
     *      LSP7) require `_price % _amount == 0`. Fee-on-transfer/deflationary payment tokens
     *      are unsupported: the contract escrows the gross amount and pays shares out of it.
     * @param _offerer The primary wallet funding the offer (or address(0) if caller is primary).
     * @param _collection The asset contract address, or address(0) for a NATIVE-asset offer.
     * @param _tokenId The token id as bytes32 (ERC721/ERC1155 ids are `bytes32(uint256(id))`);
     *        bytes32(0) for LSP7, ERC20, and NATIVE.
     * @param _standard The asset's standard.
     * @param _token The payment token, or address(0) for the native coin. Must differ from the
     *        asset; NATIVE-asset offers require a non-native payment token.
     * @param _isTokenLsp7 True if `_token` is an LSP7 Digital Asset instead of an ERC20.
     * @param _price The TOTAL payment for the full `_amount`, in wei (native) or the payment
     *        token's base units. Must be > 0.
     * @param _amount The asset quantity sought, in the asset's base units (1 for one-of-ones).
     * @param _expiresAt Unix timestamp after which the offer refuses fills. Must be in the
     *        future, at most MAX_OFFER_LIFETIME away.
     * @param _counterparty The only address allowed to fill, or address(0) for anyone.
     * @return offerId The id of the created offer.
     */
    function makeOffer(address _offerer, address _collection, bytes32 _tokenId, AssetStandard _standard, address _token, bool _isTokenLsp7, uint256 _price, uint256 _amount, uint256 _expiresAt, address _counterparty) external payable returns (uint256 offerId);

    /**
     * @notice Fills an offer: delivers `_quantity` of the asset to the offerer and receives
     *         `price * _quantity / amount` minus the platform fee, paid from escrow. Partial
     *         fills are allowed only for whole-unit assets; all-or-nothing offers must be filled
     *         with the exact remaining quantity.
     * @dev The seller must have granted this contract transfer rights beforehand:
     *      `approve`/`setApprovalForAll` (ERC721), `authorizeOperator` (LSP8/LSP7),
     *      `setApprovalForAll` (ERC1155), or `approve` (ERC20). Whitelisted ERC677 assets can
     *      skip the approval and fill in one transaction via transferAndCall instead. For a
     *      NATIVE-asset offer there is nothing to approve: msg.value IS the delivery and must
     *      exactly equal `_quantity`; every other standard requires msg.value = 0. The asset
     *      moves seller → offerer directly (ERC721 via transferFrom, not safeTransferFrom, so
     *      smart-wallet offerers without onERC721Received — e.g. Universal Profiles — can still
     *      receive); escrow is released only after delivery succeeds.
     * @param _seller The primary wallet delivering the asset (or address(0) if caller is
     *        primary). Must not be the offerer; must match the offer's counterparty when set.
     * @param _offerId The id of the offer to fill.
     * @param _quantity The asset quantity to deliver, in the asset's base units.
     */
    function acceptOffer(address _seller, uint256 _offerId, uint256 _quantity) external payable;

    /**
     * @notice Cancels an active offer and refunds its remaining escrow to the offerer. This is
     *         also the reclaim path for expired offers.
     * @dev Deliberately callable while the contract is paused: pause halts offer creation and
     *      fills, but an exit from escrow must never be blockable.
     */
    function cancelOffer(uint256 _offerId) external;

    /**
     * @notice ERC677 receiver hook — funds a new offer or fills an existing one in a single
     *         transaction, with no prior approve.
     * @dev Called by the token itself during `transferAndCall`, after the tokens have already
     *      been moved to this contract. Only whitelisted tokens are accepted (`erc677Tokens`):
     *      the callback carries no other proof that a real transfer preceded it. Reverting
     *      anywhere below unwinds that transfer — ERC677 requires this callback to succeed — so
     *      a rejected offer or fill can never strand funds. No burner-session resolution
     *      applies: the tokens must come from whoever actually holds them, and the token
     *      reports that holder as `_sender`.
     *
     *      `_data` = abi.encode(uint8 action, bytes params):
     *      - action ERC677_ACTION_MAKE: params = abi.encode(address collection, bytes32 tokenId,
     *        uint8 standard, uint256 amount, uint256 expiresAt, address counterparty). The
     *        transferred `_amount` becomes the offer's escrowed `price`; the calling token is
     *        the payment token.
     *      - action ERC677_ACTION_FILL: params = abi.encode(uint256 offerId). The calling token
     *        must be the offer's ERC20 asset, and `_amount` must equal the offer's remaining
     *        quantity exactly (ERC20 offers fill all-or-nothing). The tokens are forwarded to
     *        the offerer and the escrow paid out to `_sender`.
     * @param _sender The address that called transferAndCall — the offerer or the seller.
     * @param _amount The quantity of tokens already moved to this contract.
     * @param _data The action payload described above.
     * @return Always true; ERC677 tokens require a truthy return for the transfer to stand.
     */
    function onTokenTransfer(address _sender, uint256 _amount, bytes calldata _data) external returns (bool);

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Returns an offer by id (status None when the id does not exist).
     */
    function getOffer(uint256 _offerId) external view returns (Offer memory);

    /**
     * @notice Returns the payment still escrowed for an offer — `price * remaining / amount` —
     *         or 0 for any offer that is not Active.
     */
    function escrowOf(uint256 _offerId) external view returns (uint256);

    /**
     * @notice Returns whether `_seller` could fill `_quantity` of this offer right now: Active,
     *         unexpired, quantity available under the fill mode, counterparty allows it, and the
     *         seller's holdings and the transfer rights granted to this contract back it.
     *         Clients should gate their fill UI on this rather than on status alone.
     */
    function isFillable(uint256 _offerId, address _seller, uint256 _quantity) external view returns (bool);

    // --- ADMIN CONFIGURATION ---

    function pause() external;
    function unpause() external;
    function setTrustedForwarder(address _forwarder, bool _trusted) external;
    function setOfferFeeBps(uint256 _offerFeeBps) external;
    /// @notice Enables or disables an ERC677 token for one-transaction funding and filling.
    function setErc677Token(address _token, bool _enabled) external;
    /// @notice Withdraws the accrued fees for one payment token (address(0) = native). Live
    ///         offer escrow is out of reach by construction.
    function withdrawFees(address _token, address _receiver, bool _isLsp7) external;
}
