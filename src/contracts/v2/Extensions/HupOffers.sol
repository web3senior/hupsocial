// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./IHupOffers.sol";
import "./ILSP7Minimal.sol";
import "./ILSP7Asset.sol";
import "./ILSP8Minimal.sol";

/**
 * @title Hup Offers
 * @author Hup Labs
 * @notice Extension contract enabling escrow-backed buy offers and OTC deals on every asset kind
 *         Hup trades — one-of-one NFTs (ERC721, LSP8), balance-based editions (ERC1155,
 *         non-divisible LSP7), and fungible tokens (divisible LSP7, ERC20, the native coin). The
 *         offerer escrows the payment side up front, so a fill can never bounce on a stale
 *         allowance; the asset side stays non-custodial and is delivered by whoever fills the
 *         offer. Whole-unit assets fill in parts; one-of-ones and divisible fungibles fill
 *         all-or-nothing, so no rounding can exist. An offer can be locked to a single
 *         counterparty, turning a deal negotiated in a post or chat into a private settlement
 *         that cannot be sniped. Whitelisted ERC677 tokens (e.g. GoodDollar) fund or fill an
 *         offer in one transferAndCall transaction.
 * @dev The buy-side complement of HupTrade and HupEditions, both deliberately left untouched:
 *      they are deployed and immutable, and offers need no cross-contract coupling — when a fill
 *      moves a token out from under a live listing, the listing contracts' own stale-listing
 *      logic invalidates it. Unlike those siblings, this contract HOLDS user funds (offer
 *      escrow), so admin withdrawal is limited to fees accrued per payment token at fill time;
 *      there is no whole-balance sweep, and cancelOffer works even while paused so an exit from
 *      escrow is never blockable. Uses IHupOffers for shared structs, events, errors, and view
 *      signatures.
 *
 *      Deliberately has no meta-transaction support and no burner-session resolution, unlike its
 *      siblings: every action is attributed to msg.sender and nothing else. Both sides of an
 *      offer must already control value — the offerer's escrow is pulled from the caller, the
 *      seller's asset is moved out of the caller's own holdings — so relaying buys no
 *      convenience a signature wouldn't already have to provide. What it would buy is an
 *      impersonation surface: an ERC2771 forwarder is, by construction, an address permitted to
 *      name any sender, and this contract's whole reason to exist is spending standing
 *      approvals. With msg.sender as the only identity, a compromised admin can pause the
 *      contract, move the fee within its cap, and withdraw accrued fees — it can never move a
 *      user's tokens. The one attribution that is not the caller is ERC677's onTokenTransfer,
 *      where the caller is the whitelisted token itself reporting who paid it.
 *
 *      AccessControl for admin permissions, Pausable for emergency controls, and ReentrancyGuard
 *      for protected settlement. Every state change emits an event; offchain indexers derive
 *      full offer state from OfferMade / OfferFilled / OfferCancelled alone.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🤝
 */
contract HupOffers is IHupOffers, Pausable, ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    // --- STATE VARIABLES ---

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant ABSOLUTE_MAX_OFFER_FEE_BPS = 1_000;
    uint256 public constant MAX_OFFER_LIFETIME = 180 days;
    uint8 public constant ERC677_ACTION_MAKE = 1;
    uint8 public constant ERC677_ACTION_FILL = 2;

    /// @notice Total number of offers ever created; ids are 1..offerCount
    uint256 public offerCount;

    /// @notice Maps offerId to its offer
    mapping(uint256 => Offer) private _offers;

    /// @notice Maps collection to tokenId to offerer to that offerer's active offerId (0 when
    ///         none). One active offer per asset per offerer; making another auto-cancels and
    ///         refunds the old one. NATIVE-asset offers key under collection address(0).
    mapping(address => mapping(bytes32 => mapping(address => uint256))) public activeOfferOf;

    /// @notice Percentage fee charged on each fill, in basis points (100 = 1%)
    uint256 public offerFeeBps = 0;

    /// @notice Fees accrued and withdrawable per payment token (address(0) = native). Everything
    ///         else the contract holds is live offer escrow: there is deliberately no
    ///         whole-balance withdrawal in this contract, so user escrow is out of admin reach
    ///         by construction.
    mapping(address => uint256) public accruedFees;

    /// @notice ERC677 tokens whose onTokenTransfer callback is accepted for one-transaction
    ///         offer funding and filling.
    /// @dev Admin-curated, and deliberately not auto-detected: onTokenTransfer is invoked *by
    ///      the token contract*, and the whitelist is the only proof that a real transfer
    ///      actually happened. Without this gate any contract could call onTokenTransfer with an
    ///      arbitrary _sender and mint offers or collect escrow out of thin air.
    mapping(address => bool) public erc677Tokens;

    // --- MODIFIERS ---

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the offers contract.
     * @param _admin Address granted DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     */
    constructor(address _admin) {
        if (_admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    // --- MUTATIVE LOGIC ---

    function makeOffer(
        address _collection,
        bytes32 _tokenId,
        AssetStandard _standard,
        address _token,
        bool _isTokenLsp7,
        uint256 _price,
        uint256 _amount,
        uint256 _expiresAt,
        address _counterparty
    ) external payable whenNotPaused nonReentrant returns (uint256 offerId) {
        Offer memory offer = Offer({
            offerer: msg.sender,
            counterparty: _counterparty,
            collection: _collection,
            tokenId: _tokenId,
            standard: _standard,
            partialFillable: false,
            token: _token,
            isTokenLsp7: _token != address(0) && _isTokenLsp7,
            price: _price,
            amount: _amount,
            remaining: _amount,
            expiresAt: _expiresAt,
            createdAt: block.timestamp,
            feeBps: offerFeeBps,
            status: OfferStatus.Active
        });
        offer.partialFillable = _validateOffer(offer);

        // Escrow the full payment before the offer exists, and prove it actually arrived.
        // Fee-on-transfer/deflationary payment tokens are unsupported, and measuring the balance
        // delta is what enforces that rather than merely documenting it: the offer is credited
        // with `price`, so a token that delivers less would leave this offer's refunds and
        // payouts drawing on other offers' escrow denominated in the same token.
        if (offer.token == address(0)) {
            if (msg.value != offer.price) revert InsufficientPayment(msg.value, offer.price);
        } else {
            if (msg.value != 0) revert UnexpectedNativePayment();

            uint256 balanceBefore;
            uint256 received;

            if (offer.isTokenLsp7) {
                // LSP7 (LUKSO): offerer must have called authorizeOperator(offers, price) beforehand
                balanceBefore = ILSP7Asset(offer.token).balanceOf(address(this));
                ILSP7Minimal(offer.token).transfer(offer.offerer, address(this), offer.price, true, "");
                received = ILSP7Asset(offer.token).balanceOf(address(this)) - balanceBefore;
            } else {
                balanceBefore = IERC20(offer.token).balanceOf(address(this));
                IERC20(offer.token).safeTransferFrom(offer.offerer, address(this), offer.price);
                received = IERC20(offer.token).balanceOf(address(this)) - balanceBefore;
            }

            if (received != offer.price) revert EscrowShortfall(offer.price, received);
        }

        offerId = _createOffer(offer);
    }

    function acceptOffer(uint256 _offerId, uint256 _quantity) external payable whenNotPaused nonReentrant {
        Offer storage offer = _offers[_offerId];
        if (offer.status != OfferStatus.Active) revert OfferNotActive();
        if (block.timestamp >= offer.expiresAt) revert OfferExpired();
        if (_quantity == 0) revert InvalidAmount();
        if (_quantity > offer.remaining) revert InsufficientRemaining(_quantity, offer.remaining);
        if (!offer.partialFillable && _quantity != offer.remaining) revert PartialFillNotAllowed();

        address seller = msg.sender;
        if (seller == offer.offerer) revert SelfFill();
        if (offer.counterparty != address(0) && seller != offer.counterparty) revert NotCounterparty();

        if (offer.standard == AssetStandard.NATIVE) {
            // Native has no approval mechanism, and needs none: the value attached to this call
            // IS the delivery, forwarded to the offerer at settlement.
            if (msg.value != _quantity) revert InsufficientPayment(msg.value, _quantity);
        } else {
            if (msg.value != 0) revert UnexpectedNativePayment();

            // The asset side is only as live as the seller's holdings and this contract's
            // transfer rights — both are revocable outside our control, so verify at fill time.
            uint256 available = _fillableOf(offer, seller);
            if (available < _quantity) revert InsufficientBacking(_quantity, available);
        }

        _settleFill(offer, _offerId, seller, _quantity, false);
    }

    function cancelOffer(uint256 _offerId) external nonReentrant {
        // No whenNotPaused, deliberately: pause halts offer creation and fills, but an exit from
        // escrow must never be blockable. This is also the reclaim path for expired offers.
        Offer storage offer = _offers[_offerId];
        if (offer.status != OfferStatus.Active) revert OfferNotActive();
        if (offer.offerer != msg.sender) revert Unauthorized();

        uint256 unfilled = offer.remaining;
        uint256 refund = (offer.price * unfilled) / offer.amount;

        offer.status = OfferStatus.Cancelled;
        delete activeOfferOf[offer.collection][offer.tokenId][offer.offerer];

        _payOut(offer.token, offer.isTokenLsp7, offer.offerer, refund);

        emit OfferCancelled(_offerId, unfilled, false);
    }

    function onTokenTransfer(address _sender, uint256 _amount, bytes calldata _data) external whenNotPaused nonReentrant returns (bool) {
        // msg.sender IS the token contract. The whitelist is the only proof that a real transfer
        // preceded this call — see the erc677Tokens declaration for why it can't be inferred.
        if (!erc677Tokens[msg.sender]) revert UnsupportedToken();
        if (_data.length == 0) revert InvalidOfferData();

        (uint8 action, bytes memory params) = abi.decode(_data, (uint8, bytes));

        // _sender over msg.sender on both paths, and it is the only place this contract credits
        // anyone but its caller: here the caller IS the token, reporting who actually paid it.
        //
        // Already-funded: transferAndCall moves the tokens before invoking this callback, so the
        // make path skips the escrow pull and the fill path forwards instead of pulling.
        // Reverting anywhere below unwinds that transfer — ERC677 requires this callback to
        // succeed — so a rejected offer or fill can never strand funds in the contract.
        if (action == ERC677_ACTION_MAKE) {
            _makeOfferErc677(_sender, _amount, params);
        } else if (action == ERC677_ACTION_FILL) {
            _fillOfferErc677(_sender, _amount, params);
        } else {
            revert InvalidOfferData();
        }

        return true;
    }

    // --- VIEW FUNCTIONS ---

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    function getOffer(uint256 _offerId) external view returns (Offer memory) {
        return _offers[_offerId];
    }

    function escrowOf(uint256 _offerId) external view returns (uint256) {
        Offer storage offer = _offers[_offerId];
        if (offer.status != OfferStatus.Active) return 0;

        return (offer.price * offer.remaining) / offer.amount;
    }

    function isFillable(uint256 _offerId, address _seller, uint256 _quantity) external view returns (bool) {
        Offer storage offer = _offers[_offerId];
        if (offer.status != OfferStatus.Active) return false;
        if (block.timestamp >= offer.expiresAt) return false;
        if (_quantity == 0 || _quantity > offer.remaining) return false;
        if (!offer.partialFillable && _quantity != offer.remaining) return false;
        if (_seller == offer.offerer) return false;
        if (offer.counterparty != address(0) && _seller != offer.counterparty) return false;

        return _fillableOf(offer, _seller) >= _quantity;
    }

    // --- ADMIN CONFIGURATION ---

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function setOfferFeeBps(uint256 _offerFeeBps) external onlyAdmin {
        if (_offerFeeBps > ABSOLUTE_MAX_OFFER_FEE_BPS) revert InvalidFeeBps();

        uint256 oldValue = offerFeeBps;
        offerFeeBps = _offerFeeBps;

        emit OfferFeeUpdated(oldValue, _offerFeeBps);
    }

    function setErc677Token(address _token, bool _enabled) external onlyAdmin {
        if (_token == address(0)) revert InvalidAddress();

        erc677Tokens[_token] = _enabled;

        emit Erc677TokenUpdated(_token, _enabled);
    }

    function withdrawFees(address _token, address _receiver, bool _isLsp7) external onlyAdmin nonReentrant {
        if (_receiver == address(0)) revert InvalidAddress();

        uint256 amount = accruedFees[_token];
        if (amount == 0) revert InvalidAmount();

        accruedFees[_token] = 0;
        _payOut(_token, _isLsp7, _receiver, amount);

        emit FeesWithdrawn(_token, _receiver, amount);
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
     * @dev Validates a new offer's asset shape and terms, and resolves its fill mode. Reverts on
     *      any inconsistency; returns true when the offer is partial-fillable (whole-unit
     *      assets), false when it must fill all-or-nothing.
     */
    function _validateOffer(Offer memory _offer) internal view returns (bool partialFillable) {
        if (_offer.price == 0 || _offer.amount == 0) revert InvalidAmount();
        if (_offer.expiresAt <= block.timestamp || _offer.expiresAt > block.timestamp + MAX_OFFER_LIFETIME) revert InvalidExpiry();
        // An offer locked to its own offerer could never be filled by anyone
        if (_offer.counterparty == _offer.offerer) revert SelfFill();

        AssetStandard standard = _offer.standard;

        if (standard == AssetStandard.NATIVE) {
            // The native coin has no contract: its offers key under address(0) / bytes32(0),
            // and paying native for native is meaningless.
            if (_offer.collection != address(0)) revert InvalidAddress();
            if (_offer.tokenId != bytes32(0)) revert InvalidTokenId();
            if (_offer.token == address(0)) revert SameToken();

            return false;
        }

        if (_offer.collection == address(0)) revert InvalidAddress();
        if (_offer.collection == _offer.token) revert SameToken();

        if (standard == AssetStandard.ERC721 || standard == AssetStandard.LSP8) {
            if (_offer.amount != 1) revert InvalidAmount();
            // Also proves the token exists: both owner lookups revert for a nonexistent id
            if (_currentOwner(_offer.collection, _offer.tokenId, standard == AssetStandard.LSP8) == _offer.offerer) revert SelfOffer();

            return false;
        }

        if (standard == AssetStandard.ERC1155) {
            // ERC1155 is the one standard with no unforced transfer: settlement calls
            // onERC1155Received on the offerer. A contract offerer that can't answer it would
            // post an offer nobody can ever fill, and every seller who tried would pay gas to
            // find out. Rejecting it here puts that cost on the offerer instead, at creation.
            // (An accept-then-swallow try/catch at delivery is not the alternative: it would
            // pay the seller for an asset that never moved.)
            if (_offer.offerer.code.length > 0 && !_acceptsErc1155(_offer.offerer)) revert UnsupportedReceiver();

            partialFillable = true;
        } else if (standard == AssetStandard.LSP7) {
            // LSP7 identifies an asset by contract alone, so its offers pin a canonical zero id.
            // Non-divisible LSP7s are editions and fill in parts; divisible ones are fungible
            // tokens and fill all-or-nothing, like ERC20.
            if (_offer.tokenId != bytes32(0)) revert InvalidTokenId();
            partialFillable = ILSP7Asset(_offer.collection).decimals() == 0;
        } else {
            // ERC20
            if (_offer.tokenId != bytes32(0)) revert InvalidTokenId();
            partialFillable = false;
        }

        // Every partial fill pays price * quantity / amount; requiring a whole per-unit price
        // makes that exact for any quantity, so no rounding remainder can ever accumulate.
        if (partialFillable && _offer.price % _offer.amount != 0) revert IndivisiblePrice();
    }

    /**
     * @dev Writes a validated, already-funded offer to storage. If the offerer has an active
     *      offer on the same asset, it is cancelled and its remaining escrow refunded first, so
     *      one offerer never double-escrows against one asset.
     */
    function _createOffer(Offer memory _offer) internal returns (uint256 offerId) {
        uint256 existingId = activeOfferOf[_offer.collection][_offer.tokenId][_offer.offerer];

        // The new offer is written first so the refund below is the last thing this function
        // does. Every caller is nonReentrant, so a hook inside that refund cannot re-enter and
        // act on half-built state — but it CAN read, and a view returning an asset with its
        // previous offer already cancelled and its replacement not yet stored is a wrong answer
        // to anyone integrating against escrowOf/isFillable. Strict effects-before-interactions
        // costs nothing here and removes the window entirely.
        offerId = ++offerCount;
        _offers[offerId] = _offer;
        activeOfferOf[_offer.collection][_offer.tokenId][_offer.offerer] = offerId;

        if (existingId != 0) {
            Offer storage existing = _offers[existingId];

            if (existing.status == OfferStatus.Active) {
                uint256 unfilled = existing.remaining;
                uint256 refund = (existing.price * unfilled) / existing.amount;

                existing.status = OfferStatus.Cancelled;
                emit OfferCancelled(existingId, unfilled, true);

                _payOut(existing.token, existing.isTokenLsp7, _offer.offerer, refund);
            }
        }

        emit OfferMade(offerId, _offer.offerer, _offer.collection, _offer.tokenId, _offer.standard, _offer.partialFillable, _offer.token, _offer.isTokenLsp7, _offer.price, _offer.amount, _offer.expiresAt, _offer.counterparty);
    }

    /**
     * @dev Creates an offer from an ERC677 transferAndCall payload. The transferred `_escrow` is
     *      already in the contract and becomes the offer's full price; the calling token is the
     *      payment token.
     */
    function _makeOfferErc677(address _offerer, uint256 _escrow, bytes memory _params) internal {
        (address collection, bytes32 tokenId, uint8 standard, uint256 amount, uint256 expiresAt, address counterparty) = abi.decode(_params, (address, bytes32, uint8, uint256, uint256, address));

        if (standard > uint8(AssetStandard.NATIVE)) revert InvalidOfferData();

        Offer memory offer = Offer({
            offerer: _offerer,
            counterparty: counterparty,
            collection: collection,
            tokenId: tokenId,
            standard: AssetStandard(standard),
            partialFillable: false,
            token: msg.sender,
            isTokenLsp7: false,
            price: _escrow,
            amount: amount,
            remaining: amount,
            expiresAt: expiresAt,
            createdAt: block.timestamp,
            feeBps: offerFeeBps,
            status: OfferStatus.Active
        });
        offer.partialFillable = _validateOffer(offer);

        _createOffer(offer);
    }

    /**
     * @dev Fills an offer from an ERC677 transferAndCall payload. The delivered `_quantity` is
     *      already in the contract; the calling token must be the offer's ERC20 asset, and since
     *      ERC20 offers fill all-or-nothing, the quantity must equal the offer's remaining
     *      exactly — anything else reverts and unwinds the transfer.
     */
    function _fillOfferErc677(address _seller, uint256 _quantity, bytes memory _params) internal {
        uint256 offerId = abi.decode(_params, (uint256));

        Offer storage offer = _offers[offerId];
        if (offer.status != OfferStatus.Active) revert OfferNotActive();
        if (block.timestamp >= offer.expiresAt) revert OfferExpired();
        if (offer.standard != AssetStandard.ERC20 || offer.collection != msg.sender) revert InvalidOfferData();
        if (_seller == offer.offerer) revert SelfFill();
        if (offer.counterparty != address(0) && _seller != offer.counterparty) revert NotCounterparty();
        if (_quantity != offer.remaining) revert InvalidAmount();

        _settleFill(offer, offerId, _seller, _quantity, true);
    }

    /**
     * @dev Settles a fill: decrements supply (closing the offer when this fill takes the last of
     *      it), accrues the platform fee, delivers the asset to the offerer, and only then
     *      releases the escrowed payment to the seller. Effects before interactions throughout.
     */
    function _settleFill(Offer storage _offer, uint256 _offerId, address _seller, uint256 _quantity, bool _assetPrefunded) internal {
        // Exact by construction: partial-fillable offers enforce price % amount == 0, and
        // all-or-nothing offers only ever settle the full remaining amount.
        uint256 payout = (_offer.price * _quantity) / _offer.amount;

        _offer.remaining -= _quantity;

        if (_offer.remaining == 0) {
            _offer.status = OfferStatus.Filled;
            delete activeOfferOf[_offer.collection][_offer.tokenId][_offer.offerer];
        }

        uint256 feeAmount = (payout * _offer.feeBps) / FEE_DENOMINATOR;
        if (feeAmount > 0) accruedFees[_offer.token] += feeAmount;

        _deliverAsset(_offer, _seller, _quantity, _assetPrefunded);
        _payOut(_offer.token, _offer.isTokenLsp7, _seller, payout - feeAmount);

        emit OfferFilled(_offerId, _seller, _quantity, payout, feeAmount, _offer.remaining);
    }

    /**
     * @dev Moves the filled asset to the offerer. ERC721 uses transferFrom (not
     *      safeTransferFrom) and LSP8/LSP7 force the transfer, so smart-wallet offerers without
     *      onERC721Received/LSP1 — e.g. Universal Profiles — can still receive. ERC1155 has no
     *      unforced variant, so a contract offerer there must implement onERC1155Received; that
     *      is the standard's own constraint and does not apply on LUKSO, where ERC1155 is
     *      unused. A NATIVE fill forwards the value that arrived with the accept call; an ERC677
     *      fill forwards tokens that transferAndCall already moved into the contract.
     */
    function _deliverAsset(Offer storage _offer, address _seller, uint256 _quantity, bool _prefunded) internal {
        AssetStandard standard = _offer.standard;

        if (standard == AssetStandard.NATIVE) {
            _sendNative(_offer.offerer, _quantity);
        } else if (standard == AssetStandard.ERC721) {
            IERC721(_offer.collection).transferFrom(_seller, _offer.offerer, uint256(_offer.tokenId));
        } else if (standard == AssetStandard.LSP8) {
            ILSP8Minimal(_offer.collection).transfer(_seller, _offer.offerer, _offer.tokenId, true, "");
        } else if (standard == AssetStandard.ERC1155) {
            IERC1155(_offer.collection).safeTransferFrom(_seller, _offer.offerer, uint256(_offer.tokenId), _quantity, "");
        } else if (standard == AssetStandard.LSP7) {
            ILSP7Asset(_offer.collection).transfer(_seller, _offer.offerer, _quantity, true, "");
        } else if (_prefunded) {
            IERC20(_offer.collection).safeTransfer(_offer.offerer, _quantity);
        } else {
            IERC20(_offer.collection).safeTransferFrom(_seller, _offer.offerer, _quantity);
        }
    }

    /**
     * @dev Returns how much of the offer's asset this contract could actually move for `_seller`
     *      right now. One-of-ones report 0 or 1 (ownership plus transfer rights); balance-based
     *      standards report the lesser of balance and the allowance granted to this contract.
     *      NATIVE is unbounded — delivery arrives as call value, so there is nothing to probe.
     */
    function _fillableOf(Offer storage _offer, address _seller) internal view returns (uint256) {
        AssetStandard standard = _offer.standard;

        if (standard == AssetStandard.NATIVE) {
            return type(uint256).max;
        }

        address collection = _offer.collection;

        if (standard == AssetStandard.ERC721) {
            IERC721 asset = IERC721(collection);
            uint256 id = uint256(_offer.tokenId);
            if (asset.ownerOf(id) != _seller) return 0;

            return (asset.getApproved(id) == address(this) || asset.isApprovedForAll(_seller, address(this))) ? 1 : 0;
        }

        if (standard == AssetStandard.LSP8) {
            ILSP8Minimal asset = ILSP8Minimal(collection);
            if (asset.tokenOwnerOf(_offer.tokenId) != _seller) return 0;

            return asset.isOperatorFor(address(this), _offer.tokenId) ? 1 : 0;
        }

        if (standard == AssetStandard.ERC1155) {
            IERC1155 asset = IERC1155(collection);
            // ERC1155 approval is all-or-nothing, so an unapproved seller backs nothing
            if (!asset.isApprovedForAll(_seller, address(this))) return 0;

            return asset.balanceOf(_seller, uint256(_offer.tokenId));
        }

        if (standard == AssetStandard.LSP7) {
            ILSP7Asset asset = ILSP7Asset(collection);
            uint256 balance = asset.balanceOf(_seller);
            uint256 authorized = asset.authorizedAmountFor(address(this), _seller);

            return authorized < balance ? authorized : balance;
        }

        IERC20 asset20 = IERC20(collection);
        uint256 erc20Balance = asset20.balanceOf(_seller);
        uint256 allowance = asset20.allowance(_seller, address(this));

        return allowance < erc20Balance ? allowance : erc20Balance;
    }

    /**
     * @dev Whether a contract advertises IERC1155Receiver through ERC165. A false answer, or no
     *      ERC165 at all, means an ERC1155 delivery to it would revert. This is a necessary
     *      condition, not a sufficient one — a contract can advertise the interface and still
     *      revert in the hook — so it catches the honest mistake and the lazy grief, not a
     *      determined one.
     */
    function _acceptsErc1155(address _account) internal view returns (bool) {
        try IERC165(_account).supportsInterface(type(IERC1155Receiver).interfaceId) returns (bool supported) {
            return supported;
        } catch {
            return false;
        }
    }

    /**
     * @dev Returns the token's current owner in either one-of-one standard.
     */
    function _currentOwner(address _collection, bytes32 _tokenId, bool _isLsp8) internal view returns (address) {
        if (_isLsp8) {
            return ILSP8Minimal(_collection).tokenOwnerOf(_tokenId);
        }
        return IERC721(_collection).ownerOf(uint256(_tokenId));
    }

    /**
     * @dev Pays out from the contract's own holdings — escrow releases, refunds, and fee
     *      withdrawals — in whichever kind the payment side is denominated.
     */
    function _payOut(address _token, bool _isLsp7, address _to, uint256 _amount) internal {
        if (_amount == 0) return;

        if (_token == address(0)) {
            _sendNative(_to, _amount);
        } else if (_isLsp7) {
            ILSP7Minimal(_token).transfer(address(this), _to, _amount, true, "");
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
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

    receive() external payable {
        // Unattributed native joins the fee pool rather than being stranded: per-offer escrow
        // accounting is untouched by it, and this contract has no whole-balance sweep to
        // recover it any other way.
        accruedFees[address(0)] += msg.value;

        emit UnattributedDeposit(msg.sender, msg.value);
    }
}
