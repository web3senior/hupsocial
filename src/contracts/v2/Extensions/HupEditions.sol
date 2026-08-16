// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "./IHupEditions.sol";
import "./ILSP7Minimal.sol";
import "./ILSP7Asset.sol";

/**
 * @title Hup Editions
 * @author Hup Labs
 * @notice Extension contract enabling users to sell balance-based art — LSP7 Digital Assets on
 *         LUKSO and ERC1155 semi-fungibles elsewhere — directly inside Hup posts. Listings are
 *         non-custodial: the editions stay in the seller's wallet and this contract only holds
 *         transfer rights until each sale. Priced per edition and fillable in parts, so one
 *         listing of ten editions serves ten buyers.
 * @dev The sibling of HupTrade, which handles one-of-one assets (ERC721, LSP8) and is deliberately
 *      left untouched: it is deployed and immutable on nine chains, and the two asset sets never
 *      overlap, so no listing is ambiguous between them. The settlement half is duplicated rather
 *      than factored into a shared base — extracting one would change HupTrade's compiled metadata
 *      hash, which Solidity appends to deployed bytecode, breaking byte-exact reverification of
 *      live code. Uses IHupEditions for shared structs, events, errors, and view signatures, and
 *      integrates with Hup Core via IHup only to resolve burner session keys to primary wallets.
 *      Supports rotatable ERC2771 trusted forwarders for meta-transactions, AccessControl for
 *      admin permissions, Pausable for emergency controls, and ReentrancyGuard for protected
 *      settlement. Every state change emits an event; offchain indexers derive full listing and
 *      trade state from Listed / ListingUpdated / ListingCancelled / Sold alone.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🎨
 */
contract HupEditions is IHupEditions, Pausable, ReentrancyGuard, AccessControl, ERC2771Context {
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

    /// @notice Maps collection to tokenId to seller to that seller's active listingId (0 when
    ///         none). Keyed by seller because editions are fungible: many holders can list the
    ///         same asset at once. Each holder still gets one active listing per asset.
    mapping(address => mapping(bytes32 => mapping(address => uint256))) public activeListingOf;

    mapping(address => bool) public trustedForwarders;

    /// @notice Percentage fee charged on each fill, in basis points (100 = 1%)
    uint256 public tradeFeeBps = 0;

    // --- MODIFIERS ---

    modifier onlyDirectAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the editions contract.
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
        AssetStandard _standard,
        address _token,
        bool _isTokenLsp7,
        uint256 _unitPrice,
        uint256 _amount,
        uint256 _referralBps
    ) external whenNotPaused returns (uint256 listingId) {
        if (_collection == address(0)) revert InvalidAddress();
        if (_unitPrice == 0 || _amount == 0) revert InvalidAmount();
        if (_referralBps > MAX_REFERRAL_BPS) revert InvalidReferralBps();

        if (_standard == AssetStandard.LSP7) {
            // LSP7 identifies an asset by contract alone, so its listings pin a canonical zero id
            // — otherwise one holding could be listed twice under two different keys.
            if (_tokenId != bytes32(0)) revert InvalidTokenId();
            // Quantities are whole editions. A divisible LSP7 would make "one edition" meaningless,
            // and edition-style assets are minted non-divisible anyway.
            if (ILSP7Asset(_collection).decimals() != 0) revert DivisibleAsset();
        }

        address seller = _resolveActor(_seller);

        // Scoped so the backing probe and the duplicate lookup are off the stack before the
        // listing is written, which keeps this nine-parameter function clear of stack limits.
        {
            uint256 available = _backing(_collection, _tokenId, _standard, seller);
            if (available < _amount) revert InsufficientBacking(_amount, available);

            uint256 existingId = activeListingOf[_collection][_tokenId][seller];
            if (existingId != 0) {
                Listing storage existing = _listings[existingId];

                if (existing.status == ListingStatus.Active) {
                    // Still deliverable in full, so this is a genuine duplicate. Otherwise the old
                    // listing can no longer be filled and would block the seller forever, so it is
                    // auto-cancelled and replaced.
                    if (available >= existing.remaining) revert DuplicateListing(existingId);

                    existing.status = ListingStatus.Cancelled;
                    emit ListingCancelled(existingId, existing.remaining, true);
                }
            }
        }

        listingId = ++listingCount;

        _listings[listingId] = Listing({
            seller: seller,
            collection: _collection,
            tokenId: _tokenId,
            standard: _standard,
            token: _token,
            isTokenLsp7: _token != address(0) && _isTokenLsp7,
            unitPrice: _unitPrice,
            amount: _amount,
            remaining: _amount,
            referralBps: _referralBps,
            listedAt: block.timestamp,
            status: ListingStatus.Active
        });
        activeListingOf[_collection][_tokenId][seller] = listingId;

        emit Listed(listingId, seller, _collection, _tokenId, _standard, _token, _token != address(0) && _isTokenLsp7, _unitPrice, _amount, _referralBps);
    }

    function updateListing(
        uint256 _listingId,
        address _token,
        bool _isTokenLsp7,
        uint256 _unitPrice,
        uint256 _referralBps
    ) external whenNotPaused {
        if (_unitPrice == 0) revert InvalidAmount();
        if (_referralBps > MAX_REFERRAL_BPS) revert InvalidReferralBps();

        Listing storage listing = _listings[_listingId];
        if (listing.status != ListingStatus.Active) revert ListingNotActive();
        // Resolving against the stored seller accepts both the seller and their active burner key
        if (listing.seller != _resolveActor(listing.seller)) revert NotTokenOwner();

        listing.token = _token;
        listing.isTokenLsp7 = _token != address(0) && _isTokenLsp7;
        listing.unitPrice = _unitPrice;
        listing.referralBps = _referralBps;

        emit ListingUpdated(_listingId, _token, listing.isTokenLsp7, _unitPrice, _referralBps);
    }

    function cancelListing(uint256 _listingId) external whenNotPaused {
        Listing storage listing = _listings[_listingId];
        if (listing.status != ListingStatus.Active) revert ListingNotActive();
        if (listing.seller != _resolveActor(listing.seller)) revert NotTokenOwner();

        listing.status = ListingStatus.Cancelled;
        delete activeListingOf[listing.collection][listing.tokenId][listing.seller];

        emit ListingCancelled(_listingId, listing.remaining, false);
    }

    function buy(
        address _buyer,
        uint256 _listingId,
        uint256 _quantity,
        address _referral
    ) external payable whenNotPaused nonReentrant {
        Listing storage listing = _listings[_listingId];
        if (listing.status != ListingStatus.Active) revert ListingNotActive();
        if (_quantity == 0) revert InvalidAmount();
        if (_quantity > listing.remaining) revert InsufficientSupply(_quantity, listing.remaining);

        address buyer = _resolveActor(_buyer);
        address seller = listing.seller;

        if (buyer == seller) revert SelfPurchase();
        if (_referral == buyer || _referral == seller) revert InvalidReferral();

        // The listing is only as live as the seller's holdings and this contract's allowance —
        // both are revocable outside our control, so re-verify at settlement time. Only the
        // quantity being bought has to be backed; a listing whose seller moved part of their
        // balance away still fills up to what is left rather than failing outright.
        if (_backing(listing.collection, listing.tokenId, listing.standard, seller) < _quantity) revert StaleListing();

        uint256 totalPrice = listing.unitPrice * _quantity;

        if (listing.token == address(0)) {
            if (msg.value != totalPrice) revert InsufficientPayment(msg.value, totalPrice);
        } else {
            if (msg.value != 0) revert UnexpectedNativePayment();
        }

        // Effects before interactions: supply is decremented, and the listing closed when this
        // fill takes the last edition, before any external call.
        listing.remaining -= _quantity;

        if (listing.remaining == 0) {
            listing.status = ListingStatus.Sold;
            delete activeListingOf[listing.collection][listing.tokenId][seller];
        }

        (uint256 feeAmount, uint256 referralAmount) = _settlePayment(listing, buyer, seller, _referral, totalPrice);

        // Move the editions last, once payment has fully settled.
        _deliver(listing, seller, buyer, _quantity);

        emit Sold(_listingId, buyer, _referral, _quantity, totalPrice, feeAmount, referralAmount, listing.remaining);
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getListing(uint256 _listingId) external view returns (Listing memory) {
        return _listings[_listingId];
    }

    function availableOf(uint256 _listingId) public view returns (uint256) {
        Listing storage listing = _listings[_listingId];
        if (listing.status != ListingStatus.Active) return 0;

        uint256 backed = _backing(listing.collection, listing.tokenId, listing.standard, listing.seller);
        return backed < listing.remaining ? backed : listing.remaining;
    }

    function isPurchasable(uint256 _listingId, uint256 _quantity) external view returns (bool) {
        return _quantity > 0 && availableOf(_listingId) >= _quantity;
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
     * @dev Returns how many editions this contract could actually move for `_owner` right now:
     *      the lesser of their balance and the allowance they granted. ERC1155 approval is
     *      all-or-nothing, so an unapproved owner backs nothing regardless of balance.
     */
    function _backing(address _collection, bytes32 _tokenId, AssetStandard _standard, address _owner) internal view returns (uint256) {
        if (_standard == AssetStandard.LSP7) {
            ILSP7Asset asset = ILSP7Asset(_collection);
            uint256 balance = asset.balanceOf(_owner);
            uint256 authorized = asset.authorizedAmountFor(address(this), _owner);

            return authorized < balance ? authorized : balance;
        }

        IERC1155 asset1155 = IERC1155(_collection);
        if (!asset1155.isApprovedForAll(_owner, address(this))) return 0;

        return asset1155.balanceOf(_owner, uint256(_tokenId));
    }

    /**
     * @dev Splits a fill's payment: the platform fee stays in the contract, the referral share
     *      goes to the referrer (or stays with the seller when none was supplied), and the
     *      remainder goes straight to the seller's wallet. Fee-on-transfer/deflationary tokens are
     *      unsupported: the contract pulls the gross amount and pushes the shares, so a transfer
     *      tax would eat into accumulated fees.
     */
    function _settlePayment(
        Listing storage _listing,
        address _buyer,
        address _seller,
        address _referral,
        uint256 _totalPrice
    ) internal returns (uint256 feeAmount, uint256 referralAmount) {
        feeAmount = (_totalPrice * tradeFeeBps) / FEE_DENOMINATOR;
        referralAmount = _referral == address(0) ? 0 : (_totalPrice * _listing.referralBps) / FEE_DENOMINATOR;

        uint256 sellerAmount = _totalPrice - feeAmount - referralAmount;
        address token = _listing.token;

        if (token == address(0)) {
            _sendNative(_seller, sellerAmount);
            if (referralAmount > 0) _sendNative(_referral, referralAmount);
        } else if (_listing.isTokenLsp7) {
            // LSP7 (LUKSO): buyer must have called authorizeOperator(editions, total) beforehand
            ILSP7Minimal paymentToken = ILSP7Minimal(token);
            paymentToken.transfer(_buyer, address(this), _totalPrice, true, "");
            paymentToken.transfer(address(this), _seller, sellerAmount, true, "");
            if (referralAmount > 0) paymentToken.transfer(address(this), _referral, referralAmount, true, "");
        } else {
            IERC20 paymentToken = IERC20(token);
            paymentToken.safeTransferFrom(_buyer, address(this), _totalPrice);
            paymentToken.safeTransfer(_seller, sellerAmount);
            if (referralAmount > 0) paymentToken.safeTransfer(_referral, referralAmount);
        }
    }

    /**
     * @dev Moves sold editions from seller to buyer. LSP7 forces the transfer so smart-wallet
     *      buyers without LSP1 — e.g. Universal Profiles — can still receive. ERC1155 has no
     *      unforced variant, so a contract buyer there must implement onERC1155Received; that is
     *      the standard's own constraint and does not apply on LUKSO, where ERC1155 is unused.
     */
    function _deliver(Listing storage _listing, address _from, address _to, uint256 _quantity) internal {
        if (_listing.standard == AssetStandard.LSP7) {
            ILSP7Asset(_listing.collection).transfer(_from, _to, _quantity, true, "");
        } else {
            IERC1155(_listing.collection).safeTransferFrom(_from, _to, uint256(_listing.tokenId), _quantity, "");
        }
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
    function isTrustedForwarder(address forwarder) public view override(ERC2771Context, IHupEditions) returns (bool) {
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
