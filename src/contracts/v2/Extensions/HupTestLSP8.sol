// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { LSP8Mintable } from "@lukso/lsp8-contracts/contracts/presets/LSP8Mintable.sol";
import { _LSP8_TOKENID_FORMAT_NUMBER } from "@lukso/lsp8-contracts/contracts/LSP8Constants.sol";
import { _LSP4_TOKEN_TYPE_COLLECTION } from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";

// HupTestLSP8: <address> : <chain>

/**
 * @title Hup Test LSP8
 * @author Hup Labs
 * @notice Throwaway LSP8 Identifiable Digital Asset used to exercise every NFT-holding gate and
 *         surface — poll and community `NftBalance` requirements, Trade listings, Offers, the
 *         Assets tab — on any testnet, without waiting for a real collection to exist there.
 * @dev The LSP8 twin of `HupTestERC721`, and the collection-shaped sibling of `HupTestLSP7`.
 *      Token ids are sequential numbers from 1 cast to bytes32 (`_LSP8_TOKENID_FORMAT_NUMBER`),
 *      the same convention HupDropCollectionLSP8 and HupTrade use, so an ERC721-style id casts
 *      losslessly in both directions and the app's id display needs no special case.
 *
 *      `LSP8Mintable` supplies the public `mint(to, tokenId, force, data)`, gated by
 *      `MINTER_ROLE` (granted to `owner()` at construction); this contract adds the open faucet
 *      on top, which picks the next id itself so callers never collide. `disableMinting()` turns
 *      the faucet off too, because the internal `_mint` checks the same `isMintable` flag.
 *
 *      Every faucet mint passes `force: true` — a false would reject exactly the addresses that
 *      hold test funds: plain EOAs, and Universal Profiles with no LSP1 delegate wired up.
 *
 *      The owner — who also holds the `MINTER_ROLE` — is an explicit argument rather than
 *      `msg.sender`, so a deploy through the CREATE2 factory (tests/deploy.html) does not hand
 *      the collection to the factory.
 *
 *      Not for production use — no supply cap, no cooldown, and the faucet is open to anyone.
 * @custom:version 1.0.0
 * @custom:chain testnet-only
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 🧪
 */
contract HupTestLSP8 is LSP8Mintable {
  // --- STATE VARIABLES ---

  /// @notice Tokens dispensed per faucet call
  uint256 public constant FAUCET_DRIP = 1;

  /// @notice Highest sequential id handed out so far; the next faucet id starts from here + 1
  uint256 public lastTokenId;

  // --- EVENTS ---

  /// @notice Emitted when the faucet dispenses a token
  event FaucetDripped(address indexed to, bytes32 indexed tokenId);

  // --- CONSTRUCTOR ---

  /// @param name_ Collection name, written to LSP4 metadata (e.g. "Hup Test LSP8")
  /// @param symbol_ Collection symbol, written to LSP4 metadata (e.g. "tLSP8") — this is what
  ///        the app reads back through ERC725Y `getData(LSP4TokenSymbol)`
  /// @param owner_ Owner and minter — never a factory address
  constructor(
    string memory name_,
    string memory symbol_,
    address owner_
  ) LSP8Mintable(name_, symbol_, owner_, _LSP4_TOKEN_TYPE_COLLECTION, _LSP8_TOKENID_FORMAT_NUMBER) {}

  // --- MUTATIVE LOGIC ---

  /// @notice Mints the next sequential token to the caller — open to anyone, unlimited, for testing
  /// @return tokenId The id that was minted, as the bytes32 LSP8 uses
  function faucet() external returns (bytes32 tokenId) {
    tokenId = _nextTokenId();
    _mint(msg.sender, tokenId, true, "");
    emit FaucetDripped(msg.sender, tokenId);
  }

  /// @notice Mints the next sequential token to any address — minter role only. Unlike the
  ///         inherited `mint`, the id is chosen here so it can never collide with the faucet.
  /// @param to Recipient of the minted token
  /// @return tokenId The id that was minted
  function mintNext(address to) external onlyRole(MINTER_ROLE) returns (bytes32 tokenId) {
    tokenId = _nextTokenId();
    _mint(to, tokenId, true, "");
  }

  // --- INTERNAL LOGIC ---

  /// @dev Reserves and returns the next free sequential id. The inherited `mint` lets a minter
  ///      pick any id, so the counter skips over ids already taken that way rather than letting
  ///      the faucet revert with LSP8TokenIdAlreadyMinted on a number someone minted by hand.
  function _nextTokenId() private returns (bytes32 tokenId) {
    uint256 next = lastTokenId;
    do {
      unchecked {
        next += 1;
      }
      tokenId = bytes32(next);
    } while (_exists(tokenId));
    lastTokenId = next;
  }
}
