// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { TestBase } from "../shared/TestVm.sol";
import { HupFund } from "../../v2/Extensions/HupFund.sol";
import { IHupFund } from "../../v2/Extensions/IHupFund.sol";
import { RejectingReceiver } from "./Mocks.sol";

/// @dev OZ5 errors the fund's bases revert with.
error EnforcedPause();

/// @dev Payout destination that tries to withdraw again from inside the pot's push.
contract ReentrantFundPayout {
  HupFund public immutable fund;
  uint256 public campaignId;
  bool public reentered;

  constructor(HupFund fund_) {
    fund = fund_;
  }

  function arm(uint256 campaignId_) external {
    campaignId = campaignId_;
  }

  receive() external payable {
    try fund.withdraw(campaignId) {
      reentered = true;
    } catch {}
  }
}

/// @dev Backer that tries to claim a second time from inside its own refund.
contract ReentrantClaimer {
  HupFund public immutable fund;
  uint256 public campaignId;
  bool public reentered;

  constructor(HupFund fund_) {
    fund = fund_;
  }

  function back(uint256 campaignId_) external payable {
    campaignId = campaignId_;
    fund.back{ value: msg.value }(campaignId_, "");
  }

  function claim() external {
    fund.claimRefund(campaignId);
  }

  receive() external payable {
    try fund.claimRefund(campaignId) {
      reentered = true;
    } catch {}
  }
}

/// @dev The escrow: money in, then out exactly one way — withdrawn by the creator or refunded
///      to backers — never both, and never stranded.
contract HupFundTest is TestBase {
  // Mirrors of the interface events, for expectEmit
  event Backed(uint256 indexed campaignId, address indexed backer, uint256 amount, uint256 raised, uint32 backerCount, bytes memo);
  event Withdrawn(uint256 indexed campaignId, address indexed payout, uint256 amount, uint256 feeAmount);
  event RefundsEnabled(uint256 indexed campaignId, address indexed by);
  event Refunded(uint256 indexed campaignId, address indexed backer, uint256 amount);

  HupFund internal fund;

  address internal admin = address(0xAD);
  address internal creator = address(0xC0FFEE);
  address internal payout = address(0x9A70);
  address internal alice = address(0xA11CE);
  address internal bob = address(0xB0B);
  address internal stranger = address(0x5713);

  uint256 internal constant BASE_TIME = 1_800_000_000;
  uint64 internal constant WEEK = 7 days;

  function setUp() public {
    vm.warp(BASE_TIME);
    fund = new HupFund(admin);

    vm.deal(alice, 100 ether);
    vm.deal(bob, 100 ether);
    vm.deal(stranger, 1 ether);
    vm.deal(creator, 1 ether);
  }

  // --- helpers ---

  function _open(uint256 goal, address to) internal returns (uint256 id) {
    vm.prank(creator);
    id = fund.createCampaign("bafycid", goal, uint64(block.timestamp) + WEEK, to);
  }

  function _back(address who, uint256 id, uint256 amount) internal {
    vm.prank(who);
    fund.back{ value: amount }(id, "");
  }

  function _endByDeadline(uint256 id) internal {
    vm.warp(uint256(fund.getCampaign(id).closesAt));
  }

  // --- creation ---

  function test_createRejectsBadInput() external {
    uint64 closes = uint64(block.timestamp) + WEEK;

    vm.startPrank(creator);
    vm.expectRevert(IHupFund.InvalidGoal.selector);
    fund.createCampaign("cid", 0, closes, address(0));

    vm.expectRevert(IHupFund.InvalidWindow.selector);
    fund.createCampaign("cid", 1 ether, uint64(block.timestamp), address(0));

    vm.expectRevert(IHupFund.InvalidWindow.selector);
    fund.createCampaign("cid", 1 ether, uint64(block.timestamp) + 30 minutes, address(0));

    vm.expectRevert(IHupFund.InvalidWindow.selector);
    fund.createCampaign("cid", 1 ether, uint64(block.timestamp) + 181 days, address(0));

    vm.expectRevert(IHupFund.InvalidMetadata.selector);
    fund.createCampaign("", 1 ether, closes, address(0));

    bytes memory tooLong = new bytes(257);
    for (uint256 i = 0; i < tooLong.length; i++) tooLong[i] = "a";
    vm.expectRevert(abi.encodeWithSelector(IHupFund.MetadataTooLarge.selector, 257, 256));
    fund.createCampaign(string(tooLong), 1 ether, closes, address(0));
    vm.stopPrank();
  }

  function test_createDefaultsPayoutToCreatorAndFreezesFee() external {
    vm.prank(admin);
    fund.setFundFeeBps(250);

    uint256 id = _open(10 ether, address(0));
    IHupFund.Campaign memory c = fund.getCampaign(id);
    assertEq(c.creator, creator, "creator");
    assertEq(c.payout, creator, "payout defaults to the creator");
    assertEq(uint256(c.feeBps), 250, "fee frozen at creation");
    assertEq(c.goal, 10 ether, "goal");
    assertEq(id, 1, "ids start at 1");
    assertEq(fund.nextCampaignId(), 2, "next id");

    // A later fee change never reaches a campaign already open
    vm.prank(admin);
    fund.setFundFeeBps(500);
    assertEq(uint256(fund.getCampaign(id).feeBps), 250, "old campaign keeps its rate");
    assertEq(uint256(fund.getCampaign(_open(1 ether, address(0))).feeBps), 500, "new campaign takes the new rate");
  }

  function test_feeCapAndAdminGates() external {
    vm.prank(admin);
    vm.expectRevert(IHupFund.InvalidFeeBps.selector);
    fund.setFundFeeBps(1001);

    vm.prank(stranger);
    vm.expectRevert(IHupFund.Unauthorized.selector);
    fund.setFundFeeBps(1);

    vm.prank(stranger);
    vm.expectRevert(IHupFund.Unauthorized.selector);
    fund.pause();
  }

  // --- backing ---

  function test_backHoldsMoneyAndCounts() external {
    uint256 id = _open(10 ether, payout);

    vm.prank(alice);
    vm.expectEmit(true, true, false, true);
    emit Backed(id, alice, 1 ether, 1 ether, 1, "");
    fund.back{ value: 1 ether }(id, "");

    _back(bob, id, 2 ether);
    _back(alice, id, 3 ether);

    IHupFund.Campaign memory c = fund.getCampaign(id);
    assertEq(c.raised, 6 ether, "raised");
    assertEq(uint256(c.backerCount), 2, "a repeat backer is one person");
    assertEq(fund.backedBy(id, alice), 4 ether, "alice held");
    assertEq(fund.backedBy(id, bob), 2 ether, "bob held");
    assertEq(address(fund).balance, 6 ether, "the contract holds the pot");
    assertEq(payout.balance, 0, "nothing reaches the payout before withdrawal");
    assertTrue(fund.isOpen(id), "open");
    assertFalse(fund.canWithdraw(id), "not withdrawable while open");
  }

  function test_backRejects() external {
    uint256 id = _open(10 ether, payout);

    vm.prank(alice);
    vm.expectRevert(IHupFund.InvalidAmount.selector);
    fund.back{ value: 0 }(id, "");

    vm.prank(creator);
    vm.expectRevert(IHupFund.SelfBack.selector);
    fund.back{ value: 1 ether }(id, "");

    bytes memory memo = new bytes(257);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(IHupFund.MemoTooLarge.selector, 257, 256));
    fund.back{ value: 1 ether }(id, memo);

    vm.prank(alice);
    vm.expectRevert(IHupFund.CampaignNotFound.selector);
    fund.back{ value: 1 ether }(99, "");

    _endByDeadline(id);
    vm.prank(alice);
    vm.expectRevert(IHupFund.CampaignClosed.selector);
    fund.back{ value: 1 ether }(id, "");
  }

  function test_moderatorHiddenDoesNotTouchMoney() external {
    uint256 id = _open(10 ether, payout);
    vm.prank(admin);
    fund.setHidden(id, true);
    assertTrue(fund.getCampaign(id).hidden, "hidden");

    _back(alice, id, 1 ether);
    assertEq(fund.getCampaign(id).raised, 1 ether, "backing still lands");

    vm.prank(stranger);
    vm.expectRevert(IHupFund.Unauthorized.selector);
    fund.setHidden(id, false);
  }

  // --- withdrawal ---

  function test_withdrawOnlyAfterEndAndOnlyOnce() external {
    vm.prank(admin);
    fund.setFundFeeBps(1000); // 10%
    uint256 id = _open(10 ether, payout);
    _back(alice, id, 4 ether);

    vm.prank(creator);
    vm.expectRevert(IHupFund.CampaignStillOpen.selector);
    fund.withdraw(id);

    _endByDeadline(id);
    assertTrue(fund.canWithdraw(id), "withdrawable once ended");

    vm.prank(stranger);
    vm.expectRevert(IHupFund.NotCreator.selector);
    fund.withdraw(id);

    vm.prank(creator);
    vm.expectEmit(true, true, false, true);
    emit Withdrawn(id, payout, 3.6 ether, 0.4 ether);
    fund.withdraw(id);

    assertEq(payout.balance, 3.6 ether, "pot minus fee reached the payout");
    assertEq(fund.feesAccrued(), 0.4 ether, "fee in the ledger");
    assertEq(address(fund).balance, 0.4 ether, "only the fee stays");
    assertTrue(fund.getCampaign(id).withdrawnAt > 0, "withdrawnAt");
    assertFalse(fund.canWithdraw(id), "not twice");

    vm.prank(creator);
    vm.expectRevert(IHupFund.AlreadyWithdrawn.selector);
    fund.withdraw(id);

    // The other exit is shut for good once the pot is gone
    vm.prank(creator);
    vm.expectRevert(IHupFund.AlreadyWithdrawn.selector);
    fund.enableRefunds(id);

    vm.prank(alice);
    vm.expectRevert(IHupFund.NotRefunding.selector);
    fund.claimRefund(id);
  }

  function test_withdrawAfterEarlyClose() external {
    uint256 id = _open(10 ether, payout);
    _back(alice, id, 1 ether);

    vm.prank(stranger);
    vm.expectRevert(IHupFund.NotCreator.selector);
    fund.closeCampaign(id);

    vm.prank(creator);
    fund.closeCampaign(id);
    assertFalse(fund.isOpen(id), "closed early");

    vm.prank(creator);
    vm.expectRevert(IHupFund.CampaignClosed.selector);
    fund.closeCampaign(id);

    vm.prank(alice);
    vm.expectRevert(IHupFund.CampaignClosed.selector);
    fund.back{ value: 1 ether }(id, "");

    vm.prank(creator);
    fund.withdraw(id);
    assertEq(payout.balance, 1 ether, "zero fee by default");
  }

  function test_withdrawNothingRaised() external {
    uint256 id = _open(10 ether, payout);
    _endByDeadline(id);
    vm.prank(creator);
    vm.expectRevert(IHupFund.NothingToWithdraw.selector);
    fund.withdraw(id);
  }

  function test_withdrawRevertsWhenPayoutRejectsAndCanBeRepointed() external {
    RejectingReceiver bad = new RejectingReceiver();
    uint256 id = _open(10 ether, address(bad));
    _back(alice, id, 1 ether);
    _endByDeadline(id);

    vm.prank(creator);
    vm.expectRevert(IHupFund.TransferFailed.selector);
    fund.withdraw(id);
    assertEq(fund.getCampaign(id).withdrawnAt, 0, "a failed push leaves the pot intact");

    // setPayout is allowed after backing ended, exactly for this
    vm.prank(creator);
    fund.setPayout(id, payout);
    vm.prank(creator);
    fund.withdraw(id);
    assertEq(payout.balance, 1 ether, "repointed and paid");
  }

  function test_withdrawCannotBeReentered() external {
    ReentrantFundPayout evil = new ReentrantFundPayout(fund);
    uint256 id = _open(10 ether, address(evil));
    evil.arm(id);
    _back(alice, id, 2 ether);
    _endByDeadline(id);

    vm.prank(creator);
    fund.withdraw(id);

    assertFalse(evil.reentered(), "the inner withdraw was refused");
    assertEq(address(evil).balance, 2 ether, "paid exactly once");
    assertEq(address(fund).balance, 0, "nothing left behind");
  }

  // --- refunds ---

  function test_refundFlowByCreator() external {
    vm.prank(admin);
    fund.setFundFeeBps(500);
    uint256 id = _open(10 ether, payout);
    _back(alice, id, 3 ether);
    _back(bob, id, 1 ether);
    uint256 aliceBefore = alice.balance;
    uint256 bobBefore = bob.balance;

    vm.prank(stranger);
    vm.expectRevert(IHupFund.Unauthorized.selector);
    fund.enableRefunds(id);

    vm.prank(creator);
    vm.expectEmit(true, true, false, true);
    emit RefundsEnabled(id, creator);
    fund.enableRefunds(id);

    IHupFund.Campaign memory c = fund.getCampaign(id);
    assertTrue(c.refunding, "refunding");
    assertTrue(c.closedAt > 0, "the switch ends backing");
    assertFalse(fund.isOpen(id), "closed");
    assertFalse(fund.canWithdraw(id), "never withdrawable again");

    vm.prank(alice);
    vm.expectRevert(IHupFund.RefundsActive.selector);
    fund.back{ value: 1 ether }(id, "");

    vm.prank(creator);
    vm.expectRevert(IHupFund.RefundsActive.selector);
    fund.withdraw(id);

    vm.prank(creator);
    vm.expectRevert(IHupFund.RefundsActive.selector);
    fund.enableRefunds(id);

    vm.prank(creator);
    vm.expectRevert(IHupFund.RefundsActive.selector);
    fund.setPayout(id, stranger);

    vm.prank(alice);
    vm.expectEmit(true, true, false, true);
    emit Refunded(id, alice, 3 ether);
    fund.claimRefund(id);
    assertEq(alice.balance, aliceBefore + 3 ether, "alice made whole, no fee");
    assertEq(fund.backedBy(id, alice), 0, "her balance is spent");
    assertEq(fund.getCampaign(id).refunded, 3 ether, "refunded total");
    assertEq(fund.getCampaign(id).raised, 4 ether, "raised never moves");

    vm.prank(alice);
    vm.expectRevert(IHupFund.NothingToRefund.selector);
    fund.claimRefund(id);

    vm.prank(stranger);
    vm.expectRevert(IHupFund.NothingToRefund.selector);
    fund.claimRefund(id);

    vm.prank(bob);
    fund.claimRefund(id);
    assertEq(bob.balance, bobBefore + 1 ether, "bob made whole");
    assertEq(address(fund).balance, 0, "pot fully returned");
    assertEq(fund.feesAccrued(), 0, "no fee on a refunded campaign");
  }

  function test_refundsNotBlockedByPause() external {
    uint256 id = _open(10 ether, payout);
    _back(alice, id, 1 ether);
    vm.prank(creator);
    fund.enableRefunds(id);

    vm.prank(admin);
    fund.pause();

    vm.prank(bob);
    vm.expectRevert(EnforcedPause.selector);
    fund.back{ value: 1 ether }(id, "");

    uint256 before = alice.balance;
    vm.prank(alice);
    fund.claimRefund(id);
    assertEq(alice.balance, before + 1 ether, "a backer can always leave");
  }

  function test_claimCannotBeReentered() external {
    ReentrantClaimer evil = new ReentrantClaimer(fund);
    // The 2 ether rides msg.value from this test contract, so the claimer starts at zero
    vm.deal(address(this), 2 ether);
    uint256 id = _open(10 ether, payout);
    evil.back{ value: 2 ether }(id);
    _back(alice, id, 2 ether);

    vm.prank(creator);
    fund.enableRefunds(id);

    evil.claim();
    assertFalse(evil.reentered(), "second claim refused");
    assertEq(address(evil).balance, 2 ether, "exactly its own money back");
    assertEq(address(fund).balance, 2 ether, "alice's share untouched");
  }

  function test_claimWindowLetsAnyoneOpenRefunds() external {
    uint256 id = _open(10 ether, payout);
    _back(alice, id, 1 ether);
    _endByDeadline(id);
    uint256 endedAt = block.timestamp;

    vm.prank(stranger);
    vm.expectRevert(IHupFund.Unauthorized.selector);
    fund.enableRefunds(id);

    vm.warp(endedAt + 90 days - 1);
    vm.prank(stranger);
    vm.expectRevert(IHupFund.Unauthorized.selector);
    fund.enableRefunds(id);

    vm.warp(endedAt + 90 days);
    vm.prank(stranger);
    fund.enableRefunds(id);
    assertTrue(fund.getCampaign(id).refunding, "valve opened");

    vm.prank(creator);
    vm.expectRevert(IHupFund.RefundsActive.selector);
    fund.withdraw(id);

    uint256 before = alice.balance;
    vm.prank(alice);
    fund.claimRefund(id);
    assertEq(alice.balance, before + 1 ether, "backer recovered");
  }

  function test_claimWindowCountsFromAnEarlyClose() external {
    uint256 id = _open(10 ether, payout);
    _back(alice, id, 1 ether);
    vm.prank(creator);
    fund.closeCampaign(id);
    uint256 closedAt = block.timestamp;

    // The deadline is still a week away; the window runs from the close, not the deadline
    vm.warp(closedAt + 90 days - 1);
    vm.prank(stranger);
    vm.expectRevert(IHupFund.Unauthorized.selector);
    fund.enableRefunds(id);

    vm.warp(closedAt + 90 days);
    vm.prank(stranger);
    fund.enableRefunds(id);
    assertTrue(fund.getCampaign(id).refunding, "valve counts from the early close");
  }

  // --- fee ledger ---

  function test_feesLedgerIsIsolatedFromPots() external {
    vm.prank(admin);
    fund.setFundFeeBps(1000);
    uint256 first = _open(10 ether, payout);
    uint256 second = _open(10 ether, payout);
    _back(alice, first, 5 ether);
    _back(bob, second, 3 ether);
    _endByDeadline(first);

    vm.prank(creator);
    fund.withdraw(first);
    assertEq(fund.feesAccrued(), 0.5 ether, "one fee accrued");
    assertEq(address(fund).balance, 3.5 ether, "second pot still held beside the fee");

    vm.prank(stranger);
    vm.expectRevert(IHupFund.Unauthorized.selector);
    fund.withdrawFees(payable(stranger));

    address treasury = address(0x7EA5);
    vm.prank(admin);
    fund.withdrawFees(payable(treasury));
    assertEq(treasury.balance, 0.5 ether, "only the fee moved");
    assertEq(address(fund).balance, 3 ether, "the second pot is untouched");
    assertEq(fund.feesAccrued(), 0, "ledger cleared");

    vm.prank(admin);
    vm.expectRevert(IHupFund.NothingToWithdraw.selector);
    fund.withdrawFees(payable(treasury));

    // And the second pot can still go back to its backer in full
    vm.prank(creator);
    fund.enableRefunds(second);
    uint256 before = bob.balance;
    vm.prank(bob);
    fund.claimRefund(second);
    assertEq(bob.balance, before + 3 ether, "no fee on a refund");
    assertEq(address(fund).balance, 0, "empty");
  }

  // --- creator controls ---

  function test_setPayoutRules() external {
    uint256 id = _open(10 ether, payout);

    vm.prank(stranger);
    vm.expectRevert(IHupFund.NotCreator.selector);
    fund.setPayout(id, stranger);

    vm.prank(creator);
    fund.setPayout(id, address(0));
    assertEq(fund.getCampaign(id).payout, creator, "zero means the creator");

    vm.prank(creator);
    fund.setPayout(id, payout);
    _back(alice, id, 1 ether);
    _endByDeadline(id);
    vm.prank(creator);
    fund.withdraw(id);

    vm.prank(creator);
    vm.expectRevert(IHupFund.AlreadyWithdrawn.selector);
    fund.setPayout(id, stranger);
  }

  function test_metadataUpdateRules() external {
    uint256 id = _open(10 ether, payout);

    vm.prank(stranger);
    vm.expectRevert(IHupFund.NotCreator.selector);
    fund.updateCampaignMetadata(id, "new");

    vm.prank(creator);
    fund.updateCampaignMetadata(id, "new");
    assertEq(fund.getCampaign(id).metadata, "new", "updated");

    _endByDeadline(id);
    vm.prank(creator);
    vm.expectRevert(IHupFund.CampaignClosed.selector);
    fund.updateCampaignMetadata(id, "late");
  }

  function test_noPlainDeposits() external {
    (bool ok, ) = address(fund).call{ value: 1 ether }("");
    assertFalse(ok, "a bare transfer is refused");
    assertEq(address(fund).balance, 0, "nothing stranded");
  }
}
