// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/**
 * @title Hup Account Links
 * @author Hup Labs
 * @notice Optional wallet migration signal for Hup accounts.
 * @dev This extension does not transfer or mutate content ownership in the core Hup contract.
 *      It only records an on-chain link from an old wallet to a successor wallet after both
 *      wallets participate in a two-step flow. Indexers and frontends can use these events and
 *      mappings to display account continuity.
 * @custom:version 1.0.0
 * @custom:chain multi-chain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 */
contract HupAccountLinks is Pausable, AccessControl, ERC2771Context {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant MAX_LINK_DEPTH = 32;

    mapping(address => address) public pendingSuccessor;
    mapping(address => address) public successorWallet;

    event WalletLinkRequested(address indexed oldWallet, address indexed newWallet);
    event WalletLinkAccepted(address indexed oldWallet, address indexed newWallet, address indexed previousSuccessor);
    event WalletLinkRequestCancelled(address indexed oldWallet, address indexed pendingNewWallet);
    event WalletLinkRemoved(address indexed oldWallet, address indexed oldSuccessor, address indexed removedBy);

    error NotAdmin();
    error Unauthorized();
    error InvalidAddress();
    error LinkNotRequested();
    error LinkCycle();

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, _msgSender())) revert NotAdmin();
        _;
    }

    constructor(address trustedForwarder, address admin) ERC2771Context(trustedForwarder) {
        if (admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    /**
     * @notice Requests a wallet continuity link from the caller to a successor wallet.
     * @dev The successor wallet must accept the request before the link becomes active.
     * @param newWallet The wallet that should become the caller's successor account.
     */
    function requestWalletLink(address newWallet) external whenNotPaused {
        address oldWallet = _msgSender();

        if (newWallet == address(0) || newWallet == oldWallet) revert InvalidAddress();
        if (_wouldCreateCycle(oldWallet, newWallet)) revert LinkCycle();

        pendingSuccessor[oldWallet] = newWallet;

        emit WalletLinkRequested(oldWallet, newWallet);
    }

    /**
     * @notice Accepts a pending wallet continuity link from an old wallet to the caller.
     * @param oldWallet The wallet that requested the caller as its successor.
     */
    function acceptWalletLink(address oldWallet) external whenNotPaused {
        address newWallet = _msgSender();

        if (oldWallet == address(0) || oldWallet == newWallet) revert InvalidAddress();
        if (pendingSuccessor[oldWallet] != newWallet) revert LinkNotRequested();
        if (_wouldCreateCycle(oldWallet, newWallet)) revert LinkCycle();

        address previousSuccessor = successorWallet[oldWallet];

        successorWallet[oldWallet] = newWallet;
        delete pendingSuccessor[oldWallet];

        emit WalletLinkAccepted(oldWallet, newWallet, previousSuccessor);
    }

    /**
     * @notice Cancels the caller's pending wallet link request.
     */
    function cancelWalletLinkRequest() external whenNotPaused {
        address oldWallet = _msgSender();
        address pendingNewWallet = pendingSuccessor[oldWallet];

        if (pendingNewWallet == address(0)) revert LinkNotRequested();

        delete pendingSuccessor[oldWallet];

        emit WalletLinkRequestCancelled(oldWallet, pendingNewWallet);
    }

    /**
     * @notice Removes an active wallet link.
     * @dev Callable by either the old wallet or the accepted successor wallet.
     * @param oldWallet The wallet whose successor link should be removed.
     */
    function removeWalletLink(address oldWallet) external whenNotPaused {
        address sender = _msgSender();
        address oldSuccessor = successorWallet[oldWallet];

        if (oldWallet == address(0)) revert InvalidAddress();
        if (oldSuccessor == address(0)) revert LinkNotRequested();
        if (sender != oldWallet && sender != oldSuccessor) revert Unauthorized();

        delete successorWallet[oldWallet];

        emit WalletLinkRemoved(oldWallet, oldSuccessor, sender);
    }

    /**
     * @notice Resolves a wallet through active successor links.
     * @dev The lookup stops early when no successor exists. `maxHops` must be kept small by callers.
     * @param wallet The wallet to resolve.
     * @param maxHops Maximum number of successor links to follow.
     * @return resolvedWallet The latest reachable wallet in the successor chain.
     */
    function resolveWallet(address wallet, uint256 maxHops) external view returns (address resolvedWallet) {
        if (wallet == address(0)) revert InvalidAddress();

        resolvedWallet = wallet;
        uint256 hops = maxHops > MAX_LINK_DEPTH ? MAX_LINK_DEPTH : maxHops;

        for (uint256 i = 0; i < hops; i++) {
            address nextWallet = successorWallet[resolvedWallet];
            if (nextWallet == address(0)) break;

            resolvedWallet = nextWallet;
        }
    }

    /**
     * @notice Returns whether `newWallet` is the direct accepted successor for `oldWallet`.
     */
    function isDirectSuccessor(address oldWallet, address newWallet) external view returns (bool) {
        return newWallet != address(0) && successorWallet[oldWallet] == newWallet;
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function _wouldCreateCycle(address oldWallet, address newWallet) internal view returns (bool) {
        address cursor = newWallet;

        for (uint256 i = 0; i < MAX_LINK_DEPTH; i++) {
            if (cursor == oldWallet) return true;

            cursor = successorWallet[cursor];
            if (cursor == address(0)) return false;
        }

        return true;
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}