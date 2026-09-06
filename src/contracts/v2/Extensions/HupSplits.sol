// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IHupSplits } from "./IHupSplits.sol";
import { HupSplitter } from "./HupSplitter.sol";

/**
 * @title Hup Splits
 * @author Hup Labs
 * @notice The factory every Hup split is born from — one address per chain. Hand it a table of
 *         payees and shares and it returns the address that divides everything it receives that
 *         way, deploying it the first time and returning the same address every time after.
 * @dev CREATE2 with the table inside the initcode, which buys three things: `predict` answers
 *      before anything is deployed, so a caller can name a split as a royalty receiver in the
 *      same transaction that creates it; the address is a commitment to the shares behind it,
 *      verifiable by anyone recomputing it; and value sent to a split that was never materialized
 *      waits at the address until someone deploys it. Two creators asking for identical tables
 *      share one split, which is safe — a split has no owner and no memory of who funded it.
 *      Deliberately admin-free, fee-free, and immutable: a factory that could be paused is a
 *      factory that could strand a collaborator's royalties.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupSplits is IHupSplits {
  // --- STATE VARIABLES ---

  /// @notice Whether this factory deployed an address.
  mapping(address => bool) public isSplit;

  /// @notice Splits deployed so far.
  uint256 public splitCount;

  // --- LOGIC ---

  /**
   * @notice Deploys the split for `_payees`, or returns the one already at that address.
   * @dev Validation lives in HupSplitter's constructor, so a split deployed straight from its
   *      own creation code obeys the same rules as one made here.
   */
  function create(Payee[] calldata _payees) external returns (address split) {
    split = predict(_payees);

    if (split.code.length != 0) return split;

    split = address(new HupSplitter{salt: _salt(_payees)}(_payees));

    isSplit[split] = true;
    splitCount++;

    emit SplitCreated(split, msg.sender, _payees);
  }

  // --- VIEW FUNCTIONS ---

  function version() external pure returns (string memory) {
    return "1.0.0";
  }

  /**
   * @notice The address `_payees` splits to, whether or not it has been deployed.
   * @dev Answers for tables this factory would refuse to deploy too — an invalid table simply
   *      names an address that can never exist.
   */
  function predict(Payee[] calldata _payees) public view returns (address split) {
    bytes32 initCodeHash = keccak256(abi.encodePacked(type(HupSplitter).creationCode, abi.encode(_payees)));
    bytes32 digest = keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(_payees), initCodeHash));

    return address(uint160(uint256(digest)));
  }

  // --- INTERNAL FUNCTIONS ---

  /// @dev The table is its own salt, so the same shares always resolve to the same split.
  function _salt(Payee[] calldata _payees) private pure returns (bytes32) {
    return keccak256(abi.encode(_payees));
  }
}
