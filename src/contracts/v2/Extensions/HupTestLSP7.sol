// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { LSP7Mintable } from "@lukso/lsp7-contracts/contracts/presets/LSP7Mintable.sol";
import { _LSP4_TOKEN_TYPE_TOKEN } from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";

// HupTestLSP7: <address> : Monad testnet

/**
 * @title Hup Test LSP7
 * @author Hup Labs
 * @notice Throwaway LSP7 Digital Asset used to exercise the operator-authorized payment path —
 *         tips, Bazaar listings, Trade sales, Predict bets — on any testnet.
 * @dev The LSP7 twin of `HupTestToken`. It exists because every LSP7 code path in the app
 *      (`authorizeOperator` → `authorizedAmountFor` → `transfer(from, to, amount, force, data)`)
 *      is chain-agnostic in the contracts but has only ever been testable against LUKSO, where the
 *      Hup deployments are inactive. Deploying this on a chain cidex actually indexes makes that
 *      path verifiable end to end.
 *
 *      `LSP7Mintable` supplies the public `mint(to, amount, force, data)`; this contract adds the
 *      open faucet on top. Since lsp7-contracts 0.18 that mint is gated by `MINTER_ROLE`, which the
 *      preset grants to `owner()` at construction — so the deployer can mint, and `disableMinting()`
 *      turns off the faucet as well, because internal `_mint` checks the same `isMintable` flag.
 *
 *      Divisible (18 decimals) rather than constructor-configurable like `HupTestToken`: LSP7
 *      derives `decimals()` from the divisibility flag, so a USDC-mimicking 6 would mean overriding
 *      the standard's own accessor against its stored flag.
 *
 *      Every mint passes `force: true`. A false would reject exactly the addresses that hold test
 *      funds — plain EOAs, and Universal Profiles with no LSP1 delegate wired up. Same call as
 *      `SunriseLSP8.mint` makes, for the same reason.
 *
 *      The owner — who also receives the initial supply and the `MINTER_ROLE` — is an explicit
 *      argument rather than `msg.sender`, so a deploy through the CREATE2 factory
 *      (tests/deploy.html) does not hand both to the factory.
 *
 *      Not for production use — no supply cap, no cooldown, and the faucet is open to anyone.
 * @custom:version 1.0.0
 * @custom:chain testnet-only
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🧪
 */
contract HupTestLSP7 is LSP7Mintable {
  // --- STATE VARIABLES ---

  /// @notice Whole tokens dispensed per faucet call
  uint256 public constant FAUCET_DRIP = 1_000;

  /// @notice Whole tokens minted to the deployer at construction
  uint256 public constant INITIAL_SUPPLY = 1_000_000;

  // --- EVENTS ---

  /// @notice Emitted when the faucet dispenses tokens
  event FaucetDripped(address indexed to, uint256 amount);

  // --- CONSTRUCTOR ---

  /// @param name_ Token name, written to LSP4 metadata (e.g. "Hup Test LSP7")
  /// @param symbol_ Token symbol, written to LSP4 metadata (e.g. "tLSP7") — this is what the app
  ///        reads back through ERC725Y `getData(LSP4TokenSymbol)`, since LSP7 has no `symbol()`
  /// @param owner_ Owner, minter, and recipient of the initial supply — never a factory address
  constructor(
    string memory name_,
    string memory symbol_,
    address owner_
  ) LSP7Mintable(name_, symbol_, owner_, _LSP4_TOKEN_TYPE_TOKEN, false) {
    _mint(owner_, INITIAL_SUPPLY * 10 ** decimals(), true, "");
  }

  // --- MUTATIVE LOGIC ---

  /// @notice Mints FAUCET_DRIP whole tokens to the caller — open to anyone, unlimited, for testing
  function faucet() external {
    uint256 amount = FAUCET_DRIP * 10 ** decimals();
    _mint(msg.sender, amount, true, "");
    emit FaucetDripped(msg.sender, amount);
  }
}
