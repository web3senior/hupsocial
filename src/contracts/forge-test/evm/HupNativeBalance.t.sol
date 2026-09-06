// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./Fixture.sol";
import { IHupDrops } from "../../v2/Extensions/IHupDrops.sol";
import { HupNativeBalance } from "../../v2/Extensions/HupNativeBalance.sol";

/// @dev The native-coin gate adapter, alone and in front of a real drop phase.
contract HupNativeBalanceTest is DropsFixture {
  HupNativeBalance internal native;

  function setUp() public override {
    super.setUp();
    native = new HupNativeBalance();
  }

  function test_answersTheAccountBalance() external {
    address rich = address(0x51C4);
    vm.deal(rich, 3 ether);

    assertEq(native.balanceOf(rich), 3 ether, "balance");
    assertEq(native.balanceOf(address(0xE3374)), 0, "empty wallet");
    assertEq(native.decimals(), 18, "decimals");
    assertEq(native.version(), "1.0.0", "version");
  }

  function test_gatesAPhaseOnNativeHoldings() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.gate = IHupDrops.GateType.AssetHolders;
    p.gateAsset = address(native);
    p.gateMin = 1 ether;
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    address poor = address(0x900);
    vm.deal(poor, 0.5 ether);
    assertFalse(engine.isMintable(dropId, 0, poor, 1), "half a coin is not enough");

    vm.prank(poor);
    vm.expectRevert(IHupDrops.GateNotPassed.selector);
    engine.mint(address(0), dropId, 0, 1, address(0));

    // The fixture funds `minter` with 1,000 ether, so it clears the bar
    assertTrue(engine.isMintable(dropId, 0, minter, 1), "a whole coin qualifies");
    _mintAs(minter, dropId, 0, 1, 0);
    assertEq(engine.getDrop(dropId).minted, 1, "minted through the native gate");

    // A paid phase spends the coin it is gated on, and the gate reads the balance AFTER the
    // price has left the wallet: 1,000 minus 1 is 999, so a bar of 999.5 shuts the door
    IHupDrops.PhaseInput memory paid = _openPhase(1 ether);
    paid.gate = IHupDrops.GateType.AssetHolders;
    paid.gateAsset = address(native);
    paid.gateMin = 999.5 ether;
    vm.prank(creator);
    engine.addPhase(dropId, paid);

    vm.prank(minter);
    vm.expectRevert(IHupDrops.GateNotPassed.selector);
    engine.mint{ value: 1 ether }(address(0), dropId, 1, 1, address(0));

    // A bar that leaves room for the price is what "holds at least X" means for a paid phase
    IHupDrops.PhaseInput memory roomy = _openPhase(1 ether);
    roomy.gate = IHupDrops.GateType.AssetHolders;
    roomy.gateAsset = address(native);
    roomy.gateMin = 998.5 ether;
    vm.prank(creator);
    engine.addPhase(dropId, roomy);

    _mintAs(minter, dropId, 2, 1, 1 ether);
    assertEq(engine.getDrop(dropId).minted, 2, "paid native-gated mint");
  }
}
