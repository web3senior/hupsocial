// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title ILSP7Asset
 * @author Hup Labs
 * @notice Minimal interface for selling an LSP7 Digital Asset (LUKSO's balance-based token
 *         standard) as merchandise rather than as payment. Used by HupEditions to read the
 *         seller's balance and operator allowance, and to move editions at sale time. The seller
 *         must first call `authorizeOperator(editions, amount, "")` on the collection.
 * @dev Deliberately separate from ILSP7Minimal, which declares only `transfer` and is imported by
 *      five already-deployed contracts (HupBazaar, HupCommunity, HupPredict, HupTipper, HupTrade).
 *      Extending that file would change their compiled metadata hash, and Solidity appends that
 *      hash to deployed bytecode — so all five would stop reverifying byte-exact against the code
 *      live on nine chains. A second interface costs nothing and leaves them untouched.
 * @custom:website https://hup.social
 */
interface ILSP7Asset {
    function decimals() external view returns (uint8);

    function balanceOf(address tokenOwner) external view returns (uint256);

    function authorizedAmountFor(address operator, address tokenOwner) external view returns (uint256);

    function transfer(address from, address to, uint256 amount, bool force, bytes calldata data) external;
}
