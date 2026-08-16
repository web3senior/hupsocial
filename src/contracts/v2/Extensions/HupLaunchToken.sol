// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Hup Launch Token
 * @author Hup Labs
 * @notice The ERC20 minted for every Hup Launch. Deliberately inert: fixed supply, no owner, no
 *         mint, no burn, no pause, no upgrade path, no allocation schedule.
 * @dev Deployed once as an implementation and cloned per launch via EIP-1167, so creating a token
 *      costs a proxy deployment instead of a full one. Clones cannot run constructors, so name and
 *      symbol live in regular storage behind overridden getters and are set by `initialize`, which
 *      the factory calls atomically in the same transaction as the clone. The implementation locks
 *      itself in its own constructor so it can never be initialized directly.
 *
 *      Inertness is a product requirement, not an oversight. Hup Launch is for memecoins — assets
 *      whose value comes from demand and culture rather than anyone's ongoing effort. A token with
 *      a mint function, a team allocation, or an admin key would contradict that, so none exist.
 *      The factory can halt trading on its own curve; it has no power over this contract at all.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🪙
 */
contract HupLaunchToken is ERC20 {
    // --- STATE VARIABLES ---

    /// @notice The HupLaunch contract that created this token. Provenance for explorers and
    ///         clients — cross-check against `HupLaunch.launchIdOf(address(this))`.
    address public factory;

    string private _tokenName;
    string private _tokenSymbol;
    bool private _initialized;

    // --- ERRORS ---

    error AlreadyInitialized();
    error TokenInfoRequired();
    error InvalidAddress();
    error InvalidAmount();

    // --- LOGIC ---

    /// @dev The implementation is born initialized so it can only ever serve as clone bytecode.
    ///      Empty strings here are never read: `name()` and `symbol()` are overridden below.
    constructor() ERC20("", "") {
        _initialized = true;
    }

    /**
     * @notice Names the token and mints its entire fixed supply, once.
     * @dev Callable exactly once per clone. There is no front-running window: the factory clones
     *      and initializes in a single transaction, and plain CREATE makes the clone address
     *      unpredictable until that transaction lands.
     * @param name_ Token name.
     * @param symbol_ Ticker symbol.
     * @param recipient_ Receives the entire supply — always the factory, which escrows it.
     * @param supply_ Total supply in base units. This is the only mint that will ever occur.
     */
    function initialize(string calldata name_, string calldata symbol_, address recipient_, uint256 supply_)
        external
    {
        if (_initialized) revert AlreadyInitialized();
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0) revert TokenInfoRequired();
        if (recipient_ == address(0)) revert InvalidAddress();
        if (supply_ == 0) revert InvalidAmount();

        _initialized = true;
        factory = msg.sender;
        _tokenName = name_;
        _tokenSymbol = symbol_;

        _mint(recipient_, supply_);
    }

    /// @inheritdoc ERC20
    function name() public view override returns (string memory) {
        return _tokenName;
    }

    /// @inheritdoc ERC20
    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }
}
