// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./../IHup.sol";

/**
 * @title Hup Store Extension
 * @author Hup Labs
 * @notice Extension contract enabling users to list and sell items on Hup.
 * @dev Integrates with Hup Core via IHup. Supports rotatable EIP-2771 trusted forwarders
 *      for meta-transactions, Ownable for admin permissions, Pausable for emergency controls,
 *      and ReentrancyGuard for purchase distribution. Resolves burner session keys to primary wallets.
 */
contract HupStoreExtension is Ownable, Pausable, ReentrancyGuard, ERC2771Context {

    // --- STRUCTS ---

    struct Listing {
        uint256 price;       // Price per item in wei (native token)
        uint256 quantity;    // Remaining stock available for purchase
        bool isActive;       // Flag indicating if listing is active
        address seller;      // Address of the item seller (receives payment)
    }

    // --- STATE VARIABLES ---

    /// @notice The Hup Core contract instance
    IHup public immutable hupContract;

    /// @notice Maps Hup postId to its corresponding store listing
    mapping(uint256 => Listing) public listings;

    /// @notice Maps Hup postId to buyer to quantity purchased
    mapping(uint256 => mapping(address => uint256)) public amountPurchased;

    /// @dev Internal tracker for the mutable trusted forwarder address
    address private _trustedForwarder;

    // --- EVENTS ---

    event ItemListed(uint256 indexed postId, address indexed seller, uint256 price, uint256 quantity);
    event ItemUpdated(uint256 indexed postId, uint256 price, uint256 quantity, bool isActive);
    event ItemBought(uint256 indexed postId, address indexed buyer, address indexed seller, uint256 price, uint256 quantityBought);
    event TrustedForwarderUpdated(address indexed newTrustedForwarder);

    // --- ERRORS ---

    error InvalidAddress();
    error ContentDeleted();
    error NotCreator();
    error InvalidPrice();
    error InvalidQuantity();
    error ListingNotActive();
    error InsufficientPayment(uint256 provided, uint256 required);
    error OutOfStock();
    error TransferFailed();
    error NotSeller();
    error Unauthorized();
    error SessionExpired();

    // --- CONSTRUCTOR ---

    /**
     * @notice Initializes the store extension contract.
     * @param _hupAddress Address of the deployed core Hup contract.
     * @param _trustedForwarderAddress Address of the EIP-2771 trusted forwarder.
     */
    constructor(address _hupAddress, address _trustedForwarderAddress)
        Ownable(_msgSender())
        ERC2771Context(_trustedForwarderAddress)
    {
        if (_hupAddress == address(0)) revert InvalidAddress();
        hupContract = IHup(_hupAddress);
        _trustedForwarder = _trustedForwarderAddress;
    }

    // --- MUTATIVE LOGIC ---

    /**
     * @notice Lists a new item for sale associated with a Hup post.
     * @dev Only the original post creator can list it for sale.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _postId The ID of the post in Hup.
     * @param _price The price in wei for each unit of the item.
     * @param _quantity The initial stock quantity available.
     */
    function listItem(address _owner, uint256 _postId, uint256 _price, uint256 _quantity) external whenNotPaused {
        if (_price == 0) revert InvalidPrice();
        if (_quantity == 0) revert InvalidQuantity();

        address seller = _resolveActor(_owner);

        // Query the core Hup contract to verify post status and ownership
        IHup.ContentView memory content = hupContract.getContent(_postId, address(0));
        
        if (content.isDeleted) revert ContentDeleted();
        if (content.creator != seller) revert NotCreator();

        listings[_postId] = Listing({
            price: _price,
            quantity: _quantity,
            isActive: true,
            seller: seller
        });

        emit ItemListed(_postId, seller, _price, _quantity);
    }

    /**
     * @notice Updates the pricing, quantity, and/or active status of a listing.
     * @dev Only the seller of the listing can execute this.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _postId The ID of the listed post.
     * @param _price The new price in wei.
     * @param _quantity The new remaining stock quantity.
     * @param _isActive True to enable sales, false to temporarily deactivate listings.
     */
    function updateListing(
        address _owner,
        uint256 _postId,
        uint256 _price,
        uint256 _quantity,
        bool _isActive
    ) external whenNotPaused {
        address seller = _resolveActor(_owner);
        Listing storage listing = listings[_postId];
        if (listing.seller != seller) revert NotSeller();
        if (_price == 0) revert InvalidPrice();

        listing.price = _price;
        listing.quantity = _quantity;
        listing.isActive = _isActive;

        emit ItemUpdated(_postId, _price, _quantity, _isActive);
    }

    /**
     * @notice Deactivates an active listing.
     * @dev Only the seller of the listing can execute this.
     * @param _owner The primary wallet address (or address(0) if caller is primary).
     * @param _postId The ID of the listed post.
     */
    function cancelListing(address _owner, uint256 _postId) external whenNotPaused {
        address seller = _resolveActor(_owner);
        Listing storage listing = listings[_postId];
        if (listing.seller != seller) revert NotSeller();

        listing.isActive = false;

        emit ItemUpdated(_postId, listing.price, listing.quantity, false);
    }

    /**
     * @notice Purchases a specified quantity of items from a listing.
     * @dev Payment must exactly match the price * quantityBought.
     * @param _buyer The primary wallet address of the buyer (or address(0) if caller is primary).
     * @param _postId The ID of the listed post.
     * @param _quantityBought The number of items to purchase.
     */
    function buyItem(address _buyer, uint256 _postId, uint256 _quantityBought) external payable whenNotPaused nonReentrant {
        if (_quantityBought == 0) revert InvalidQuantity();
        
        address buyer = _resolveActor(_buyer);
        
        Listing storage listing = listings[_postId];
        if (!listing.isActive) revert ListingNotActive();
        if (listing.quantity < _quantityBought) revert OutOfStock();

        uint256 requiredPayment = listing.price * _quantityBought;
        if (msg.value != requiredPayment) revert InsufficientPayment(msg.value, requiredPayment);

        // Deduct quantity
        listing.quantity -= _quantityBought;

        // Record purchase
        amountPurchased[_postId][buyer] += _quantityBought;
        
        // If out of stock, automatically set listing to inactive
        if (listing.quantity == 0) {
            listing.isActive = false;
        }

        // Send payment to the seller
        (bool success, ) = listing.seller.call{value: msg.value}("");
        if (!success) revert TransferFailed();

        emit ItemBought(_postId, buyer, listing.seller, listing.price, _quantityBought);
    }

    // --- VIEW FUNCTIONS ---

    /**
     * @notice Retrieves listing details for a post.
     * @param _postId The ID of the post.
     * @return Listing struct containing price, quantity, active status, and seller.
     */
    function getListing(uint256 _postId) external view returns (Listing memory) {
        return listings[_postId];
    }

    // --- ADMIN CONFIGURATION ---

    /**
     * @notice Pauses contract interactions in case of emergencies.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses contract interactions.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Sets a new trusted forwarder address for EIP-2771 meta-transactions.
     * @param _newTrustedForwarder The new trusted forwarder address.
     */
    function setTrustedForwarder(address _newTrustedForwarder) external onlyOwner {
        if (_newTrustedForwarder == address(0)) revert InvalidAddress();
        _trustedForwarder = _newTrustedForwarder;
        emit TrustedForwarderUpdated(_newTrustedForwarder);
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
     * @dev See EIP-2771. Returns true if the address is the trusted forwarder.
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return forwarder == _trustedForwarder;
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
}
