// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IHupDropsDeployer } from "./IHupDrops.sol";
import { HupDropCollection1155 } from "./HupDropCollection1155.sol";

/**
 * @title Hup Drops Deployer (ERC1155)
 * @author Hup Labs
 * @notice The satellite holding HupDropCollection1155's creation code. Registered in the
 *         HupDrops engine as standard id 2 on non-LUKSO chains; the engine calls `deploy` when
 *         a creator launches an ERC1155 edition drop.
 * @dev Exists so the engine stays under the EIP-170 size limit and future standards bolt on
 *      without an engine redeploy. Deliberately stateless and admin-free: it does exactly one
 *      thing for exactly one caller.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupDropsDeployer1155 is IHupDropsDeployer {
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
   * @notice Deploys a HupDropCollection1155 owned by `_creator`, minted only by the engine.
   * @param _params abi.encode(string name, string symbol, string tokenURI, string contractURI,
   *        address royaltyReceiver, uint96 royaltyBps, bool burnable)
   */
  function deploy(address _creator, uint256 _maxSupply, bytes calldata _params) external returns (address collection) {
    if (msg.sender != drops) revert OnlyDrops();

    (
      string memory name,
      string memory symbol,
      string memory tokenURI,
      string memory contractURI,
      address royaltyReceiver,
      uint96 royaltyBps,
      bool burnable
    ) = abi.decode(_params, (string, string, string, string, address, uint96, bool));

    collection = address(new HupDropCollection1155(drops, _creator, _maxSupply, name, symbol, tokenURI, contractURI, royaltyReceiver, royaltyBps, burnable));
  }
}
