// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// $HUP: 0x88C0963857049368470E2851aFf5EDFc2D32346C : Monad testnet (three-argument constructor,
//       deployed before owner_ was added — verify it from the git version of that deploy)

/**
 * @title Hup Test Token
 * @author Hup Labs
 * @notice Throwaway ERC20 used to test HupBazaar token-priced listings and purchases on testnets.
 * @dev Name, symbol, and decimals are constructor-configurable so it can mimic real payment tokens
 *      (e.g. 6-decimal USDC). Anyone can pull tokens from the open faucet; the owner can mint
 *      arbitrary amounts. The owner — who also receives the initial supply — is an explicit
 *      argument rather than `msg.sender`, so a deploy through the CREATE2 factory
 *      (tests/deploy.html) does not hand ownership and a million tokens to the factory.
 *      Not for production use — no supply cap, no access control on faucet.
 * @custom:version 1.0.0
 * @custom:chain testnet-only
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🧪
 */
contract HupTestToken is ERC20, Ownable {
    // --- STATE VARIABLES ---

    /// @notice Amount of whole tokens dispensed per faucet call
    uint256 public constant FAUCET_DRIP = 1_000;

    uint8 private immutable _tokenDecimals;

    // --- EVENTS ---

    /// @notice Emitted when the faucet dispenses tokens
    event FaucetDripped(address indexed to, uint256 amount);

    // --- LOGIC ---

    /// @param name_ Token name (e.g. "Hup Test Token")
    /// @param symbol_ Token symbol (e.g. "tHUP")
    /// @param decimals_ Token decimals (18 for a standard token, 6 to mimic USDC)
    /// @param owner_ Owner and recipient of the initial supply — never a factory address
    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _tokenDecimals = decimals_;
        _mint(owner_, 1_000_000 * 10 ** decimals_);
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    /// @notice Mints FAUCET_DRIP whole tokens to the caller — open to anyone for testing
    function faucet() external {
        uint256 amount = FAUCET_DRIP * 10 ** _tokenDecimals;
        _mint(msg.sender, amount);
        emit FaucetDripped(msg.sender, amount);
    }

    /// @notice Mints an arbitrary amount to any address — owner only
    /// @param to Recipient of the minted tokens
    /// @param amount Amount in base units (already scaled by decimals)
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
