// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title Hup Batch Transfer
 * @author Hup Labs
 * @notice Sends many ERC721 tokens in one transaction — an airdrop to a list of holders, or a
 *         whole collection moved to a new wallet. ERC721 has no batch transfer of its own, so
 *         without this every token is a separate signature.
 * @dev Works on ANY ERC721, not only collections minted here. That is the point: most of what
 *      someone wants to move was bought elsewhere, and a batch function added to our own
 *      collections would do nothing for those — nor for the collections already deployed, which
 *      are deliberately not upgradeable.
 *
 *      The helper never owns a token. Every transfer goes straight from the sender to the
 *      recipient, so there is no state here for a token to be stranded in and nothing to rescue.
 *      The sender approves this contract on the collection first (`setApprovalForAll`), which is
 *      the one real cost of the design and worth being upfront about with the user.
 *
 *      There is no owner, no pause and no admin function of any kind. A contract that moves other
 *      people's NFTs on their approval should not also have a privileged caller, so it has none —
 *      the only thing it can ever do is what its caller already had permission to do themselves.
 *
 *      `safeTransferFrom`, not `transferFrom`: a recipient contract that cannot receive an NFT
 *      reverts the batch instead of swallowing the token forever. One failed airdrop beats one
 *      lost token, and the sender can drop that address and retry.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 📦
 */
interface IERC721Minimal {
  function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

contract HupBatchTransfer {
  // --- STATE VARIABLES ---

  /**
   * @notice Most tokens one call will move. Block gas is the real ceiling; this turns hitting it
   *         into a clear revert rather than an out-of-gas the sender pays for and learns nothing from.
   */
  uint256 public constant MAX_BATCH = 200;

  // --- EVENTS ---

  /// @notice One batch moved. The ids are not logged — the collection's own Transfer events carry them.
  event BatchTransferred(address indexed collection, address indexed from, uint256 count);

  // --- ERRORS ---

  error EmptyBatch();
  error BatchTooLarge(uint256 requested, uint256 maximum);
  error LengthMismatch(uint256 recipients, uint256 ids);
  error InvalidCollection();

  // --- LOGIC ---

  /**
   * @notice Sends each token to its own recipient — the airdrop shape.
   * @dev Pairs by index: `_ids[i]` goes to `_to[i]`. Approve this contract on the collection first.
   * @param _collection The ERC721 to move tokens on.
   * @param _to One recipient per token, in the same order as `_ids`.
   * @param _ids The token ids to send.
   */
  function batchTransfer(address _collection, address[] calldata _to, uint256[] calldata _ids) external {
    if (_collection == address(0)) revert InvalidCollection();
    if (_to.length != _ids.length) revert LengthMismatch(_to.length, _ids.length);
    _guardSize(_ids.length);

    for (uint256 i = 0; i < _ids.length; i++) {
      IERC721Minimal(_collection).safeTransferFrom(msg.sender, _to[i], _ids[i]);
    }

    emit BatchTransferred(_collection, msg.sender, _ids.length);
  }

  /**
   * @notice Sends every token to the same recipient — moving a collection to another wallet.
   * @dev The separate entry point is not sugar: the airdrop form would need the recipient repeated
   *      once per id, and calldata is the expensive part of a batch this size.
   * @param _collection The ERC721 to move tokens on.
   * @param _to The single recipient.
   * @param _ids The token ids to send.
   */
  function batchTransferTo(address _collection, address _to, uint256[] calldata _ids) external {
    if (_collection == address(0)) revert InvalidCollection();
    _guardSize(_ids.length);

    for (uint256 i = 0; i < _ids.length; i++) {
      IERC721Minimal(_collection).safeTransferFrom(msg.sender, _to, _ids[i]);
    }

    emit BatchTransferred(_collection, msg.sender, _ids.length);
  }

  // --- INTERNAL HELPERS ---

  function _guardSize(uint256 _count) private pure {
    if (_count == 0) revert EmptyBatch();
    if (_count > MAX_BATCH) revert BatchTooLarge(_count, MAX_BATCH);
  }
}
