// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./IHupSell.sol";
import "./ILSP7Minimal.sol";

/**
 * @title Hup Sell
 * @author Hup Labs
 * @notice Extension contract for selling gated content on Hup, where the content key is delivered
 *         onchain by the seller and no server ever holds it.
 * @dev Uses IHupSell for shared events, errors and structs. Integrates with Hup Core via IHup.
 *      Supports rotatable ERC2771 trusted forwarders, AccessControl for admin permissions,
 *      Pausable for emergency controls, and ReentrancyGuard on every value-moving path. Resolves
 *      burner session keys to primary wallets.
 *
 *      The protocol is a two-step escrow, and the two steps are the point:
 *
 *        1. A buyer calls buy() with their own ECIES public key and the price is held HERE, not
 *           forwarded to the seller.
 *        2. The seller calls grantAccess() with the listing's content key encrypted to that public
 *           key. Publishing the key is what releases the escrow.
 *
 *      A seller who takes payment and withholds the key is therefore never paid, and the buyer
 *      pulls the escrow back after GRANT_WINDOW. That is the whole trust model: no operator role
 *      can decrypt, no admin can touch an escrow, and the contract itself never sees a plaintext
 *      or a content key — only ciphertext addressed to somebody else.
 *
 *      Every byte needed to reconstruct access lives in contract storage and event logs, so a lost
 *      database costs an index, never a key.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🔐
 */
contract HupSell is IHupSell, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_BUY_FEE_BPS = 5_000;

    /// @notice How long a seller has to publish a key before the buyer may pull their escrow back.
    /// @dev Deliberately a constant and not an admin setting. It is the buyer's only protection
    ///      against a seller who never grants, so it must not be movable by anyone — including us.
    uint256 public constant GRANT_WINDOW = 24 hours;

    /// @notice Byte ceiling for a buyer's ECIES public key (65 bytes uncompressed, with headroom).
    uint256 public constant MAX_PUBKEY_BYTES = 128;

    /// @notice Byte ceiling for a wrapped content key (ECIES over 32 bytes is ~113, with headroom).
    uint256 public constant MAX_WRAPPED_KEY_BYTES = 512;

    uint256 public constant MAX_BATCH_SIZE = 50;
    uint256 public constant MAX_BUYERS_BATCH_READ_COUNT = 50;
    uint256 public constant ABSOLUTE_MAX_CONTENT_URI_BYTES = 2_048;

    /// @notice The Hup Core contract instance
    IHup public immutable hupContract;

    /// @notice Maps Hup postId to its gated-content listing
    mapping(uint256 => Listing) public listings;

    /// @notice Maps Hup postId to buyer to their escrowed purchase
    mapping(uint256 => mapping(address => Purchase)) public purchases;

    /// @notice Maps Hup postId to buyer to the content key wrapped to that buyer's public key.
    ///         This mapping IS the access-control list — there is no other record of who can read.
    mapping(uint256 => mapping(address => bytes)) public wrappedKeys;

    /// @notice Maps Hup postId to buyer to the ECIES public key the seller must wrap for.
    mapping(uint256 => mapping(address => bytes)) public buyerPubKeys;

    mapping(address => bool) public trustedForwarders;

    /// @notice Native fees this contract has earned and may pay out. Escrowed buyer funds are
    ///         excluded by construction, which is what stops an admin withdrawal from ever
    ///         reaching money that belongs to a pending purchase.
    uint256 public collectedNative;

    /// @notice Per-token fees this contract has earned and may pay out. See collectedNative.
    mapping(address => uint256) public collectedToken;

    /// @notice Flat fee (in wei) charged to list gated content
    uint256 public listingFee = 0;

    /// @notice Percentage fee charged on each completed sale, in basis points (100 = 1%)
    uint256 public buyFeeBps = 0;

    /// @notice The maximum allowed byte length for a listing's content URI
    uint256 public maxContentURIBytes = 256;

    /// @notice Unique buyer addresses per postId, insertion-ordered, for paginated onchain reads
    mapping(uint256 => EnumerableSet.AddressSet) private _buyersOf;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the sell contract.
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

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // --- MUTATIVE LOGIC ---

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
    ) external payable whenNotPaused {
        if (_price == 0) revert InvalidPrice();
        if (_quantity == 0) revert InvalidQuantity();
        if (bytes(_contentURI).length > maxContentURIBytes) {
            revert ContentURITooLarge(bytes(_contentURI).length, maxContentURIBytes);
        }
        if (_sellerWrappedKey.length == 0) revert EmptyKey();
        if (_sellerWrappedKey.length > MAX_WRAPPED_KEY_BYTES) {
            revert WrappedKeyTooLarge(_sellerWrappedKey.length, MAX_WRAPPED_KEY_BYTES);
        }

        address seller = _resolveActor(_owner);

        if (msg.value != listingFee) revert InsufficientFee();
        collectedNative += msg.value;

        IHup.ContentView memory content = hupContract.getContent(_postId, address(0));
        if (content.isDeleted) revert ContentDeleted();
        if (content.creator != seller) revert NotCreator();

        // A postId can only be listed once — edits (including reactivation) must go through
        // updateListing so totalSold and the buyer roster are never silently reset.
        if (listings[_postId].seller != address(0)) revert AlreadyListed();

        listings[_postId] = Listing({
            price: _price,
            quantity: _quantity,
            isActive: true,
            seller: seller,
            vault: _vault,
            contentURI: _contentURI,
            paymentToken: _paymentToken,
            isLsp7: _paymentToken == address(0) ? false : _isLsp7,
            totalSold: 0
        });

        // The seller's own copy of the content key, wrapped to their own public key. Without it a
        // seller could never re-read or re-encrypt their own listing, because this design leaves
        // them no other copy — the server that used to hold one is gone. Set once and never
        // rotated: every buyer's envelope wraps THIS key, so replacing it would strand them all.
        // A seller editing the content decrypts with this key and re-encrypts under it.
        wrappedKeys[_postId][seller] = _sellerWrappedKey;

        emit ItemListed(_postId, seller, _price, _quantity, _paymentToken, _isLsp7, _vault, _contentURI);
    }

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
    ) external whenNotPaused {
        if (_price == 0) revert InvalidPrice();
        if (bytes(_contentURI).length > maxContentURIBytes) {
            revert ContentURITooLarge(bytes(_contentURI).length, maxContentURIBytes);
        }

        Listing storage listing = listings[_postId];
        if (listing.seller != _resolveActor(_owner)) revert NotSeller();

        listing.price = _price;
        listing.quantity = _quantity;
        listing.isActive = _isActive;
        listing.paymentToken = _paymentToken;
        listing.isLsp7 = _paymentToken == address(0) ? false : _isLsp7;
        listing.vault = _vault;
        listing.contentURI = _contentURI;

        emit ItemUpdated(_postId, _price, _quantity, _isActive, _paymentToken, _isLsp7, _vault, _contentURI);
    }

    function cancelListing(address _owner, uint256 _postId) external whenNotPaused {
        Listing storage listing = listings[_postId];
        if (listing.seller != _resolveActor(_owner)) revert NotSeller();
        if (!listing.isActive) revert ListingNotActive();

        listing.isActive = false;

        emit ItemUpdated(_postId, listing.price, listing.quantity, false, listing.paymentToken, listing.isLsp7, listing.vault, listing.contentURI);
    }

    function buy(
        address _owner,
        uint256 _postId,
        uint256 _expectedPrice,
        address _expectedToken,
        bool _expectedIsLsp7,
        bytes calldata _buyerPubKey
    ) external payable whenNotPaused nonReentrant {
        if (_buyerPubKey.length == 0) revert EmptyKey();
        if (_buyerPubKey.length > MAX_PUBKEY_BYTES) revert PubKeyTooLarge(_buyerPubKey.length, MAX_PUBKEY_BYTES);

        Listing storage listing = listings[_postId];
        if (!listing.isActive || listing.seller == address(0)) revert ListingNotActive();
        if (listing.quantity == 0) revert OutOfStock();

        // The buyer committed to a price, a token and a token standard. Re-checking all three
        // stops a seller-side updateListing from draining a standing allowance or re-routing the
        // transfer through mismatched LSP7/ERC20 call semantics between signing and mining.
        if (listing.price != _expectedPrice || listing.paymentToken != _expectedToken || listing.isLsp7 != _expectedIsLsp7) {
            revert ListingChanged(listing.price, listing.paymentToken, listing.isLsp7);
        }

        address buyer = _resolveActor(_owner);

        // One grant per buyer per listing: the key is wrapped to a person, not to a unit of stock,
        // so a second purchase would buy a buyer nothing they do not already hold.
        if (purchases[_postId][buyer].paidAt != 0) revert AlreadyPurchased();

        uint256 price = listing.price;
        address token = listing.paymentToken;
        bool isLsp7 = listing.isLsp7;

        listing.quantity -= 1;

        purchases[_postId][buyer] = Purchase({
            amount: price,
            paymentToken: token,
            paidAt: uint48(block.timestamp),
            // Safe: setBuyFeeBps rejects anything above ABSOLUTE_MAX_BUY_FEE_BPS (5_000)
            // forge-lint: disable-next-line(unsafe-typecast)
            feeBps: uint16(buyFeeBps),
            isLsp7: isLsp7,
            granted: false,
            refunded: false
        });

        buyerPubKeys[_postId][buyer] = _buyerPubKey;
        _buyersOf[_postId].add(buyer);

        _collect(token, isLsp7, buyer, price);

        emit ItemPurchased(_postId, buyer, listing.seller, price, token, _buyerPubKey);
    }

    function grantAccess(address _owner, uint256 _postId, address _buyer, bytes calldata _wrappedKey) external nonReentrant {
        Listing storage listing = listings[_postId];
        if (listing.seller != _resolveActor(_owner)) revert NotSeller();

        _grantOne(listing, _postId, _buyer, _wrappedKey, false);
    }

    function grantAccessBatch(
        address _owner,
        uint256 _postId,
        address[] calldata _buyers,
        bytes[] calldata _wrappedKeys
    ) external nonReentrant {
        if (_buyers.length != _wrappedKeys.length) revert ArrayLengthMismatch();
        if (_buyers.length > MAX_BATCH_SIZE) revert BatchTooLarge();

        Listing storage listing = listings[_postId];
        if (listing.seller != _resolveActor(_owner)) revert NotSeller();

        for (uint256 i = 0; i < _buyers.length; i++) {
            _grantOne(listing, _postId, _buyers[i], _wrappedKeys[i], true);
        }
    }

    function claimRefund(uint256 _postId) external nonReentrant {
        address buyer = _msgSender();
        Purchase storage purchase = purchases[_postId][buyer];

        if (purchase.paidAt == 0) revert NoPurchase();
        if (purchase.granted) revert AlreadyGranted();
        if (purchase.refunded) revert AlreadyRefunded();

        uint256 claimableAt = uint256(purchase.paidAt) + GRANT_WINDOW;
        if (block.timestamp < claimableAt) revert RefundWindowOpen(claimableAt);

        uint256 amount = purchase.amount;
        purchase.refunded = true;

        // The slot this purchase held goes back on sale. A refund means nothing was delivered,
        // so the listing should read as though the purchase never happened.
        listings[_postId].quantity += 1;

        _payout(purchase.paymentToken, purchase.isLsp7, buyer, amount);

        emit PurchaseRefunded(_postId, buyer, amount);
    }

    function requestRegrant(address _owner, uint256 _postId, bytes calldata _buyerPubKey) external {
        if (_buyerPubKey.length == 0) revert EmptyKey();
        if (_buyerPubKey.length > MAX_PUBKEY_BYTES) revert PubKeyTooLarge(_buyerPubKey.length, MAX_PUBKEY_BYTES);

        address buyer = _resolveActor(_owner);
        Purchase storage purchase = purchases[_postId][buyer];

        if (purchase.paidAt == 0) revert NoPurchase();
        if (purchase.refunded) revert AlreadyRefunded();

        // `granted` and `paidAt` are deliberately untouched. Clearing either would let a buyer who
        // already decrypted the content re-arm the refund window and end up holding both the
        // plaintext and their money back.
        buyerPubKeys[_postId][buyer] = _buyerPubKey;

        emit RegrantRequested(_postId, buyer, _buyerPubKey);
    }

    // --- VIEW FUNCTIONS ---

    function getListing(uint256 _postId) external view returns (Listing memory) {
        return listings[_postId];
    }

    function getPurchase(uint256 _postId, address _buyer) external view returns (Purchase memory) {
        return purchases[_postId][_buyer];
    }

    function isRefundable(uint256 _postId, address _buyer) external view returns (bool) {
        Purchase storage purchase = purchases[_postId][_buyer];
        if (purchase.paidAt == 0 || purchase.granted || purchase.refunded) return false;

        return block.timestamp >= uint256(purchase.paidAt) + GRANT_WINDOW;
    }

    function refundableAt(uint256 _postId, address _buyer) external view returns (uint256) {
        Purchase storage purchase = purchases[_postId][_buyer];
        if (purchase.paidAt == 0) return 0;

        return uint256(purchase.paidAt) + GRANT_WINDOW;
    }

    function getBuyerCount(uint256 _postId) external view returns (uint256) {
        return _buyersOf[_postId].length();
    }

    function getBuyers(
        uint256 _postId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory buyers, bool[] memory granted, bool[] memory refunded, uint256 total) {
        EnumerableSet.AddressSet storage set = _buyersOf[_postId];
        total = set.length();

        uint256 count = _pageSize(total, _offset, _limit);

        buyers = new address[](count);
        granted = new bool[](count);
        refunded = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            address buyer = set.at(_offset + i);
            Purchase storage purchase = purchases[_postId][buyer];

            buyers[i] = buyer;
            granted[i] = purchase.granted;
            refunded[i] = purchase.refunded;
        }
    }

    function getPendingGrants(
        uint256 _postId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory buyers, bytes[] memory pubKeys, uint256 scanned) {
        EnumerableSet.AddressSet storage set = _buyersOf[_postId];
        scanned = _pageSize(set.length(), _offset, _limit);

        uint256 pending = 0;
        for (uint256 i = 0; i < scanned; i++) {
            Purchase storage purchase = purchases[_postId][set.at(_offset + i)];
            if (purchase.paidAt != 0 && !purchase.granted && !purchase.refunded) pending++;
        }

        buyers = new address[](pending);
        pubKeys = new bytes[](pending);

        uint256 cursor = 0;
        for (uint256 i = 0; i < scanned; i++) {
            address buyer = set.at(_offset + i);
            Purchase storage purchase = purchases[_postId][buyer];
            if (purchase.paidAt == 0 || purchase.granted || purchase.refunded) continue;

            buyers[cursor] = buyer;
            pubKeys[cursor] = buyerPubKeys[_postId][buyer];
            cursor++;
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

    function setListingFee(uint256 _listingFee) external onlyDirectAdmin {
        emit ListingFeeUpdated(listingFee, _listingFee);
        listingFee = _listingFee;
    }

    function setBuyFeeBps(uint256 _buyFeeBps) external onlyDirectAdmin {
        if (_buyFeeBps > ABSOLUTE_MAX_BUY_FEE_BPS) revert InvalidFeeBps();

        emit BuyFeeUpdated(buyFeeBps, _buyFeeBps);
        buyFeeBps = _buyFeeBps;
    }

    function setMaxContentURIBytes(uint256 _maxContentURIBytes) external onlyDirectAdmin {
        if (_maxContentURIBytes == 0 || _maxContentURIBytes > ABSOLUTE_MAX_CONTENT_URI_BYTES) revert InvalidURILimit();

        emit MaxContentURIBytesUpdated(maxContentURIBytes, _maxContentURIBytes);
        maxContentURIBytes = _maxContentURIBytes;
    }

    function withdrawFees(address payable _receiver) external onlyDirectAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 amount = collectedNative;
        collectedNative = 0;

        (bool success, ) = _receiver.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit Withdrawal(_receiver, amount);
    }

    function withdrawTokenFees(address _token, address _receiver, bool _isLsp7) external onlyDirectAdmin nonReentrant {
        if (_token == address(0) || _receiver == address(0)) revert InvalidAddress();

        uint256 amount = collectedToken[_token];
        collectedToken[_token] = 0;

        _payout(_token, _isLsp7, _receiver, amount);

        emit TokenWithdrawal(_token, _receiver, amount);
    }

    // --- INTERNAL & OVERRIDE HELPERS ---

    /**
     * @dev Publishes one buyer's wrapped key and releases their escrow. `_skipInvalid` is how the
     *      batch path tolerates a stale snapshot: a buyer who refunded between the client reading
     *      the queue and the transaction mining is skipped, not a reason to reject the batch.
     */
    function _grantOne(Listing storage _listing, uint256 _postId, address _buyer, bytes calldata _wrappedKey, bool _skipInvalid) private {
        Purchase storage purchase = purchases[_postId][_buyer];

        if (purchase.paidAt == 0 || purchase.granted || purchase.refunded) {
            if (_skipInvalid) return;
            if (purchase.paidAt == 0) revert NoPurchase();
            if (purchase.granted) revert AlreadyGranted();
            revert AlreadyRefunded();
        }

        if (_wrappedKey.length == 0) {
            if (_skipInvalid) return;
            revert EmptyKey();
        }
        if (_wrappedKey.length > MAX_WRAPPED_KEY_BYTES) {
            if (_skipInvalid) return;
            revert WrappedKeyTooLarge(_wrappedKey.length, MAX_WRAPPED_KEY_BYTES);
        }

        purchase.granted = true;
        _listing.totalSold += 1;
        wrappedKeys[_postId][_buyer] = _wrappedKey;

        uint256 amount = purchase.amount;
        address token = purchase.paymentToken;
        // The fee snapshotted at purchase, not today's — the seller priced the sale under the fee
        // that was live when the buyer paid.
        uint256 feeAmount = (amount * purchase.feeBps) / FEE_DENOMINATOR;
        uint256 netAmount = amount - feeAmount;

        if (feeAmount > 0) {
            if (token == address(0)) {
                collectedNative += feeAmount;
            } else {
                collectedToken[token] += feeAmount;
            }
        }

        address payoutRecipient = _listing.vault == address(0) ? _listing.seller : _listing.vault;
        _payout(token, purchase.isLsp7, payoutRecipient, netAmount);

        emit AccessGranted(_postId, _buyer, netAmount, feeAmount);
    }

    /**
     * @dev Pulls `_amount` from the buyer into this contract's escrow.
     */
    function _collect(address _token, bool _isLsp7, address _buyer, uint256 _amount) private {
        if (_token == address(0)) {
            if (msg.value != _amount) revert InsufficientPayment(msg.value, _amount);
        } else {
            if (msg.value != 0) revert UnexpectedNativePayment();

            if (_isLsp7) {
                // LSP7 (LUKSO): buyer must have called authorizeOperator(hupSell, amount) first
                ILSP7Minimal(_token).transfer(_buyer, address(this), _amount, true, "");
            } else {
                IERC20(_token).safeTransferFrom(_buyer, address(this), _amount);
            }
        }
    }

    /**
     * @dev Sends `_amount` out of this contract. `.call` rather than `transfer` so a Universal
     *      Profile with LSP1 receive logic is not broken by the 2300 gas stipend.
     */
    function _payout(address _token, bool _isLsp7, address _receiver, uint256 _amount) private {
        if (_amount == 0) return;

        if (_token == address(0)) {
            (bool success, ) = _receiver.call{value: _amount}("");
            if (!success) revert TransferFailed();
        } else if (_isLsp7) {
            ILSP7Minimal(_token).transfer(address(this), _receiver, _amount, true, "");
        } else {
            IERC20(_token).safeTransfer(_receiver, _amount);
        }
    }

    /**
     * @dev Clamps a page request to what the set actually holds and to the read batch ceiling.
     */
    function _pageSize(uint256 _total, uint256 _offset, uint256 _limit) private pure returns (uint256) {
        if (_offset >= _total) return 0;

        uint256 limit = _limit == 0 || _limit > MAX_BUYERS_BATCH_READ_COUNT ? MAX_BUYERS_BATCH_READ_COUNT : _limit;
        uint256 remaining = _total - _offset;

        return remaining < limit ? remaining : limit;
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
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupSell) returns (bool) {
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
