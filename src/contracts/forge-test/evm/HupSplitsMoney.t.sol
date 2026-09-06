// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./Fixture.sol";
import { IHupDrops } from "../../v2/Extensions/IHupDrops.sol";
import { IHupSplits } from "../../v2/Extensions/IHupSplits.sol";
import { HupSplitter } from "../../v2/Extensions/HupSplitter.sol";

/// @dev ERC20 that reverts on transfers to a blocked address — a USDC-style blocklist.
contract BlockingERC20 {
  mapping(address => uint256) public balanceOf;
  mapping(address => bool) public blocked;

  function mint(address to, uint256 amount) external {
    balanceOf[to] += amount;
  }

  function setBlocked(address who, bool value) external {
    blocked[who] = value;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    require(!blocked[to], "blocked");
    balanceOf[msg.sender] -= amount;
    balanceOf[to] += amount;
    return true;
  }
}

/// @dev ERC20 that answers false instead of reverting when it refuses a recipient.
contract FalseERC20 {
  mapping(address => uint256) public balanceOf;
  mapping(address => bool) public refused;

  function mint(address to, uint256 amount) external {
    balanceOf[to] += amount;
  }

  function setRefused(address who, bool value) external {
    refused[who] = value;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    if (refused[to]) return false;
    balanceOf[msg.sender] -= amount;
    balanceOf[to] += amount;
    return true;
  }
}

/// @dev End-to-end money paths: engine fee and referral cuts landing in a split, token
///      settlement into and out of a split, payee-specific token refusals, and the stipend send.
contract HupSplitsMoneyTest is DropsFixture {
  address internal alice = address(0xA11CE);
  address internal bob = address(0xB0B);

  function _splitsInput(
    address destination,
    IHupSplits.Payee[] memory payout,
    IHupSplits.Payee[] memory royalty
  ) internal pure returns (IHupDrops.SplitsInput memory s) {
    s.payoutDestination = destination;
    s.payout = payout;
    s.royalty = royalty;
  }

  function _createSplitDrop(IHupDrops.PhaseInput memory phase, uint256 referralBps, IHupSplits.Payee[] memory payout) internal returns (uint256 dropId, address split) {
    split = splits.predict(payout);
    vm.prank(creator);
    (dropId, ) = engine.createDrop(address(0), STANDARD_721, _params721(), 100, referralBps, false, _one(phase), _splitsInput(address(0), payout, new IHupSplits.Payee[](0)));
  }

  function test_nativeMint_feeAndReferralComeOffBeforeTheSplit() external {
    vm.prank(admin);
    engine.setMintFeeBps(250); // 2.5%

    (uint256 dropId, address split) = _createSplitDrop(_openPhase(1 ether), 1_000, _payees2(alice, 7_000, bob, 3_000));

    vm.prank(minter);
    engine.mint{ value: 2 ether }(address(0), dropId, 0, 2, referrer);

    // 2 ether: fee 0.05, referral 0.2, split 1.75
    assertEq(address(engine).balance, 0.05 ether, "platform fee stays in the engine");
    assertEq(referrer.balance, 0.2 ether, "referral paid directly");
    assertEq(split.balance, 1.75 ether, "creator share landed in the split");

    HupSplitter(payable(split)).distribute();

    assertEq(alice.balance, 1.225 ether, "alice 70% of 1.75");
    assertEq(bob.balance, 0.525 ether, "bob 30% of 1.75");
    assertEq(split.balance, 0, "drained");
  }

  function test_erc20Mint_feeAndReferralThenSplitDistributes() external {
    MockERC20 token = new MockERC20();
    token.mint(minter, 100 ether);

    IHupDrops.PhaseInput memory p = _openPhase(1 ether);
    p.token = address(token);
    (uint256 dropId, address split) = _createSplitDrop(p, 1_000, _payees2(alice, 6_000, bob, 4_000));

    vm.prank(admin);
    engine.setMintFeeBps(500); // 5%

    vm.prank(minter);
    token.approve(address(engine), 100 ether);
    vm.prank(minter);
    engine.mint(address(0), dropId, 0, 4, referrer);

    // 4 ether: fee 0.2, referral 0.4, split 3.4 — pulled straight from the minter
    assertEq(token.balanceOf(address(engine)), 0.2 ether, "token fee held by engine");
    assertEq(token.balanceOf(referrer), 0.4 ether, "token referral");
    assertEq(token.balanceOf(split), 3.4 ether, "split holds the creator share");
    assertEq(token.balanceOf(minter), 96 ether, "minter debited once");

    HupSplitter s = HupSplitter(payable(split));
    assertEq(s.releasableToken(address(token), alice), 2.04 ether, "alice owed 60%");

    s.distributeToken(address(token), false);

    assertEq(token.balanceOf(alice), 2.04 ether, "alice 60% of 3.4");
    assertEq(token.balanceOf(bob), 1.36 ether, "bob 40% of 3.4");
    assertEq(token.balanceOf(split), 0, "drained");
    assertEq(s.releasableToken(address(token), alice), 0, "nothing left");
  }

  function test_lsp7Mint_flowsIntoSplitAndOut() external {
    MockLSP7Pay token = new MockLSP7Pay();
    token.mint(minter, 10 ether);

    IHupDrops.PhaseInput memory p = _openPhase(1 ether);
    p.token = address(token);
    p.isLsp7 = true;
    (uint256 dropId, address split) = _createSplitDrop(p, 0, _payees2(alice, 5_000, bob, 5_000));

    vm.prank(minter);
    token.authorizeOperator(address(engine), 10 ether);
    vm.prank(minter);
    engine.mint(address(0), dropId, 0, 2, address(0));

    assertEq(token.balanceOf(split), 2 ether, "split holds the LSP7");

    HupSplitter(payable(split)).distributeToken(address(token), true);

    assertEq(token.balanceOf(alice), 1 ether, "alice half");
    assertEq(token.balanceOf(bob), 1 ether, "bob half");
  }

  function test_royaltyAndPayoutOnOneTable_deploysOneSplit() external {
    IHupSplits.Payee[] memory table = _payees2(alice, 8_000, bob, 2_000);
    address predicted = splits.predict(table);

    vm.prank(creator);
    (uint256 dropId, address collection) = engine.createDrop(address(0), STANDARD_721, _params721With(predicted, 500), 100, 0, false, _one(_openPhase(1 ether)), _splitsInput(address(0), table, table));

    assertEq(splits.splitCount(), 1, "the same table is one split, created once");
    assertEq(engine.payoutDestination(dropId), predicted, "mint money goes to it");
    (address receiver, ) = HupDropCollection721(collection).royaltyInfo(1, 1 ether);
    assertEq(receiver, predicted, "resale royalties go to it");

    // Primary mint and a marketplace-style royalty payment both accrue in the same place
    _mintAs(minter, dropId, 0, 1, 1 ether);
    (bool paid, ) = predicted.call{ value: 0.05 ether }("");
    assertTrue(paid, "royalty accepted");

    HupSplitter(payable(predicted)).distribute();

    assertEq(alice.balance, 0.84 ether, "alice 80% of 1.05");
    assertEq(bob.balance, 0.21 ether, "bob 20% of 1.05");
  }

  function test_distributeToken_skipsPayeeTheTokenRefusesUntilItStops() external {
    BlockingERC20 token = new BlockingERC20();
    token.setBlocked(alice, true);

    HupSplitter s = HupSplitter(payable(splits.create(_payees2(alice, 3_000, bob, 7_000))));
    token.mint(address(s), 100 ether);

    uint256 total = s.distributeToken(address(token), false);

    assertEq(total, 70 ether, "only the accepted share moved");
    assertEq(token.balanceOf(bob), 70 ether, "bob paid in full");
    assertEq(token.balanceOf(alice), 0, "alice refused by the token");
    assertEq(token.balanceOf(address(s)), 30 ether, "her share still held");
    assertEq(s.releasableToken(address(token), alice), 30 ether, "and still owed");

    vm.expectRevert(HupSplitter.TransferFailed.selector);
    s.releaseToken(address(token), false, alice);

    token.setBlocked(alice, false);
    uint256 released = s.releaseToken(address(token), false, alice);

    assertEq(released, 30 ether, "released once unblocked");
    assertEq(token.balanceOf(alice), 30 ether, "alice paid");
    assertEq(token.balanceOf(address(s)), 0, "drained");
  }

  function test_distributeToken_treatsFalseReturnAsFailure() external {
    FalseERC20 token = new FalseERC20();
    token.setRefused(alice, true);

    HupSplitter s = HupSplitter(payable(splits.create(_payees2(alice, 5_000, bob, 5_000))));
    token.mint(address(s), 10 ether);

    s.distributeToken(address(token), false);

    assertEq(token.balanceOf(bob), 5 ether, "bob paid");
    assertEq(token.balanceOf(alice), 0, "alice not paid");
    assertEq(s.releasableToken(address(token), alice), 5 ether, "a false return is not a payout");

    vm.expectRevert(HupSplitter.TransferFailed.selector);
    s.releaseToken(address(token), false, alice);
  }

  function test_receive_acceptsA2300GasStipend() external {
    HupSplitter s = HupSplitter(payable(splits.create(_payees2(alice, 7_000, bob, 3_000))));

    // What a marketplace using transfer() gives a royalty receiver
    payable(address(s)).transfer(1 ether);

    assertEq(address(s).balance, 1 ether, "accepted under the stipend");

    s.distribute();

    assertEq(alice.balance, 0.7 ether, "alice");
    assertEq(bob.balance, 0.3 ether, "bob");
  }

  function test_distribute_twentyPayeesAtTheCap() external {
    IHupSplits.Payee[] memory table = new IHupSplits.Payee[](20);
    for (uint256 i = 0; i < 20; i++) {
      table[i] = IHupSplits.Payee({ account: address(uint160(0x60000 + i)), shareBps: 500 });
    }

    HupSplitter s = HupSplitter(payable(splits.create(table)));
    (bool sent, ) = address(s).call{ value: 20 ether }("");
    assertTrue(sent, "funded");

    uint256 total = s.distribute();

    assertEq(total, 20 ether, "everything moved");
    for (uint256 i = 0; i < 20; i++) {
      assertEq(address(uint160(0x60000 + i)).balance, 1 ether, "each payee one share");
    }
  }
}
