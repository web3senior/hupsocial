// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title ILSP7Minimal
 * @author Hup Labs
 * @notice Minimal interface for LSP7 Digital Asset transfers (LUKSO token standard), used by
 *         HupBazaar to pull operator-authorized payments. The buyer must first call
 *         `authorizeOperator(bazaar, amount, data)` on the token.
 * @custom:website https://hup.social
 */
interface ILSP7Minimal {
    function transfer(address from, address to, uint256 amount, bool force, bytes calldata data) external;
}
