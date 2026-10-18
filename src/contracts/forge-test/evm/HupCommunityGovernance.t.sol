// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import { TestBase } from "../shared/TestVm.sol";
import { HupCommunity } from "../../v2/Extensions/HupCommunity.sol";
import { IHupCommunity } from "../../v2/Extensions/IHupCommunity.sol";
import { HupCommunityGovernance } from "../../v2/Extensions/HupCommunityGovernance.sol";
import { HupCommunityTreasury } from "../../v2/Extensions/HupCommunityTreasury.sol";
import { MockERC20, MockLSP7Pay } from "./Mocks.sol";

contract CommunityWallet {
  uint256 public received;

  receive() external payable { received += msg.value; }

  function execute(address target, bytes calldata data) external returns (bytes memory) {
    (bool success, bytes memory result) = target.call(data);
    if (!success) assembly { revert(add(result, 32), mload(result)) }
    return result;
  }
}

contract ReenteringCommunityRecipient {
  HupCommunityGovernance private governance;
  uint256 private proposalId;

  constructor(HupCommunityGovernance instance) { governance = instance; }
  function setProposal(uint256 id) external { proposalId = id; }
  receive() external payable {
    (bool success, ) = address(governance).call(abi.encodeCall(governance.execute, (proposalId)));
    require(!success, "Reentry succeeded");
  }
}

contract RejectingCommunityRecipient {
  receive() external payable { revert("Rejected"); }
}

contract HupCommunityGovernanceTest is TestBase {
  HupCommunity internal community;
  HupCommunityGovernance internal governance;
  address internal owner = address(0xA1);
  address internal member = address(0xB2);
  address internal outsider = address(0xC3);
  address internal recipient = address(0xD4);
  string internal constant CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

  function setUp() public {
    vm.warp(1000000);
    vm.roll(100);
    community = new HupCommunity(address(0), address(this));
    governance = new HupCommunityGovernance(address(community));
    vm.prank(owner);
    community.createCommunity(IHupCommunity.AdmissionMode.Open, IHupCommunity.CommunityType.Discussion, CID, "");
    vm.prank(member);
    community.join(1, 0);
    vm.roll(101);
  }

  function _signal() internal pure returns (HupCommunityGovernance.Payment memory) {
    return HupCommunityGovernance.Payment(address(0), address(0), 0, false);
  }

  function _one(address account) internal pure returns (address[] memory members) {
    members = new address[](1);
    members[0] = account;
  }

  function testDelegatedVoteCountsForMemberAndCannotBeCountedTwice() public {
    uint256 id = _propose(_signal());
    vm.prank(member);
    governance.delegate(1, owner);
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 1);
    assertEq(governance.hasVoted(id, member), true, "member ballot recorded");
    assertEq(governance.hasVoted(id, owner), false, "delegate own ballot separate");
    assertEq(governance.getTallies(id)[1], 1, "one delegated vote");
    vm.expectRevert();
    vm.prank(member);
    governance.castVote(id, 0);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 0);
    vm.prank(owner);
    governance.castVote(id, 1);
    assertEq(governance.getProposal(id).voterCount, 2, "turnout counts members");
  }

  function testMemberCanVoteDirectlyDespiteDelegation() public {
    uint256 id = _propose(_signal());
    vm.prank(member);
    governance.delegate(1, owner);
    vm.prank(member);
    governance.castVote(id, 0);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 1);
    assertEq(governance.getTallies(id)[0], 1, "direct choice preserved");
  }

  function testDelegationCanBeChangedAndRevokedDuringActiveProposal() public {
    uint256 id = _propose(_signal());
    vm.prank(outsider);
    community.join(1, 0);
    vm.prank(member);
    governance.delegate(1, owner);
    vm.prank(member);
    governance.delegate(1, outsider);
    (address[] memory oldMembers, uint256 oldTotal) = governance.getDelegators(1, owner, 0, 50);
    assertEq(oldMembers.length, 0, "removed from old delegate");
    assertEq(oldTotal, 0, "old count");
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 1);
    vm.prank(member);
    governance.delegate(1, address(0));
    vm.expectRevert();
    vm.prank(outsider);
    governance.castVotesFor(id, _one(member), 1);
    vm.prank(member);
    governance.delegate(1, owner);
    vm.prank(member);
    governance.delegate(1, member);
    assertEq(governance.delegates(1, member), address(0), "self revokes");
    vm.prank(member);
    governance.castVote(id, 1);
  }

  function testDelegationRequiresBothCurrentMembersAndDoesNotForward() public {
    uint256 id = _propose(_signal());
    vm.expectRevert();
    vm.prank(member);
    governance.delegate(1, outsider);
    vm.expectRevert();
    vm.prank(outsider);
    governance.delegate(1, owner);
    vm.prank(outsider);
    community.join(1, 0);
    vm.prank(member);
    governance.delegate(1, owner);
    vm.prank(owner);
    governance.delegate(1, outsider);
    vm.expectRevert();
    vm.prank(outsider);
    governance.castVotesFor(id, _one(member), 1);
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 1);
  }

  function testDepartedMembersCannotCastOrReceiveDelegatedBallots() public {
    uint256 id = _propose(_signal());
    vm.prank(member);
    governance.delegate(1, owner);
    vm.prank(member);
    community.leave(1);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 1);
    // Even a departed member can revoke their appointment.
    vm.prank(member);
    governance.delegate(1, address(0));
    assertEq(governance.delegates(1, member), address(0), "revoked after leaving");
    vm.prank(member);
    community.join(1, 0);
    vm.prank(owner);
    governance.delegate(1, member);
    vm.prank(member);
    community.leave(1);
    vm.expectRevert();
    vm.prank(member);
    governance.castVotesFor(id, _one(owner), 1);
  }

  function testBatchIsAtomicAndCannotDuplicateOrStealVotes() public {
    uint256 id = _propose(_signal());
    vm.prank(member);
    governance.delegate(1, owner);
    address[] memory members = new address[](2);
    members[0] = member;
    members[1] = member;
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, members, 1);
    assertEq(governance.getProposal(id).voterCount, 0, "duplicate batch rolled back");
    vm.expectRevert();
    vm.prank(member);
    governance.castVotesFor(id, _one(owner), 1);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, new address[](0), 1);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, new address[](51), 1);
    members[1] = owner;
    vm.prank(owner);
    governance.castVotesFor(id, members, 1);
    assertEq(governance.getProposal(id).voterCount, 2, "two members counted");
  }

  function testDelegationIsScopedToCommunityAndPaginationStaysCorrect() public {
    vm.prank(owner);
    community.createCommunity(IHupCommunity.AdmissionMode.Open, IHupCommunity.CommunityType.Discussion, CID, "");
    vm.prank(member);
    community.join(2, 0);
    vm.prank(member);
    governance.delegate(1, owner);
    assertEq(governance.delegates(2, member), address(0), "community scope");
    vm.prank(outsider);
    community.join(1, 0);
    vm.prank(outsider);
    governance.delegate(1, owner);
    (address[] memory first, uint256 total) = governance.getDelegators(1, owner, 0, 1);
    assertEq(total, 2, "total appointments");
    assertEq(first[0], member, "first page");
    vm.prank(member);
    governance.delegate(1, address(0));
    (address[] memory remaining, ) = governance.getDelegators(1, owner, 0, 50);
    assertEq(remaining[0], outsider, "swap removal");
    vm.prank(outsider);
    governance.delegate(1, address(0));
    (address[] memory empty, ) = governance.getDelegators(1, owner, 10, 50);
    assertEq(empty.length, 0, "past end");
    vm.expectRevert();
    governance.getDelegators(1, owner, 0, 51);
  }

  function testContractWalletCanDelegateAndCastDelegatedBallots() public {
    CommunityWallet wallet = new CommunityWallet();
    wallet.execute(address(community), abi.encodeCall(community.join, (1, 0)));
    uint256 id = _propose(_signal());
    wallet.execute(address(governance), abi.encodeCall(governance.delegate, (1, owner)));
    vm.prank(owner);
    governance.castVotesFor(id, _one(address(wallet)), 1);
    assertEq(governance.hasVoted(id, address(wallet)), true, "contract member ballot");
    vm.prank(member);
    governance.delegate(1, address(wallet));
    wallet.execute(address(governance), abi.encodeCall(governance.castVotesFor, (id, _one(member), 1)));
    assertEq(governance.hasVoted(id, member), true, "contract delegate ballot");
    assertEq(governance.hasVoted(id, owner), false, "EOA not confused with contract");
  }

  function testDelegatedVotesRespectDeadlinesAndValidOptions() public {
    uint256 id = _propose(_signal());
    vm.prank(member);
    governance.delegate(1, owner);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 3);
    vm.warp(governance.getProposal(id).voteEnd);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 1);
    assertEq(governance.getProposal(id).voterCount, 0, "closed ballot not counted");
  }

  function testBannedMemberCannotAppointDelegateOrHaveBallotCast() public {
    uint256 id = _propose(_signal());
    vm.prank(member);
    governance.delegate(1, owner);
    vm.prank(owner);
    community.setBanStatus(1, member, true);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 1);
    vm.expectRevert();
    vm.prank(member);
    governance.delegate(1, owner);
    vm.expectRevert();
    vm.prank(owner);
    governance.delegate(1, member);
    vm.prank(member);
    governance.delegate(1, address(0));
    assertEq(governance.delegates(1, member), address(0), "banned member can revoke");
  }

  function testDelegatedVoteCannotBeCastBeforeVotingStartsOrAfterCancel() public {
    vm.prank(owner);
    governance.updateRules(1, HupCommunityGovernance.Rules(1 days, 1 hours, 7 days, 1 hours, 1, 5001));
    uint256 id = _propose(_signal());
    vm.prank(member);
    governance.delegate(1, owner);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 1);
    vm.warp(governance.getProposal(id).voteStart);
    vm.prank(member);
    governance.cancel(id);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), 1);
  }

  function testFuzzDelegatedBallotKeepsOriginalMemberIdentity(uint8 option) public {
    option = option % 3;
    uint256 id = _propose(_signal());
    vm.prank(member);
    governance.delegate(1, owner);
    vm.prank(owner);
    governance.castVotesFor(id, _one(member), option);
    assertEq(governance.getTallies(id)[option], 1, "selected option counted");
    assertEq(governance.getProposal(id).voterCount, 1, "one member turnout");
    vm.prank(member);
    governance.delegate(1, address(0));
    assertEq(governance.hasVoted(id, member), true, "revocation keeps recorded ballot");
    assertEq(governance.hasVoted(id, owner), false, "representative own ballot unused");
  }

  function _propose(HupCommunityGovernance.Payment memory payment) internal returns (uint256) {
    vm.prank(member);
    return governance.propose(1, CID, 0, 3 days, payment);
  }

  function _pass(uint256 id) internal {
    vm.prank(owner);
    governance.castVote(id, 1);
    vm.prank(member);
    governance.castVote(id, 1);
    HupCommunityGovernance.Proposal memory proposal = governance.getProposal(id);
    vm.warp(proposal.executableAt);
  }

  function testMemberProposesWithoutCreatingGroup() public {
    uint256 id = _propose(_signal());
    assertEq(governance.getProposal(id).communityId, 1, "community id");
    assertEq(governance.proposalCount(1), 1, "count");
    assertEq(governance.getProposal(id).quorumVotes, 1, "default turnout");
  }

  function testOnlyCurrentOwnerChangesRulesAndExistingRulesStayFixed() public {
    uint256 id = _propose(_signal());
    HupCommunityGovernance.Rules memory rules = HupCommunityGovernance.Rules(0, 1 hours, 7 days, 1 hours, 2, 7500);
    vm.expectRevert();
    vm.prank(member);
    governance.updateRules(1, rules);
    vm.prank(owner);
    governance.updateRules(1, rules);
    assertEq(governance.getProposal(id).approvalBps, 5001, "old proposal rules");
    assertEq(governance.getProposal(id).quorumVotes, 1, "old proposal turnout");
    vm.prank(owner);
    community.transferCommunityOwnership(1, member);
    vm.prank(member);
    community.acceptCommunityOwnership(1);
    vm.expectRevert();
    vm.prank(owner);
    governance.updateRules(1, rules);
    vm.prank(member);
    governance.updateRules(1, rules);
  }

  function testNewMemberCanImmediatelyProposeAndVoteOnExistingProposal() public {
    uint256 id = _propose(_signal());
    vm.expectRevert();
    vm.prank(outsider);
    governance.propose(1, CID, 0, 3 days, _signal());
    vm.expectRevert();
    vm.prank(outsider);
    governance.castVote(id, 1);
    vm.prank(outsider);
    community.join(1, 0);
    vm.prank(outsider);
    governance.propose(1, CID, 0, 3 days, _signal());
    vm.prank(outsider);
    governance.castVote(id, 1);
    assertEq(governance.getProposal(id).voterCount, 1, "new member votes immediately");
    vm.prank(outsider);
    community.leave(1);
    vm.prank(outsider);
    community.join(1, 0);
    vm.expectRevert();
    vm.prank(outsider);
    governance.castVote(id, 1);
  }

  function testOneVoteAndRemovalCannotKeepVoting() public {
    uint256 id = _propose(_signal());
    vm.prank(owner);
    governance.castVote(id, 1);
    vm.expectRevert();
    vm.prank(owner);
    governance.castVote(id, 0);
    vm.prank(member);
    community.leave(1);
    vm.expectRevert();
    vm.prank(member);
    governance.castVote(id, 1);
  }

  function testNativePaymentWaitsForApprovalAndDelayAndExecutesOnce() public {
    vm.deal(owner, 3 ether);
    vm.prank(owner);
    governance.depositNative{value: 3 ether}(1);
    uint256 id = _propose(HupCommunityGovernance.Payment(address(0), recipient, 1 ether, false));
    assertEq(address(governance.treasuries(1)), governance.treasuryAddress(1), "predicted vault");
    vm.expectRevert();
    governance.execute(id);
    vm.prank(member);
    governance.castVote(id, 1);
    HupCommunityGovernance.Proposal memory proposal = governance.getProposal(id);
    vm.warp(proposal.voteEnd);
    vm.expectRevert();
    governance.execute(id);
    vm.warp(proposal.executableAt);
    vm.prank(outsider);
    governance.execute(id);
    assertEq(recipient.balance, 1 ether, "payment");
    vm.expectRevert();
    governance.execute(id);
    HupCommunityTreasury treasury = governance.treasuries(1);
    vm.expectRevert();
    vm.prank(owner);
    treasury.pay(address(0), owner, 1 ether, false);
  }

  function testTreasuriesAreIsolatedAndRejectedPaymentsCannotExecute() public {
    vm.prank(owner);
    community.createCommunity(IHupCommunity.AdmissionMode.Open, IHupCommunity.CommunityType.Discussion, CID, "");
    vm.deal(owner, 3 ether);
    vm.prank(owner);
    governance.depositNative{value: 3 ether}(2);
    uint256 id = _propose(HupCommunityGovernance.Payment(address(0), recipient, 1 ether, false));
    _pass(id);
    vm.expectRevert();
    governance.execute(id);
    assertFalse(governance.getProposal(id).executed, "failed payment rolls back");
    assertEq(governance.treasuryAddress(2).balance, 3 ether, "other vault intact");
    uint256 rejected = _propose(_signal());
    vm.prank(owner);
    governance.castVote(rejected, 0);
    vm.warp(governance.getProposal(rejected).executableAt);
    assertEq(uint256(governance.state(rejected)), uint256(HupCommunityGovernance.State.Defeated), "defeated");
    vm.expectRevert();
    governance.execute(rejected);
  }

  function testErc20AndLsp7DepositAndPay() public {
    MockERC20 erc20 = new MockERC20();
    MockLSP7Pay lsp7 = new MockLSP7Pay();
    erc20.mint(owner, 100);
    lsp7.mint(owner, 100);
    vm.startPrank(owner);
    erc20.approve(address(governance), 100);
    governance.depositToken(1, address(erc20), 100, false);
    lsp7.authorizeOperator(address(governance), 100);
    governance.depositToken(1, address(lsp7), 100, true);
    vm.stopPrank();
    uint256 first = _propose(HupCommunityGovernance.Payment(address(erc20), recipient, 10, false));
    uint256 second = _propose(HupCommunityGovernance.Payment(address(lsp7), recipient, 20, true));
    vm.prank(owner);
    governance.castVote(first, 1);
    vm.prank(member);
    governance.castVote(first, 1);
    _pass(second);
    governance.execute(first);
    governance.execute(second);
    assertEq(erc20.balanceOf(recipient), 10, "ERC20 payment");
    assertEq(lsp7.balanceOf(recipient), 20, "LSP7 payment");
  }

  function testContractWalletCanProposeVoteAndReceiveNativePayment() public {
    CommunityWallet wallet = new CommunityWallet();
    wallet.execute(address(community), abi.encodeCall(community.join, (1, 0)));
    bytes memory result = wallet.execute(address(governance), abi.encodeCall(governance.propose, (1, CID, 0, 3 days, HupCommunityGovernance.Payment(address(0), address(wallet), 1 ether, false))));
    uint256 id = abi.decode(result, (uint256));
    wallet.execute(address(governance), abi.encodeCall(governance.castVote, (id, 1)));
    vm.deal(owner, 1 ether);
    vm.prank(owner);
    governance.depositNative{value: 1 ether}(1);
    vm.warp(governance.getProposal(id).executableAt);
    governance.execute(id);
    assertEq(wallet.received(), 1 ether, "contract receive uses full gas");
  }

  function testReentrancyAndFailedRecipientDoNotConsumeApprovedPayment() public {
    ReenteringCommunityRecipient attacker = new ReenteringCommunityRecipient(governance);
    vm.deal(owner, 2 ether);
    vm.prank(owner);
    governance.depositNative{value: 2 ether}(1);
    uint256 id = _propose(HupCommunityGovernance.Payment(address(0), address(attacker), 1 ether, false));
    attacker.setProposal(id);
    _pass(id);
    governance.execute(id);
    assertEq(address(attacker).balance, 1 ether, "single payment");
    RejectingCommunityRecipient rejector = new RejectingCommunityRecipient();
    uint256 rejected = _propose(HupCommunityGovernance.Payment(address(0), address(rejector), 1 ether, false));
    _pass(rejected);
    vm.expectRevert();
    governance.execute(rejected);
    assertFalse(governance.getProposal(rejected).executed, "rollback");
  }

  function testAbstentionsCountForTurnoutButCannotPassWithoutYes() public {
    uint256 id = _propose(_signal());
    vm.prank(owner);
    governance.castVote(id, 2);
    vm.warp(governance.getProposal(id).voteEnd);
    assertEq(uint256(governance.state(id)), uint256(HupCommunityGovernance.State.Defeated), "no decisive votes");
  }

  function testInvalidRulesAndMalformedPaymentRevert() public {
    vm.expectRevert();
    vm.prank(owner);
    governance.updateRules(1, HupCommunityGovernance.Rules(0, 1 hours, 7 days, 0, 1000, 5001));
    vm.expectRevert();
    _propose(HupCommunityGovernance.Payment(address(0), address(0), 1, false));
    vm.expectRevert();
    vm.prank(member);
    governance.propose(1, CID, 2, 3 days, HupCommunityGovernance.Payment(address(0), recipient, 1, false));
  }

  function testBanAndKickBlockVotingUntilMembershipIsRestored() public {
    uint256 id = _propose(_signal());
    vm.prank(owner);
    community.setBanStatus(1, member, true);
    vm.expectRevert();
    vm.prank(member);
    governance.castVote(id, 1);
    vm.prank(owner);
    community.setBanStatus(1, member, false);
    vm.prank(member);
    community.join(1, 0);
    vm.prank(member);
    governance.castVote(id, 1);
    uint256 nextId = _propose(_signal());
    vm.prank(owner);
    community.kick(1, member);
    vm.expectRevert();
    vm.prank(member);
    governance.castVote(nextId, 1);
    assertEq(governance.getProposal(id).voterCount, 1, "cast ballot stays counted");
  }

  function testMinimumTurnoutAndNoVoteTieFails() public {
    vm.prank(outsider);
    community.join(1, 0);
    vm.roll(102);
    vm.prank(owner);
    governance.updateRules(1, HupCommunityGovernance.Rules(0, 1 hours, 7 days, 1 hours, 2, 5001));
    uint256 id = _propose(_signal());
    assertEq(governance.getProposal(id).quorumVotes, 2, "minimum turnout");
    vm.prank(owner);
    governance.castVote(id, 1);
    vm.prank(member);
    governance.castVote(id, 0);
    vm.warp(governance.getProposal(id).voteEnd);
    assertEq(uint256(governance.state(id)), uint256(HupCommunityGovernance.State.Defeated), "tie fails");
    uint256 underTurnout = _propose(_signal());
    vm.prank(owner);
    governance.castVote(underTurnout, 1);
    vm.warp(governance.getProposal(underTurnout).voteEnd);
    assertEq(uint256(governance.state(underTurnout)), uint256(HupCommunityGovernance.State.Defeated), "not enough ballots");
  }

  function testOwnerCannotCancelActiveOrPassedMemberProposal() public {
    uint256 id = _propose(_signal());
    vm.expectRevert();
    vm.prank(owner);
    governance.cancel(id);
    _pass(id);
    vm.expectRevert();
    vm.prank(owner);
    governance.cancel(id);
    vm.expectRevert();
    vm.prank(member);
    governance.cancel(id);
  }

  function testMultipleChoiceMustMeetApprovalAndCannotExecutePayment() public {
    vm.prank(member);
    uint256 id = governance.propose(1, CID, 3, 3 days, _signal());
    vm.prank(owner);
    governance.castVote(id, 2);
    vm.prank(member);
    governance.castVote(id, 2);
    vm.warp(governance.getProposal(id).executableAt);
    assertEq(uint256(governance.state(id)), uint256(HupCommunityGovernance.State.Succeeded), "choice passes");
    vm.expectRevert();
    governance.execute(id);
  }

  function testCreatorsChooseIndependentDurationsAndExecutionFollowsDeadline() public {
    vm.startPrank(member);
    uint256 shortId = governance.propose(1, CID, 0, 1 hours, _signal());
    uint256 longId = governance.propose(1, CID, 0, 7 days, _signal());
    vm.stopPrank();
    HupCommunityGovernance.Proposal memory shortProposal = governance.getProposal(shortId);
    HupCommunityGovernance.Proposal memory longProposal = governance.getProposal(longId);
    assertEq(shortProposal.voteEnd - shortProposal.voteStart, 1 hours, "short duration");
    assertEq(longProposal.voteEnd - longProposal.voteStart, 7 days, "long duration");
    assertEq(shortProposal.executableAt - shortProposal.voteEnd, 2 days, "execution delay");
    vm.warp(shortProposal.voteEnd);
    assertEq(uint256(governance.state(shortId)), uint256(HupCommunityGovernance.State.Defeated), "short vote closed");
    assertEq(uint256(governance.state(longId)), uint256(HupCommunityGovernance.State.Active), "long vote open");
  }

  function testDurationBoundsAreEnforcedForSignalsAndPayments() public {
    vm.prank(owner);
    governance.updateRules(1, HupCommunityGovernance.Rules(0, 1 days, 7 days, 1 hours, 1, 5001));
    vm.expectRevert();
    vm.prank(member);
    governance.propose(1, CID, 0, 1 days - 1, _signal());
    vm.expectRevert();
    vm.prank(member);
    governance.propose(1, CID, 0, 7 days + 1, HupCommunityGovernance.Payment(address(0), recipient, 1, false));
    vm.prank(member);
    governance.propose(1, CID, 0, 1 days, _signal());
    vm.prank(member);
    governance.propose(1, CID, 0, 7 days, HupCommunityGovernance.Payment(address(0), recipient, 1, false));
  }

  function testInvalidDurationBoundsRevertAndRuleChangesPreserveDeadlines() public {
    uint256 id = _propose(_signal());
    HupCommunityGovernance.Proposal memory original = governance.getProposal(id);
    vm.startPrank(owner);
    vm.expectRevert();
    governance.updateRules(1, HupCommunityGovernance.Rules(0, 0, 7 days, 1 hours, 1, 5001));
    vm.expectRevert();
    governance.updateRules(1, HupCommunityGovernance.Rules(0, 8 days, 7 days, 1 hours, 1, 5001));
    vm.expectRevert();
    governance.updateRules(1, HupCommunityGovernance.Rules(0, 1 hours, 91 days, 1 hours, 1, 5001));
    governance.updateRules(1, HupCommunityGovernance.Rules(1 days, 1 hours, 1 hours, 1 hours, 1, 5001));
    vm.stopPrank();
    HupCommunityGovernance.Proposal memory unchanged = governance.getProposal(id);
    assertEq(unchanged.voteStart, original.voteStart, "start unchanged");
    assertEq(unchanged.voteEnd, original.voteEnd, "end unchanged");
    assertEq(unchanged.executableAt, original.executableAt, "execution unchanged");
    vm.prank(member);
    uint256 nextId = governance.propose(1, CID, 0, 1 hours, _signal());
    HupCommunityGovernance.Proposal memory next = governance.getProposal(nextId);
    assertEq(next.voteStart, block.timestamp + 1 days, "delay applies to new proposal");
    assertEq(next.voteEnd - next.voteStart, 1 hours, "fixed duration range allowed");
  }
}
