// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./IHupBazaar.sol";
import "./ILSP7Minimal.sol";

/**
 * @title Hup Bazaar
 * @author Hup Labs
 * @notice Extension contract enabling users to list and sell items on Hup.
 * @dev Uses IHupBazaar for shared events, errors, structs, and view structs. Integrates with
 *      Hup Core via IHup. Supports rotatable ERC2771 trusted forwarders for meta-transactions,
 *      AccessControl for admin permissions, Pausable for emergency controls, and ReentrancyGuard for
 *      protected purchase distribution. Resolves burner session keys to primary wallets.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🛍️
 */
contract HupBazaar is IHupBazaar, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_BUY_FEE_BPS = 5_000;
    // Referral cap + fee cap sum to exactly FEE_DENOMINATOR, so the seller's share can never underflow
    uint256 public constant MAX_REFERRAL_BPS = 5_000;
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

    /// @notice Unique buyer addresses per postId, insertion-ordered (never removed from), for
    ///         paginated onchain reads via getBuyers
    mapping(uint256 => EnumerableSet.AddressSet) private _buyersOf;

    /// @notice Distinct payment tokens ever used by a listing. Bounded by how many times a seller
    ///         changes a listing's payment token (not by buyer/purchase count), so it's read in
    ///         full with no pagination needed.
    mapping(uint256 => EnumerableSet.AddressSet) private _tokensOf;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the bazaar contract.
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
        address _vault,
        uint256 _referralBps,
        string calldata _metadata
    ) external payable whenNotPaused {
        if (_price == 0) revert InvalidPrice();
        if (_quantity == 0) revert InvalidQuantity();
        if (_referralBps > MAX_REFERRAL_BPS) revert InvalidFeeBps();
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }

        address seller = _resolveActor(_owner);

        if (msg.value != listingFee) revert InsufficientFee();

        // A postId can only be listed once — edits (including reactivation) must go through
        // updateListing so purchase history (totalSold, buyers, revenue) is never silently reset
        if (listings[_postId].seller != address(0)) revert AlreadyListed();

        // Query the core Hup contract to verify post status and ownership
        IHup.ContentView memory content = hupContract.getContent(_postId, address(0));

        if (content.isDeleted) revert ContentDeleted();
        if (content.creator != seller) revert NotCreator();

        listings[_postId] = Listing({
            price: _price,
            quantity: _quantity,
            isActive: true,
            seller: seller,
            vault: _vault,
            metadata: _metadata,
            paymentToken: _paymentToken,
            isLsp7: _paymentToken != address(0) && _isLsp7,
            totalSold: 0,
            referralBps: _referralBps
        });

        emit ItemListed(_postId, seller, _price, _quantity, _paymentToken, _paymentToken != address(0) && _isLsp7, _vault, _referralBps, _metadata);
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
        uint256 _referralBps,
        string calldata _metadata
    ) external whenNotPaused {
        if (bytes(_metadata).length > maxMetadataBytes) {
            revert MetadataTooLarge(bytes(_metadata).length, maxMetadataBytes);
        }
        if (_referralBps > MAX_REFERRAL_BPS) revert InvalidFeeBps();

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
        listing.vault = _vault;
        listing.metadata = _metadata;
        listing.referralBps = _referralBps;

        emit ItemUpdated(_postId, _price, _quantity, _isActive, _paymentToken, isLsp7, _vault, _referralBps, _metadata);
    }

    function cancelListing(address _owner, uint256 _postId) external whenNotPaused {
        address seller = _resolveActor(_owner);
        Listing storage listing = listings[_postId];
        if (listing.seller != seller) revert NotSeller();

        listing.isActive = false;

        emit ItemUpdated(_postId, listing.price, listing.quantity, false, listing.paymentToken, listing.isLsp7, listing.vault, listing.referralBps, listing.metadata);
    }

    function buyItem(
        address _buyer,
        uint256 _postId,
        uint256 _quantityBought,
        uint256 _expectedPrice,
        address _expectedToken,
        bool _expectedIsLsp7,
        address _referral,
        bytes calldata _memo
    ) external payable whenNotPaused nonReentrant {
        if (_quantityBought == 0) revert InvalidQuantity();
        if (_memo.length > maxMetadataBytes) revert MetadataTooLarge(_memo.length, maxMetadataBytes);

        address buyer = _resolveActor(_buyer);

        Listing storage listing = listings[_postId];
        if (!listing.isActive) revert ListingNotActive();
        if (listing.quantity < _quantityBought) revert OutOfStock();

        // Referral self-dealing guard: buyers can't discount their own purchase and sellers
        // can't collect their own referral share
        if (_referral != address(0) && (_referral == buyer || _referral == listing.seller)) revert InvalidReferral();

        // Front-run guard: the buyer commits to the price/token/standard they saw at signing
        // time, so a seller can't slip in an updateListing that drains a standing token
        // allowance or re-routes the transfer through mismatched LSP7/ERC20 call semantics
        if (listing.price != _expectedPrice || listing.paymentToken != _expectedToken || listing.isLsp7 != _expectedIsLsp7) {
            revert ListingChanged(listing.price, listing.paymentToken, listing.isLsp7);
        }

        // From here on _expectedPrice/_expectedToken/_expectedIsLsp7 ARE the listing's terms —
        // the guard pinned them, and as calldata they can't be moved by reentrancy. That matters
        // because the transfers below hand control to the payout recipient (native call / LSP7
        // hooks), who could reenter updateListing. The payout target is snapshotted now for the
        // same reason (the vault is seller-editable); listing.seller is written once in listItem
        // and never again, so reading it from storage stays safe even after the external calls.
        // Keeping the pinned terms out of new locals also keeps buyItem inside the legacy
        // codegen's stack limit (this compiles without viaIR).
        address payoutRecipient = listing.vault == address(0) ? listing.seller : listing.vault;

        uint256 requiredPayment = _expectedPrice * _quantityBought;

        if (_expectedToken == address(0)) {
            if (msg.value != requiredPayment) revert InsufficientPayment(msg.value, requiredPayment);
        } else {
            if (msg.value != 0) revert UnexpectedNativePayment();
        }

        // Deduct quantity
        listing.quantity -= _quantityBought;

        // Record purchase
        amountPurchased[_postId][buyer] += _quantityBought;
        listing.totalSold += _quantityBought;
        revenueByToken[_postId][_expectedToken] += requiredPayment;
        buyerAmountByToken[_postId][buyer][_expectedToken] += _quantityBought;
        _buyersOf[_postId].add(buyer);
        _tokensOf[_postId].add(_expectedToken);

        // If out of stock, automatically set listing to inactive
        if (listing.quantity == 0) {
            listing.isActive = false;
        }

        // Split payment: platform fee stays in the contract, the referral share (a slice of
        // the seller's proceeds, like HupTrade) goes to whoever's repost/quote drove the sale,
        // and the remainder goes to the payout recipient (the listing's vault when set,
        // otherwise the seller). Settlement lives in _settle so the referral locals get their
        // own frame and buyItem stays inside the legacy codegen's stack limit.
        // Fee-on-transfer/deflationary ERC20s are unsupported: the contract pulls the gross
        // amount and pushes the seller's share, so a transfer tax would eat into accumulated fees.
        uint256 feeAmount = (requiredPayment * buyFeeBps) / FEE_DENOMINATOR;
        uint256 referralAmount = _referral == address(0) ? 0 : (requiredPayment * listing.referralBps) / FEE_DENOMINATOR;

        _settle(buyer, payoutRecipient, _referral, _expectedToken, _expectedIsLsp7, requiredPayment, feeAmount, referralAmount);

        emit ItemBought(_postId, buyer, listing.seller, _expectedPrice, _quantityBought, _expectedToken, feeAmount, _referral, referralAmount, _memo);
    }

    /**
     * @dev Executes a purchase's payment split: platform fee stays in the contract, the
     *      referral share goes to the referrer, and the remainder goes to the payout
     *      recipient. `_referralAmount` is nonzero only when `_referral` is set (buyItem
     *      computes it that way), so the referral transfer can key off the amount alone.
     */
    function _settle(
        address _buyerAddress,
        address _payoutRecipient,
        address _referral,
        address _token,
        bool _isLsp7,
        uint256 _grossAmount,
        uint256 _feeAmount,
        uint256 _referralAmount
    ) private {
        if (_token == address(0)) {
            (bool success, ) = _payoutRecipient.call{value: _grossAmount - _feeAmount - _referralAmount}("");
            if (!success) revert TransferFailed();

            if (_referralAmount > 0) {
                (bool referralSuccess, ) = _referral.call{value: _referralAmount}("");
                if (!referralSuccess) revert TransferFailed();
            }
        } else if (_isLsp7) {
            // LSP7 (LUKSO): buyer must have called authorizeOperator(bazaar, total) beforehand
            ILSP7Minimal token = ILSP7Minimal(_token);
            token.transfer(_buyerAddress, address(this), _grossAmount, true, "");
            token.transfer(address(this), _payoutRecipient, _grossAmount - _feeAmount - _referralAmount, true, "");

            if (_referralAmount > 0) {
                token.transfer(address(this), _referral, _referralAmount, true, "");
            }
        } else {
            IERC20 token = IERC20(_token);
            token.safeTransferFrom(_buyerAddress, address(this), _grossAmount);
            token.safeTransfer(_payoutRecipient, _grossAmount - _feeAmount - _referralAmount);

            if (_referralAmount > 0) {
                token.safeTransfer(_referral, _referralAmount);
            }
        }
    }

    /**
     * @notice Records a purchase settled outside this contract (e.g. an x402 USDC payment).
     * @dev Callable only by OPERATOR_ROLE. Moves no funds — the operator verifies settlement
     *      offchain. Credits revenueByToken/buyerAmountByToken in the listing's current payment
     *      token at the listing price, so the operator MUST only grant purchases that actually
     *      settled in that token at (or above) that price — otherwise revenue stats are inflated.
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
        _buyersOf[_postId].add(_buyer);
        _tokensOf[_postId].add(listing.paymentToken);

        if (listing.quantity == 0) {
            listing.isActive = false;
        }

        // feeAmount and referral are 0: settlement happened outside this contract — no
        // platform fee was taken and no referral share can be attributed
        emit ItemBought(_postId, _buyer, listing.seller, listing.price, _quantity, listing.paymentToken, 0, address(0), 0, _memo);
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
        return _buyersOf[_postId].length();
    }

    function getBuyers(
        uint256 _postId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory buyers, uint256[] memory amounts, uint256 total) {
        EnumerableSet.AddressSet storage all = _buyersOf[_postId];
        total = all.length();

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
            address buyer = all.at(_offset + i);
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
        return _tokensOf[_postId].values();
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
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupBazaar) returns (bool) {
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
