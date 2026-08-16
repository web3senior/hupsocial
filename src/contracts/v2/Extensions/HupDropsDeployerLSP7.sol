// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IHupDropsDeployer } from "./IHupDrops.sol";
import { HupDropCollectionLSP7 } from "./HupDropCollectionLSP7.sol";

/**
 * @title Hup Drops Deployer (LSP7)
 * @author Hup Labs
 * @notice The satellite holding HupDropCollectionLSP7's creation code. Registered in the
 *         HupDrops engine as standard id 3 on LUKSO; the engine calls `deploy` when a creator
 *         launches an LSP7 edition drop.
 * @dev Exists so the engine stays under the EIP-170 size limit and future standards bolt on
 *      without an engine redeploy. Deliberately stateless and admin-free: it does exactly one
 *      thing for exactly one caller.
 * @custom:version 1.0.0
 * @custom:chain lukso
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupDropsDeployerLSP7 is IHupDropsDeployer {
  // --- STATE VARIABLES ---

  /// @notice The HupDrops engine — the only address allowed to deploy through this satellite.
  address public immutable drops;

  // --- ERRORS ---

  error OnlyDrops();
  error InvalidAddress();

  // --- CONSTRUCTOR ---

  constructor(address drops_) {
    if (drops_ == address(0)) revert InvalidAddress();

    drops = drops_;
  }

  // --- LOGIC ---

  /**
   * @notice Deploys a HupDropCollectionLSP7 owned by `_creator`, minted only by the engine.
   * @param _params abi.encode(string name, string symbol, bytes lsp4MetadataValue,
   *        address royaltyReceiver, uint96 royaltyBps)
   */
  function deploy(address _creator, uint256 _maxSupply, bytes calldata _params) external returns (address collection) {
    if (msg.sender != drops) revert OnlyDrops();

    (
      string memory name,
      string memory symbol,
      bytes memory lsp4MetadataValue,
      address royaltyReceiver,
      uint96 royaltyBps
    ) = abi.decode(_params, (string, string, bytes, address, uint96));

    collection = address(new HupDropCollectionLSP7(drops, _creator, _maxSupply, name, symbol, lsp4MetadataValue, royaltyReceiver, royaltyBps));
  }
}
