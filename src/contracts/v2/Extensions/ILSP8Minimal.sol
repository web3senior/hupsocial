// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title ILSP8Minimal
 * @author Hup Labs
 * @notice Minimal interface for LSP8 Identifiable Digital Asset (LUKSO NFT standard), used by
 *         HupTrade to verify ownership/operator status and move a sold token. The seller must
 *         first call `authorizeOperator(trade, tokenId, data)` on the collection.
 * @custom:website https://hup.social
 */
interface ILSP8Minimal {
    function tokenOwnerOf(bytes32 tokenId) external view returns (address);

    function isOperatorFor(address operator, bytes32 tokenId) external view returns (bool);

    function transfer(address from, address to, bytes32 tokenId, bool force, bytes calldata data) external;
}
