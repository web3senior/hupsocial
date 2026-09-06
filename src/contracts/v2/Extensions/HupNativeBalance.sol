// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title Hup Native Balance
 * @author Hup Labs
 * @notice The chain's native coin, answered through the `balanceOf` every Hup gate speaks. A drop
 *         phase gated on this address admits wallets holding at least the phase minimum of the
 *         coin itself — no wrapping, and no change to the engine, which reads it like any asset.
 * @dev Stateless and ownerless. `decimals` is 18 so a minimum typed in whole coins scales the
 *      same way it does for an ERC20. No constructor arguments, so CREATE2 with one salt puts it
 *      at the same address on every chain. The balance read is the one left AFTER the mint's
 *      `msg.value` has moved, so a paid phase gated here sees the wallet minus the price it is
 *      paying — a minimum meant as "holds at least X" should allow for that.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupNativeBalance {
  // --- VIEW FUNCTIONS ---

  function balanceOf(address account) external view returns (uint256) {
    return account.balance;
  }

  function decimals() external pure returns (uint8) {
    return 18;
  }

  function name() external pure returns (string memory) {
    return "Native coin balance";
  }

  function symbol() external pure returns (string memory) {
    return "NATIVE";
  }

  function version() external pure returns (string memory) {
    return "1.0.0";
  }
}
