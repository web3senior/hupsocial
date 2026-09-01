// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IHupDropsDeployer } from "./IHupDrops.sol";
import { HupDropCollection721 } from "./HupDropCollection721.sol";

/**
 * @title Hup Drops Deployer (ERC721)
 * @author Hup Labs
 * @notice The satellite holding HupDropCollection721's creation code. Registered in the
 *         HupDrops engine as standard id 1 on non-LUKSO chains; the engine calls `deploy` when
 *         a creator launches a numbered ERC721 drop.
 * @dev Exists so the engine stays under the EIP-170 size limit and future standards bolt on
 *      without an engine redeploy. Deliberately stateless and admin-free: it does exactly one
 *      thing for exactly one caller.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupDropsDeployer721 is IHupDropsDeployer {
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
   * @notice Deploys a HupDropCollection721 owned by `_creator`, minted only by the engine.
   * @param _params abi.encode(string name, string symbol, string baseURI, string uriSuffix,
   *        string contractURI, address royaltyReceiver, uint96 royaltyBps, bool burnable)
   */
  function deploy(address _creator, uint256 _maxSupply, bytes calldata _params) external returns (address collection) {
    if (msg.sender != drops) revert OnlyDrops();

    (
      string memory name,
      string memory symbol,
      string memory baseURI,
      string memory uriSuffix,
      string memory contractURI,
      address royaltyReceiver,
      uint96 royaltyBps,
      bool burnable
    ) = abi.decode(_params, (string, string, string, string, string, address, uint96, bool));

    collection = address(new HupDropCollection721(drops, _creator, _maxSupply, name, symbol, baseURI, uriSuffix, contractURI, royaltyReceiver, royaltyBps, burnable));
  }
}
