// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./IHupTrade.sol";
import "./ILSP7Minimal.sol";
import "./ILSP8Minimal.sol";

/**
 * @title Hup Trade
 * @author Hup Labs
 * @notice Extension contract enabling users to sell NFTs directly inside Hup posts. Listings are
 *         non-custodial — the token stays in the seller's wallet and this contract only holds
 *         transfer rights until the sale. Supports ERC721 and LSP8 collections, priced in native
 *         coins, ERC20, or LSP7 tokens, with an optional referral share for the account whose
 *         share of the post led to the sale.
 * @dev Uses IHupTrade for shared structs, events, errors, and view signatures. Integrates with
 *      Hup Core via IHup only to resolve burner session keys to primary wallets. Supports
 *      rotatable ERC2771 trusted forwarders for meta-transactions, AccessControl for admin
 *      permissions, Pausable for emergency controls, and ReentrancyGuard for protected
 *      settlement. Every state change emits an event; offchain indexers derive full listing and
 *      trade state from Listed / ListingUpdated / ListingCancelled / Sold alone.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🖼️
 */
contract HupTrade is IHupTrade, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_TRADE_FEE_BPS = 1_000;
    uint256 public constant MAX_REFERRAL_BPS = 5_000;

    /// @notice The Hup Core contract instance (burner session resolution only). Admin-rotatable
    ///         so a Hup Core redeploy doesn't strand active listings behind a stale session source.
    IHup public hupContract;

    /// @notice Total number of listings ever created; ids are 1..listingCount
    uint256 public listingCount;

    /// @notice Maps listingId to its listing
    mapping(uint256 => Listing) private _listings;

    /// @notice Maps collection to tokenId to the token's active listingId (0 when none). A token
    ///         can have at most one active listing at a time.
    mapping(address => mapping(bytes32 => uint256)) public activeListingOf;

    mapping(address => bool) public trustedForwarders;

    /// @notice Percentage fee charged on each sale, in basis points (100 = 1%)
    uint256 public tradeFeeBps = 0;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the trade contract.
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

    function list(
        address _seller,
        address _collection,
        bytes32 _tokenId,
        bool _isLsp8,
        address _token,
        bool _isTokenLsp7,
        uint256 _price,
        uint256 _referralBps
    ) external whenNotPaused returns (uint256 listingId) {
        if (_collection == address(0)) revert InvalidAddress();
        if (_price == 0) revert InvalidAmount();
        if (_referralBps > MAX_REFERRAL_BPS) revert InvalidReferralBps();

        address seller = _resolveActor(_seller);

        if (_currentOwner(_collection, _tokenId, _isLsp8) != seller) revert NotTokenOwner();
        if (!_hasTransferRights(_collection, _tokenId, _isLsp8, seller)) revert NotOperator();

        // A token holds one active listing at a time. A leftover Active listing whose seller no
        // longer owns the token (it moved outside a sale) is auto-cancelled and replaced.
        uint256 existingId = activeListingOf[_collection][_tokenId];
        if (existingId != 0) {
            Listing storage existing = _listings[existingId];
            if (existing.seller == seller) revert DuplicateListing(existingId);

            existing.status = ListingStatus.Cancelled;
            emit ListingCancelled(existingId, true);
        }

        listingId = ++listingCount;

        _listings[listingId] = Listing({
            seller: seller,
            collection: _collection,
            tokenId: _tokenId,
            isLsp8: _isLsp8,
            token: _token,
            isTokenLsp7: _token != address(0) && _isTokenLsp7,
            price: _price,
            referralBps: _referralBps,
            listedAt: block.timestamp,
            status: ListingStatus.Active
        });
        activeListingOf[_collection][_tokenId] = listingId;

        emit Listed(listingId, seller, _collection, _tokenId, _isLsp8, _token, _token != address(0) && _isTokenLsp7, _price, _referralBps);
    }

    function updateListing(
        uint256 _listingId,
        address _token,
        bool _isTokenLsp7,
        uint256 _price,
        uint256 _referralBps
    ) external whenNotPaused {
        if (_price == 0) revert InvalidAmount();
        if (_referralBps > MAX_REFERRAL_BPS) revert InvalidReferralBps();

        Listing storage listing = _listings[_listingId];
        if (listing.status != ListingStatus.Active) revert ListingNotActive();
        // Resolving against the stored seller accepts both the seller and their active burner key
        if (listing.seller != _resolveActor(listing.seller)) revert NotTokenOwner();

        listing.token = _token;
        listing.isTokenLsp7 = _token != address(0) && _isTokenLsp7;
        listing.price = _price;
        listing.referralBps = _referralBps;

        emit ListingUpdated(_listingId, _token, listing.isTokenLsp7, _price, _referralBps);
    }

    function cancelListing(uint256 _listingId) external whenNotPaused {
        Listing storage listing = _listings[_listingId];
        if (listing.status != ListingStatus.Active) revert ListingNotActive();
        if (listing.seller != _resolveActor(listing.seller)) revert NotTokenOwner();

        listing.status = ListingStatus.Cancelled;
        delete activeListingOf[listing.collection][listing.tokenId];

        emit ListingCancelled(_listingId, false);
    }

    function buy(address _buyer, uint256 _listingId, address _referral) external payable whenNotPaused nonReentrant {
        Listing storage listing = _listings[_listingId];
        if (listing.status != ListingStatus.Active) revert ListingNotActive();

        address buyer = _resolveActor(_buyer);
        address seller = listing.seller;

        if (buyer == seller) revert SelfPurchase();
        if (_referral == buyer || _referral == seller) revert InvalidReferral();

        // The listing is only as live as the seller's ownership and this contract's transfer
        // rights — both are revocable outside our control, so re-verify at settlement time.
        if (_currentOwner(listing.collection, listing.tokenId, listing.isLsp8) != seller) revert StaleListing();
        if (!_hasTransferRights(listing.collection, listing.tokenId, listing.isLsp8, seller)) revert StaleListing();

        uint256 price = listing.price;
        address token = listing.token;
        bool isTokenLsp7 = listing.isTokenLsp7;

        if (token == address(0)) {
            if (msg.value != price) revert InsufficientPayment(msg.value, price);
        } else {
            if (msg.value != 0) revert UnexpectedNativePayment();
        }

        // Effects before interactions: the listing is settled before any external call.
        listing.status = ListingStatus.Sold;
        delete activeListingOf[listing.collection][listing.tokenId];

        // Split payment: platform fee stays in the contract, the referral share goes to the
        // referrer (or back to the seller when none was supplied), the remainder goes straight
        // to the seller's wallet. Fee-on-transfer/deflationary tokens are unsupported: the
        // contract pulls the gross amount and pushes the shares, so a transfer tax would eat
        // into accumulated fees.
        uint256 feeAmount = (price * tradeFeeBps) / FEE_DENOMINATOR;
        uint256 referralAmount = _referral == address(0) ? 0 : (price * listing.referralBps) / FEE_DENOMINATOR;
        uint256 sellerAmount = price - feeAmount - referralAmount;

        if (token == address(0)) {
            _sendNative(seller, sellerAmount);
            if (referralAmount > 0) _sendNative(_referral, referralAmount);
        } else if (isTokenLsp7) {
            // LSP7 (LUKSO): buyer must have called authorizeOperator(trade contract, price) beforehand
            ILSP7Minimal paymentToken = ILSP7Minimal(token);
            paymentToken.transfer(buyer, address(this), price, true, "");
            paymentToken.transfer(address(this), seller, sellerAmount, true, "");
            if (referralAmount > 0) paymentToken.transfer(address(this), _referral, referralAmount, true, "");
        } else {
            IERC20 paymentToken = IERC20(token);
            paymentToken.safeTransferFrom(buyer, address(this), price);
            paymentToken.safeTransfer(seller, sellerAmount);
            if (referralAmount > 0) paymentToken.safeTransfer(_referral, referralAmount);
        }

        // Move the NFT last. ERC721 uses transferFrom (not safeTransferFrom) so smart-wallet
        // buyers without onERC721Received — e.g. Universal Profiles — can still receive.
        if (listing.isLsp8) {
            ILSP8Minimal(listing.collection).transfer(seller, buyer, listing.tokenId, true, "");
        } else {
            IERC721(listing.collection).transferFrom(seller, buyer, uint256(listing.tokenId));
        }

        emit Sold(_listingId, buyer, _referral, seller, listing.collection, listing.tokenId, token, isTokenLsp7, price, feeAmount, referralAmount);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getListing(uint256 _listingId) external view returns (Listing memory) {
        return _listings[_listingId];
    }

    function isPurchasable(uint256 _listingId) external view returns (bool) {
        Listing storage listing = _listings[_listingId];
        if (listing.status != ListingStatus.Active) return false;
        if (_currentOwner(listing.collection, listing.tokenId, listing.isLsp8) != listing.seller) return false;
        return _hasTransferRights(listing.collection, listing.tokenId, listing.isLsp8, listing.seller);
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

    function setTradeFeeBps(uint256 _tradeFeeBps) external onlyDirectAdmin {
        if (_tradeFeeBps > ABSOLUTE_MAX_TRADE_FEE_BPS) revert InvalidFeeBps();

        uint256 oldValue = tradeFeeBps;
        tradeFeeBps = _tradeFeeBps;

        emit TradeFeeUpdated(oldValue, _tradeFeeBps);
    }

    function setHupContract(address _hupAddress) external onlyDirectAdmin {
        if (_hupAddress == address(0)) revert InvalidAddress();

        address oldValue = address(hupContract);
        hupContract = IHup(_hupAddress);

        emit HupContractUpdated(oldValue, _hupAddress);
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
     * @dev Returns the token's current owner in either standard.
     */
    function _currentOwner(address _collection, bytes32 _tokenId, bool _isLsp8) internal view returns (address) {
        if (_isLsp8) {
            return ILSP8Minimal(_collection).tokenOwnerOf(_tokenId);
        }
        return IERC721(_collection).ownerOf(uint256(_tokenId));
    }

    /**
     * @dev Returns whether this contract can transfer the token on the owner's behalf.
     */
    function _hasTransferRights(address _collection, bytes32 _tokenId, bool _isLsp8, address _owner) internal view returns (bool) {
        if (_isLsp8) {
            return ILSP8Minimal(_collection).isOperatorFor(address(this), _tokenId);
        }
        IERC721 collection = IERC721(_collection);
        return collection.getApproved(uint256(_tokenId)) == address(this) || collection.isApprovedForAll(_owner, address(this));
    }

    /**
     * @dev Sends native value, reverting on failure.
     */
    function _sendNative(address _to, uint256 _amount) internal {
        if (_amount == 0) return;

        (bool success, ) = _to.call{value: _amount}("");
        if (!success) revert TransferFailed();
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
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupTrade) returns (bool) {
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
