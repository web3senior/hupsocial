// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title IHupSplits
 * @author Hup Labs
 * @notice Shared types, events, errors, and view signatures for the Hup Splits factory and the
 *         HupSplitter contracts it deploys.
 * @dev A split is addressed by its own table: the factory deploys through CREATE2 with the
 *      payee list in the initcode, so `predict` answers for a split that does not exist yet and
 *      the address itself proves the shares behind it. Anything that can hold value — a drop's
 *      payout destination, an ERC2981 royalty receiver, a community's fee destination — takes a
 *      split address without knowing anything about splits.
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 */
interface IHupSplits {
  // --- STRUCTS ---

  /**
   * @notice One share of a split.
   * @dev Packed into a single slot: 20 bytes of address next to 2 of basis points.
   */
  struct Payee {
    address account;
    uint16 shareBps;
  }

  // --- EVENTS ---

  /// @notice A split's table, published once at deployment — the only place it is ever written.
  event SplitCreated(address indexed split, address indexed by, Payee[] payees);

  // --- ERRORS ---

  error InvalidAddress();
  error InvalidPayees();
  error InvalidShares(uint256 total);
  error DuplicatePayee(address account);

  // --- VIEW FUNCTIONS ---

  function version() external pure returns (string memory);

  /// @notice Whether this factory deployed `_split`.
  function isSplit(address _split) external view returns (bool);

  /// @notice Total splits this factory has deployed.
  function splitCount() external view returns (uint256);

  /**
   * @notice The address `_payees` splits to, deployed or not. Value sent to it before it exists
   *         is held at the address and is spendable the moment `create` materializes it.
   */
  function predict(Payee[] calldata _payees) external view returns (address split);

  // --- LOGIC ---

  /**
   * @notice Deploys the split for `_payees`, or returns the existing one — the same table always
   *         resolves to the same address, so calling twice costs one deployment.
   */
  function create(Payee[] calldata _payees) external returns (address split);
}
