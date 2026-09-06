// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./Fixture.sol";
import { HupDrops } from "../../v2/Extensions/HupDrops.sol";
import { IHupDrops } from "../../v2/Extensions/IHupDrops.sol";
import { IHupSplits } from "../../v2/Extensions/IHupSplits.sol";
import { HupSplits } from "../../v2/Extensions/HupSplits.sol";
import { HupSplitter } from "../../v2/Extensions/HupSplitter.sol";

/// @dev A payee that tries to re-enter the split while being paid.
contract ReentrantPayee {
  HupSplitter public split;
  bool public reentered;

  function arm(address split_) external {
    split = HupSplitter(payable(split_));
  }

  receive() external payable {
    try split.distribute() {
      reentered = true;
    } catch {}
  }
}

contract HupSplitsFactoryTest is DropsFixture {
  address internal alice = address(0xA11CE);
  address internal bob = address(0xB0B);
  address internal carol = address(0xCA401);

  function test_create_deploysAtPredictedAddress() external {
    IHupSplits.Payee[] memory table = _payees2(alice, 7_000, bob, 3_000);

    address predicted = splits.predict(table);
    assertEq(predicted.code.length, 0, "not deployed yet");

    address created = splits.create(table);

    assertEq(created, predicted, "predicted address");
    assertTrue(created.code.length > 0, "deployed");
    assertTrue(splits.isSplit(created), "registered");
    assertEq(splits.splitCount(), 1, "counted");

    HupSplitter s = HupSplitter(payable(created));
    assertEq(s.payeeCount(), 2, "payees");
    assertEq(s.shareBpsOf(alice), 7_000, "alice share");
    assertEq(s.shareBpsOf(bob), 3_000, "bob share");
    assertEq(s.shareBpsOf(carol), 0, "stranger has no share");
  }

  function test_create_isIdempotent() external {
    IHupSplits.Payee[] memory table = _payees2(alice, 5_000, bob, 5_000);

    address first = splits.create(table);
    address second = splits.create(table);

    assertEq(second, first, "same address");
    assertEq(splits.splitCount(), 1, "deployed once");
  }

  function test_create_differentSharesDifferentSplit() external {
    address a = splits.create(_payees2(alice, 5_000, bob, 5_000));
    address b = splits.create(_payees2(alice, 6_000, bob, 4_000));

    assertTrue(a != b, "distinct splits");
    assertEq(splits.splitCount(), 2, "two splits");
  }

  function test_create_sharesMustTotalTenThousand() external {
    vm.expectRevert(abi.encodeWithSelector(HupSplitter.InvalidShares.selector, 9_700));
    splits.create(_payees2(alice, 7_000, bob, 2_700));
  }

  function test_create_rejectsEmptyZeroAndDuplicate() external {
    IHupSplits.Payee[] memory none = new IHupSplits.Payee[](0);
    vm.expectRevert(HupSplitter.InvalidPayees.selector);
    splits.create(none);

    IHupSplits.Payee[] memory zeroAccount = _payees2(address(0), 5_000, bob, 5_000);
    vm.expectRevert(HupSplitter.InvalidAddress.selector);
    splits.create(zeroAccount);

    IHupSplits.Payee[] memory zeroShare = _payees2(alice, 0, bob, 10_000);
    vm.expectRevert(HupSplitter.InvalidPayees.selector);
    splits.create(zeroShare);

    IHupSplits.Payee[] memory duplicate = _payees2(alice, 5_000, alice, 5_000);
    vm.expectRevert(abi.encodeWithSelector(HupSplitter.DuplicatePayee.selector, alice));
    splits.create(duplicate);
  }

  function test_create_rejectsMoreThanMaxPayees() external {
    IHupSplits.Payee[] memory many = new IHupSplits.Payee[](21);
    for (uint256 i = 0; i < 21; i++) {
      many[i] = IHupSplits.Payee({ account: address(uint160(0x50000 + i)), shareBps: uint16(i == 20 ? 10_000 - (20 * 500) : 500) });
    }

    vm.expectRevert(HupSplitter.InvalidPayees.selector);
    splits.create(many);
  }

  /// @dev The whole point of CREATE2: royalties can be paid to a split nobody has deployed yet.
  function test_predict_holdsValueBeforeDeployment() external {
    IHupSplits.Payee[] memory table = _payees2(alice, 7_500, bob, 2_500);
    address predicted = splits.predict(table);

    (bool sent, ) = predicted.call{value: 4 ether}("");
    assertTrue(sent, "counterfactual address accepts value");
    assertEq(predicted.balance, 4 ether, "value waits at the address");

    HupSplitter s = HupSplitter(payable(splits.create(table)));
    s.distribute();

    assertEq(alice.balance, 3 ether, "alice");
    assertEq(bob.balance, 1 ether, "bob");
  }
}

contract HupSplitterTest is DropsFixture {
  address internal alice = address(0xA11CE);
  address internal bob = address(0xB0B);

  HupSplitter internal split;

  function setUp() public override {
    super.setUp();
    split = HupSplitter(payable(splits.create(_payees2(alice, 7_000, bob, 3_000))));
  }

  function test_distribute_splitsNativeByShare() external {
    (bool sent, ) = address(split).call{value: 10 ether}("");
    assertTrue(sent, "funded");

    uint256 total = split.distribute();

    assertEq(total, 10 ether, "distributed");
    assertEq(alice.balance, 7 ether, "alice 70%");
    assertEq(bob.balance, 3 ether, "bob 30%");
    assertEq(address(split).balance, 0, "drained");
  }

  function test_distribute_accruesAcrossManyPayments() external {
    (bool a, ) = address(split).call{value: 1 ether}("");
    split.distribute();
    (bool b, ) = address(split).call{value: 3 ether}("");
    split.distribute();
    assertTrue(a && b, "funded twice");

    assertEq(alice.balance, 2.8 ether, "alice 70% of 4");
    assertEq(bob.balance, 1.2 ether, "bob 30% of 4");
    assertEq(split.totalReleasedNative(), 4 ether, "total released");
  }

  function test_release_pullsOnePayeeOnly() external {
    (bool sent, ) = address(split).call{value: 10 ether}("");
    assertTrue(sent, "funded");

    assertEq(split.releasable(alice), 7 ether, "alice releasable");

    vm.prank(alice);
    uint256 amount = split.release(alice);

    assertEq(amount, 7 ether, "released");
    assertEq(alice.balance, 7 ether, "alice paid");
    assertEq(split.releasable(alice), 0, "nothing left for alice");
    assertEq(split.releasable(bob), 3 ether, "bob untouched");
  }

  function test_release_rejectsStrangerAndEmptyClaim() external {
    vm.expectRevert(abi.encodeWithSelector(HupSplitter.NotAPayee.selector, stranger));
    split.release(stranger);

    vm.expectRevert(HupSplitter.NothingToRelease.selector);
    split.release(alice);
  }

  function test_distribute_skipsPayeeThatCannotReceive() external {
    RejectingReceiver bad = new RejectingReceiver();
    HupSplitter s = HupSplitter(payable(splits.create(_payees2(address(bad), 4_000, bob, 6_000))));

    (bool sent, ) = address(s).call{value: 10 ether}("");
    assertTrue(sent, "funded");

    uint256 total = s.distribute();

    assertEq(total, 6 ether, "only the payable share moved");
    assertEq(bob.balance, 6 ether, "bob paid in full");
    assertEq(s.releasable(address(bad)), 4 ether, "rejected share still owed");
    assertEq(address(s).balance, 4 ether, "and still held");

    vm.expectRevert(HupSplitter.TransferFailed.selector);
    s.release(address(bad));
  }

  function test_distribute_leavesDustAndSettlesItLater() external {
    IHupSplits.Payee[] memory table = new IHupSplits.Payee[](3);
    table[0] = IHupSplits.Payee({ account: alice, shareBps: 3_333 });
    table[1] = IHupSplits.Payee({ account: bob, shareBps: 3_333 });
    table[2] = IHupSplits.Payee({ account: stranger, shareBps: 3_334 });

    HupSplitter s = HupSplitter(payable(splits.create(table)));

    (bool first, ) = address(s).call{value: 10 wei}("");
    s.distribute();
    assertTrue(first, "funded");

    assertEq(address(s).balance, 1 wei, "dust held, not lost");

    (bool second, ) = address(s).call{value: 10 wei}("");
    s.distribute();
    assertTrue(second, "funded again");

    assertEq(s.totalReleasedNative(), 18 wei, "dust rolls into later rounds");
  }

  function test_reentrantPayeeCannotDoubleSpend() external {
    ReentrantPayee greedy = new ReentrantPayee();
    HupSplitter s = HupSplitter(payable(splits.create(_payees2(address(greedy), 5_000, bob, 5_000))));
    greedy.arm(address(s));

    (bool sent, ) = address(s).call{value: 8 ether}("");
    assertTrue(sent, "funded");

    s.distribute();

    assertFalse(greedy.reentered(), "reentrancy blocked");
    assertEq(address(greedy).balance, 4 ether, "paid its share once");
    assertEq(bob.balance, 4 ether, "and bob's is intact");
  }

  function test_distributeToken_splitsErc20() external {
    MockERC20 token = new MockERC20();
    token.mint(address(split), 1_000e18);

    split.distributeToken(address(token), false);

    assertEq(token.balanceOf(alice), 700e18, "alice 70%");
    assertEq(token.balanceOf(bob), 300e18, "bob 30%");

    token.mint(address(split), 100e18);
    assertEq(split.releasableToken(address(token), alice), 70e18, "accrues on top");

    vm.prank(bob);
    split.releaseToken(address(token), false, bob);
    assertEq(token.balanceOf(bob), 330e18, "bob pulled his own");
  }

  function test_distributeToken_splitsLsp7() external {
    MockLSP7Pay token = new MockLSP7Pay();
    token.mint(address(split), 500e18);

    split.distributeToken(address(token), true);

    assertEq(token.balanceOf(alice), 350e18, "alice 70%");
    assertEq(token.balanceOf(bob), 150e18, "bob 30%");
  }

  function test_distributeToken_wrongStandardFlagMovesNothing() external {
    MockERC20 token = new MockERC20();
    token.mint(address(split), 1_000e18);

    split.distributeToken(address(token), true);

    assertEq(token.balanceOf(alice), 0, "nothing moved");
    assertEq(split.releasableToken(address(token), alice), 700e18, "entitlement intact");
  }

  function test_answersLsp1AndVersion() external view {
    assertTrue(split.supportsInterface(0x6bb56a14), "LSP1");
    assertTrue(split.supportsInterface(0x01ffc9a7), "ERC165");
    assertFalse(split.supportsInterface(0xdeadbeef), "unknown");
    assertEq(split.version(), "1.0.0", "version");
  }
}

contract HupDropsSplitsTest is DropsFixture {
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

  function test_createDrop_payoutSplitTakesMintProceeds() external {
    IHupSplits.Payee[] memory table = _payees2(alice, 6_000, bob, 4_000);
    address predicted = splits.predict(table);

    vm.prank(creator);
    (uint256 dropId, ) = engine.createDrop(
      address(0),
      STANDARD_721,
      _params721(),
      100,
      0,
      false,
      _one(_openPhase(1 ether)),
      _splitsInput(address(0), table, new IHupSplits.Payee[](0))
    );

    assertEq(engine.payoutDestination(dropId), predicted, "drop pays the split");

    _mintAs(minter, dropId, 0, 2, 2 ether);

    assertEq(predicted.balance, 2 ether, "proceeds landed in the split");

    HupSplitter(payable(predicted)).distribute();

    assertEq(alice.balance, 1.2 ether, "alice 60%");
    assertEq(bob.balance, 0.8 ether, "bob 40%");
  }

  function test_createDrop_royaltySplitMustMatchCollection() external {
    IHupSplits.Payee[] memory table = _payees2(alice, 5_000, bob, 5_000);
    address predicted = splits.predict(table);

    vm.prank(creator);
    (, address collection) = engine.createDrop(
      address(0),
      STANDARD_721,
      _params721With(predicted, 500),
      100,
      0,
      false,
      _one(_openPhase(0)),
      _splitsInput(address(0), new IHupSplits.Payee[](0), table)
    );

    (address receiver, uint256 amount) = HupDropCollection721(collection).royaltyInfo(1, 100 ether);
    assertEq(receiver, predicted, "resales pay the split");
    assertEq(amount, 5 ether, "5% royalty");
    assertTrue(splits.isSplit(predicted), "split deployed by the same call");
  }

  function test_createDrop_royaltySplitMismatchReverts() external {
    IHupSplits.Payee[] memory table = _payees2(alice, 5_000, bob, 5_000);
    address predicted = splits.predict(table);

    vm.prank(creator);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.SplitMismatch.selector, predicted, creator));
    engine.createDrop(
      address(0),
      STANDARD_721,
      _params721With(creator, 500),
      100,
      0,
      false,
      _one(_openPhase(0)),
      _splitsInput(address(0), new IHupSplits.Payee[](0), table)
    );

    // A royalty split on a collection that pays no royalty at all is the same mistake.
    vm.prank(creator);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.SplitMismatch.selector, predicted, address(0)));
    engine.createDrop(
      address(0),
      STANDARD_721,
      _params721With(address(0), 0),
      100,
      0,
      false,
      _one(_openPhase(0)),
      _splitsInput(address(0), new IHupSplits.Payee[](0), table)
    );
  }

  function test_createDrop_plainDestinationStillWorks() external {
    vm.prank(creator);
    (uint256 dropId, ) = engine.createDrop(
      address(0),
      STANDARD_721,
      _params721(),
      100,
      0,
      false,
      _one(_openPhase(1 ether)),
      _splitsInput(alice, new IHupSplits.Payee[](0), new IHupSplits.Payee[](0))
    );

    assertEq(engine.payoutDestination(dropId), alice, "one wallet, no split");

    _mintAs(minter, dropId, 0, 1, 1 ether);
    assertEq(alice.balance, 1 ether, "paid directly");
  }

  function test_createDrop_withoutFactoryReverts() external {
    HupDrops bare = new HupDrops(address(hup), address(0), admin, address(followers));
    HupDropsDeployer721 bareDeployer = new HupDropsDeployer721(address(bare));
    vm.prank(admin);
    bare.setDeployer(STANDARD_721, address(bareDeployer));

    vm.prank(creator);
    vm.expectRevert(IHupDrops.SplitsUnavailable.selector);
    bare.createDrop(
      address(0),
      STANDARD_721,
      _params721(),
      100,
      0,
      false,
      _one(_openPhase(0)),
      _splitsInput(address(0), _payees2(alice, 5_000, bob, 5_000), new IHupSplits.Payee[](0))
    );
  }

  function test_setPayoutSplit_repointsLiveDrop() external {
    (uint256 dropId, ) = _simple721(1 ether, 100, 0);

    IHupSplits.Payee[] memory table = _payees2(alice, 2_500, bob, 7_500);

    vm.prank(creator);
    address split = engine.setPayoutSplit(dropId, table);

    assertEq(engine.payoutDestination(dropId), split, "re-pointed");

    _mintAs(minter, dropId, 0, 1, 1 ether);
    HupSplitter(payable(split)).distribute();

    assertEq(alice.balance, 0.25 ether, "alice 25%");
    assertEq(bob.balance, 0.75 ether, "bob 75%");
  }

  function test_setPayoutSplit_creatorOnly() external {
    (uint256 dropId, ) = _simple721(0, 100, 0);

    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setPayoutSplit(dropId, _payees1(stranger));

    // Not even the creator's own burner session — revenue levers stay on the primary wallet.
    hup.setSession(creator, burner, block.timestamp + 1 hours);
    vm.prank(burner);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setPayoutSplit(dropId, _payees1(burner));
  }

  function test_setSplits_adminOnly() external {
    HupSplits other = new HupSplits();

    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setSplits(address(other));

    vm.prank(admin);
    engine.setSplits(address(other));
    assertEq(address(engine.splits()), address(other), "factory swapped");
  }
}
