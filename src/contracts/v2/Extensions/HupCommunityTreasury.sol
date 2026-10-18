// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ILSP7Minimal.sol";

/// @notice A community's vault. Only its governance contract can release funds.
contract HupCommunityTreasury {
  using SafeERC20 for IERC20;

  // --- Storage ---

  address public immutable governance;
  uint256 public immutable communityId;

  // --- Events ---

  event NativeDeposited(address indexed sender, uint256 amount);
  event PaymentSent(address indexed asset, address indexed recipient, uint256 amount, bool isLsp7);

  // --- Modifiers ---

  modifier onlyGovernance() {
    require(msg.sender == governance, "Only governance");
    _;
  }

  // --- Logic ---

  constructor(uint256 id) {
    governance = msg.sender;
    communityId = id;
  }

  receive() external payable {
    emit NativeDeposited(msg.sender, msg.value);
  }

  function pay(address asset, address recipient, uint256 amount, bool isLsp7) external onlyGovernance {
    if (asset == address(0)) {
      (bool success, ) = recipient.call{value: amount}("");
      require(success, "Native payment failed");
    } else if (isLsp7) {
      ILSP7Minimal(asset).transfer(address(this), recipient, amount, true, "");
    } else {
      IERC20(asset).safeTransfer(recipient, amount);
    }
    emit PaymentSent(asset, recipient, amount, isLsp7);
  }
}
