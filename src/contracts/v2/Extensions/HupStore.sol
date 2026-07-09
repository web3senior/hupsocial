// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IHupStore.sol";
import "./ILSP7Minimal.sol";

/**
 * @title Hup Store
 * @author Hup Labs
 * @notice Extension contract enabling users to list and sell items on Hup.
 * @dev Uses IHupStore for shared events, errors, structs, and view structs. Integrates with
 *      Hup Core via IHup. Supports rotatable ERC2771 trusted forwarders for meta-transactions,
 *      AccessControl for admin permissions, Pausable for emergency controls, and ReentrancyGuard for
 *      protected purchase distribution. Resolves burner session keys to primary wallets.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🛍️
 */
contract HupStore is IHupStore, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_BUY_FEE_BPS = 5_000;
    uint256 public constant ABSOLUTE_MAX_METADATA_BYTES = 2_048;
    uint256 public constant MAX_BUYERS_BATCH_READ_COUNT = 50;

    /// @notice The Hup Core contract instance
    IHup public immutable hupContract;

    /// @notice Maps Hup postId to its corresponding store listing
    mapping(uint256 => Listing) public listings;

    /// @notice Maps Hup postId to buyer to quantity purchased
    mapping(uint256 => mapping(address => uint256)) public amountPurchased;

    /// @notice Maps Hup postId to payment token to cumulative gross revenue (pre-fee) earned in
    ///         that token. Tracked per-token instead of one flat sum so revenue stays correct even
    ///         if a seller changes a listing's payment token after some sales already happened.
    mapping(uint256 => mapping(address => uint256)) public revenueByToken;

    /// @notice Maps Hup postId to buyer to payment token to quantity purchased in that token.
    ///         Lets a buyer's total (amountPurchased) be broken out by exactly which token(s) they
    ///         paid with, correct even across multiple payment-token switches on a listing.
    mapping(uint256 => mapping(address => mapping(address => uint256))) public buyerAmountByToken;

    mapping(address => bool) public trustedForwarders;

    /// @notice Flat fee (in wei) charged to list an item for sale
    uint256 public listingFee = 0;

    /// @notice Percentage fee charged on each purchase, in basis points (100 = 1%)
    uint256 public buyFeeBps = 0;

    /// @notice The maximum allowed byte length for a listing's metadata field
    uint256 public maxMetadataBytes = 256;

    /// @notice Append-only list of unique buyer addresses per postId, for paginated on-chain reads
    mapping(uint256 => address[]) internal _buyersOf;

    /// @dev Tracks whether an address has already been recorded in _buyersOf for a given postId
    mapping(uint256 => mapping(address => bool)) internal _hasBoughtBefore;

    /// @notice Append-only list of distinct payment tokens ever used by a listing. Bounded by how
    ///         many times a seller changes a listing's payment token (not by buyer/purchase count),
    ///         so it's read in full with no pagination needed.
    mapping(uint256 => address[]) internal _tokensOf;

    /// @dev Tracks whether a token has already been recorded in _tokensOf for a given postId
    mapping(uint256 => mapping(address => bool)) internal _hasUsedToken;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the store contract.
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

    function listItem(
        address _owner,
        uint256 _postId,
        uint256 _price,
        uint256 _quantity,
        address _paymentToken,
        bool _isLsp7,
        string calldata _metadata
    ) external payable whenNotPaused {
        if (_price == 0) revert InvalidPrice();
        if (_quantity == 0) revert InvalidQuantity();
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }

        address seller = _resolveActor(_owner);

        if (listingFee > 0 && msg.value != listingFee) revert InsufficientFee();

        // Query the core Hup contract to verify post status and ownership
        IHup.ContentView memory content = hupContract.getContent(_postId, address(0));

        if (content.isDeleted) revert ContentDeleted();
        if (content.creator != seller) revert NotCreator();

        listings[_postId] = Listing({
            price: _price,
            quantity: _quantity,
            isActive: true,
            seller: seller,
            metadata: _metadata,
            paymentToken: _paymentToken,
            isLsp7: _paymentToken != address(0) && _isLsp7,
            totalSold: 0
        });

        emit ItemListed(_postId, seller, _price, _quantity, _paymentToken, _paymentToken != address(0) && _isLsp7, _metadata);
    }

    function updateListing(
        address _owner,
        uint256 _postId,
        uint256 _price,
        uint256 _quantity,
        bool _isActive,
        address _paymentToken,
        bool _isLsp7,
        string calldata _metadata
    ) external whenNotPaused {
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }

        address seller = _resolveActor(_owner);
        Listing storage listing = listings[_postId];
        if (listing.seller != seller) revert NotSeller();
        if (_price == 0) revert InvalidPrice();

        bool isLsp7 = _paymentToken != address(0) && _isLsp7;

        listing.price = _price;
        listing.quantity = _quantity;
        listing.isActive = _isActive;
        listing.paymentToken = _paymentToken;
        listing.isLsp7 = isLsp7;
        listing.metadata = _metadata;

        emit ItemUpdated(_postId, _price, _quantity, _isActive, _paymentToken, isLsp7, _metadata);
    }

    function cancelListing(address _owner, uint256 _postId) external whenNotPaused {
        address seller = _resolveActor(_owner);
        Listing storage listing = listings[_postId];
        if (listing.seller != seller) revert NotSeller();

        listing.isActive = false;

        emit ItemUpdated(_postId, listing.price, listing.quantity, false, listing.paymentToken, listing.isLsp7, listing.metadata);
    }

    function buyItem(
        address _buyer,
        uint256 _postId,
        uint256 _quantityBought,
        bytes calldata _memo
    ) external payable whenNotPaused nonReentrant {
        if (_quantityBought == 0) revert InvalidQuantity();
        if (_memo.length > maxMetadataBytes) revert MetadataTooLarge(_memo.length, maxMetadataBytes);

        address buyer = _resolveActor(_buyer);

        Listing storage listing = listings[_postId];
        if (!listing.isActive) revert ListingNotActive();
        if (listing.quantity < _quantityBought) revert OutOfStock();

        uint256 requiredPayment = listing.price * _quantityBought;
        address paymentToken = listing.paymentToken;

        if (paymentToken == address(0)) {
            if (msg.value != requiredPayment) revert InsufficientPayment(msg.value, requiredPayment);
        } else {
            if (msg.value != 0) revert UnexpectedNativePayment();
        }

        // Deduct quantity
        listing.quantity -= _quantityBought;

        // Record purchase
        amountPurchased[_postId][buyer] += _quantityBought;
        listing.totalSold += _quantityBought;
        revenueByToken[_postId][paymentToken] += requiredPayment;
        buyerAmountByToken[_postId][buyer][paymentToken] += _quantityBought;
        _recordBuyer(_postId, buyer);
        _recordToken(_postId, paymentToken);

        // If out of stock, automatically set listing to inactive
        if (listing.quantity == 0) {
            listing.isActive = false;
        }

        // Split payment: platform fee stays in the contract, remainder goes to the seller
        uint256 feeAmount = (requiredPayment * buyFeeBps) / FEE_DENOMINATOR;
        uint256 sellerAmount = requiredPayment - feeAmount;

        if (paymentToken == address(0)) {
            (bool success, ) = listing.seller.call{value: sellerAmount}("");
            if (!success) revert TransferFailed();
        } else if (listing.isLsp7) {
            // LSP7 (LUKSO): buyer must have called authorizeOperator(store, total) beforehand
            ILSP7Minimal token = ILSP7Minimal(paymentToken);
            token.transfer(buyer, address(this), requiredPayment, true, "");
            token.transfer(address(this), listing.seller, sellerAmount, true, "");
        } else {
            IERC20 token = IERC20(paymentToken);
            token.safeTransferFrom(buyer, address(this), requiredPayment);
            token.safeTransfer(listing.seller, sellerAmount);
        }

        emit ItemBought(_postId, buyer, listing.seller, listing.price, _quantityBought, _memo);
    }

    /**
     * @notice Records a purchase settled outside this contract (e.g. an x402 USDC payment).
     * @dev Callable only by OPERATOR_ROLE. Moves no funds — the operator verifies settlement offchain.
     */
    function grantPurchase(uint256 _postId, address _buyer, uint256 _quantity, bytes calldata _memo) external whenNotPaused {
        if (!hasRole(OPERATOR_ROLE, msg.sender)) revert Unauthorized();
        if (_buyer == address(0)) revert InvalidAddress();
        if (_quantity == 0) revert InvalidQuantity();
        if (_memo.length > maxMetadataBytes) revert MetadataTooLarge(_memo.length, maxMetadataBytes);

        Listing storage listing = listings[_postId];
        if (!listing.isActive) revert ListingNotActive();
        if (listing.quantity < _quantity) revert OutOfStock();

        listing.quantity -= _quantity;
        amountPurchased[_postId][_buyer] += _quantity;
        listing.totalSold += _quantity;
        revenueByToken[_postId][listing.paymentToken] += listing.price * _quantity;
        buyerAmountByToken[_postId][_buyer][listing.paymentToken] += _quantity;
        _recordBuyer(_postId, _buyer);
        _recordToken(_postId, listing.paymentToken);

        if (listing.quantity == 0) {
            listing.isActive = false;
        }

        emit ItemBought(_postId, _buyer, listing.seller, listing.price, _quantity, _memo);
        emit PurchaseGranted(_postId, _buyer, msg.sender, _quantity);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getListing(uint256 _postId) external view returns (Listing memory) {
        return listings[_postId];
    }

    function getBuyerCount(uint256 _postId) external view returns (uint256) {
        return _buyersOf[_postId].length;
    }

    function getBuyers(
        uint256 _postId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory buyers, uint256[] memory amounts, uint256 total) {
        address[] storage all = _buyersOf[_postId];
        total = all.length;

        if (_offset >= total) {
            return (new address[](0), new uint256[](0), total);
        }

        uint256 limit = (_limit == 0 || _limit > MAX_BUYERS_BATCH_READ_COUNT) ? MAX_BUYERS_BATCH_READ_COUNT : _limit;
        uint256 end = _offset + limit;
        if (end > total) end = total;

        uint256 resultLength = end - _offset;
        buyers = new address[](resultLength);
        amounts = new uint256[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            address buyer = all[_offset + i];
            buyers[i] = buyer;
            amounts[i] = amountPurchased[_postId][buyer];
        }
    }

    /**
     * @notice Returns every distinct payment token a listing has ever been purchased under.
     * @dev Unpaginated — bounded by how many times a seller has changed a listing's payment
     *      token, not by buyer or purchase count, so it can't grow unbounded like buyers can.
     */
    function getTokensUsed(uint256 _postId) external view returns (address[] memory) {
        return _tokensOf[_postId];
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
        uint256 oldValue = listingFee;
        listingFee = _listingFee;

        emit ListingFeeUpdated(oldValue, _listingFee);
    }

    function setBuyFeeBps(uint256 _buyFeeBps) external onlyDirectAdmin {
        if (_buyFeeBps > ABSOLUTE_MAX_BUY_FEE_BPS) revert InvalidFeeBps();

        uint256 oldValue = buyFeeBps;
        buyFeeBps = _buyFeeBps;

        emit BuyFeeUpdated(oldValue, _buyFeeBps);
    }

    function setMaxMetadataBytes(uint256 _maxMetadataBytes) external onlyDirectAdmin {
        if (_maxMetadataBytes == 0 || _maxMetadataBytes > ABSOLUTE_MAX_METADATA_BYTES) {
            revert InvalidMetadataLimit();
        }

        uint256 oldValue = maxMetadataBytes;
        maxMetadataBytes = _maxMetadataBytes;

        emit MaxMetadataBytesUpdated(oldValue, _maxMetadataBytes);
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
     * @dev Appends a buyer to a listing's buyer list the first time they purchase, so getBuyers
     *      can paginate over unique buyers without ever growing unbounded per address.
     */
    function _recordBuyer(uint256 _postId, address _buyer) internal {
        if (_hasBoughtBefore[_postId][_buyer]) return;

        _hasBoughtBefore[_postId][_buyer] = true;
        _buyersOf[_postId].push(_buyer);
    }

    /**
     * @dev Appends a payment token to a listing's used-tokens list the first time it's used, so
     *      getTokensUsed can return every distinct token a listing has ever been bought under.
     */
    function _recordToken(uint256 _postId, address _token) internal {
        if (_hasUsedToken[_postId][_token]) return;

        _hasUsedToken[_postId][_token] = true;
        _tokensOf[_postId].push(_token);
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
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupStore) returns (bool) {
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
