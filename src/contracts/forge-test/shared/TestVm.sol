// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal forge cheatcode surface + assertions, vendored so the suite needs no forge-std
///      checkout (this box cannot reach GitHub over git protocols).
interface Vm {
  function prank(address sender) external;
  function startPrank(address sender) external;
  function stopPrank() external;
  function deal(address who, uint256 amount) external;
  function warp(uint256 timestamp) external;
  function expectRevert() external;
  function expectRevert(bytes4 selector) external;
  function expectRevert(bytes calldata data) external;
  function expectEmit(bool topic1, bool topic2, bool topic3, bool data) external;
  function label(address addr, string calldata name) external;
}

abstract contract TestBase {
  Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

  function assertTrue(bool ok, string memory why) internal pure {
    require(ok, why);
  }

  function assertFalse(bool ok, string memory why) internal pure {
    require(!ok, why);
  }

  function assertEq(uint256 a, uint256 b, string memory why) internal pure {
    require(a == b, why);
  }

  function assertEq(address a, address b, string memory why) internal pure {
    require(a == b, why);
  }

  function assertEq(bytes32 a, bytes32 b, string memory why) internal pure {
    require(a == b, why);
  }

  function assertEq(bool a, bool b, string memory why) internal pure {
    require(a == b, why);
  }

  function assertEq(string memory a, string memory b, string memory why) internal pure {
    require(keccak256(bytes(a)) == keccak256(bytes(b)), why);
  }

  function assertEq(bytes memory a, bytes memory b, string memory why) internal pure {
    require(keccak256(a) == keccak256(b), why);
  }
}
