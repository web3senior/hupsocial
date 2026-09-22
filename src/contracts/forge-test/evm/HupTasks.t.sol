// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { TestBase } from "../shared/TestVm.sol";
import { HupTasks } from "../../v2/Extensions/HupTasks.sol";
import { IHupTasks } from "../../v2/Extensions/IHupTasks.sol";
import { IHup } from "../../v2/IHup.sol";
import { MockERC20, MockLSP7Pay, RejectingReceiver } from "./Mocks.sol";

error EnforcedPause();

/// @dev Hup Core stand-in: getContent over a hand-written content table.
contract MockHupCore {
  mapping(uint256 => IHup.ContentView) private _content;
  uint256 public contentCount;

  function put(uint256 id, IHup.ContentType cType, uint256 parentId, address creator, bool allowedComments) external {
    IHup.ContentView storage c = _content[id];
    c.id = id;
    c.cType = cType;
    c.parentId = parentId;
    c.creator = creator;
    c.allowedComments = allowedComments;
    if (id > contentCount) contentCount = id;
    if (parentId != 0 && cType == IHup.ContentType.Comment) _content[parentId].commentCount++;
  }

  function remove(uint256 id) external {
    IHup.ContentView storage c = _content[id];
    c.isDeleted = true;
    if (c.parentId != 0 && c.cType == IHup.ContentType.Comment) _content[c.parentId].commentCount--;
  }

  function getContent(uint256 id, address) external view returns (IHup.ContentView memory) {
    if (id == 0 || id > contentCount) revert IHup.InvalidIndex();
    return _content[id];
  }
}

contract MockIdentity8004 {
  mapping(uint256 => bool) public exists;
  mapping(uint256 => address) public owners;
  mapping(uint256 => address) public wallets;

  function mint(uint256 id, address owner) external {
    exists[id] = true;
    owners[id] = owner;
    wallets[id] = owner;
  }

  function setWallet(uint256 id, address wallet) external {
    wallets[id] = wallet;
  }

  function transferAgent(uint256 id, address to) external {
    owners[id] = to;
    wallets[id] = address(0);
  }

  function isAuthorizedOrOwner(address spender, uint256 id) external view returns (bool) {
    require(exists[id], "nonexistent");
    return owners[id] == spender;
  }

  function getAgentWallet(uint256 id) external view returns (address) {
    return wallets[id];
  }
}

contract MockReputation8004 {
  address public identity;
  uint8 public mode; // 0 normal, 1 revert, 2 burn all gas
  uint256 public calls;
  uint256 public lastAgentId;
  int128 public lastValue;
  string public lastTag1;
  string public lastTag2;
  bytes32 public lastHash;
  address public lastClient;

  constructor(address identity_) {
    identity = identity_;
  }

  function getIdentityRegistry() external view returns (address) {
    return identity;
  }

  function setMode(uint8 mode_) external {
    mode = mode_;
  }

  function giveFeedback(
    uint256 agentId,
    int128 value,
    uint8,
    string calldata tag1,
    string calldata tag2,
    string calldata,
    string calldata,
    bytes32 feedbackHash
  ) external {
    if (mode == 1) revert("broken");
    if (mode == 2) {
      uint256 spin;
      while (true) spin++;
    }
    require(!MockIdentity8004(identity).isAuthorizedOrOwner(msg.sender, agentId), "Self-feedback not allowed");
    calls++;
    lastAgentId = agentId;
    lastValue = value;
    lastTag1 = tag1;
    lastTag2 = tag2;
    lastHash = feedbackHash;
    lastClient = msg.sender;
  }
}

/// @dev Keeps 1% of every transferFrom, so the escrow would come up short.
contract MockFeeToken {
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  function mint(address to, uint256 amount) external {
    balanceOf[to] += amount;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    return true;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    balanceOf[msg.sender] -= amount;
    balanceOf[to] += amount;
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    allowance[from][msg.sender] -= amount;
    balanceOf[from] -= amount;
    balanceOf[to] += amount - amount / 100;
    return true;
  }
}

/// @dev A poster contract that tries to reclaim again from inside its own refund.
contract ReentrantPoster {
  HupTasks public immutable tasks;
  uint256 public postId;
  bool public reentered;

  constructor(HupTasks tasks_) {
    tasks = tasks_;
  }

  function post(uint256 postId_, uint64 deadline) external payable {
    postId = postId_;
    tasks.postTask{ value: msg.value }(postId_, "code", address(0), false, msg.value, 1, deadline, "");
  }

  function reclaim() external {
    tasks.reclaim(postId);
  }

  receive() external payable {
    try tasks.reclaim(postId) {
      reentered = true;
    } catch {}
  }
}

contract HupTasksTest is TestBase {
  event SlotPaid(
    uint256 indexed postId,
    uint256 indexed replyId,
    address indexed worker,
    uint256 amount,
    uint256 feeAmount,
    uint256 agentId,
    uint8 rating,
    bool feedbackGiven,
    bytes revealKey
  );

  HupTasks internal tasks;
  MockHupCore internal hup;
  MockIdentity8004 internal identity;
  MockReputation8004 internal reputation;

  address internal admin = address(0xAD);
  address internal poster = address(0xB0551);
  address internal alice = address(0xA11CE);
  address internal bob = address(0xB0B);
  address internal carol = address(0xCA201);
  address internal stranger = address(0x5713);

  uint256 internal constant BASE_TIME = 1_800_000_000;
  uint64 internal constant WEEK = 7 days;
  uint256 internal constant POST = 1;
  bytes internal constant PUBKEY =
    hex"04aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

  function setUp() public {
    vm.warp(BASE_TIME);
    hup = new MockHupCore();
    identity = new MockIdentity8004();
    reputation = new MockReputation8004(address(identity));
    tasks = new HupTasks(address(hup), address(reputation), admin);

    hup.put(POST, IHup.ContentType.Post, 0, poster, true);

    vm.deal(poster, 100 ether);
    vm.deal(stranger, 1 ether);
  }

  // --- helpers ---

  function _deadline() internal view returns (uint64) {
    return uint64(block.timestamp) + WEEK;
  }

  function _fund(uint256 reward, uint32 slots) internal {
    vm.prank(poster);
    tasks.postTask{ value: reward * slots }(POST, "translate", address(0), false, reward, slots, _deadline(), "");
  }

  function _fundSealed(uint256 reward, uint32 slots) internal {
    vm.prank(poster);
    tasks.postTask{ value: reward * slots }(POST, "translate", address(0), false, reward, slots, _deadline(), PUBKEY);
  }

  function _reply(uint256 id, address who) internal {
    hup.put(id, IHup.ContentType.Comment, POST, who, true);
  }

  function _one(uint256 replyId) internal pure returns (IHupTasks.Approval[] memory list) {
    list = new IHupTasks.Approval[](1);
    list[0] = IHupTasks.Approval(replyId, 0, 0, "");
  }

  function _rated(uint256 replyId, uint256 agentId, uint8 rating) internal pure returns (IHupTasks.Approval[] memory list) {
    list = new IHupTasks.Approval[](1);
    list[0] = IHupTasks.Approval(replyId, agentId, rating, "");
  }

  function _approve(IHupTasks.Approval[] memory list) internal {
    vm.prank(poster);
    tasks.approve(POST, list);
  }

  // --- posting ---

  function test_postTaskRejectsBadInput() external {
    uint64 deadline = _deadline();

    vm.startPrank(poster);
    vm.expectRevert(IHupTasks.InvalidReward.selector);
    tasks.postTask(POST, "code", address(0), false, 0, 1, deadline, "");

    vm.expectRevert(IHupTasks.InvalidSlots.selector);
    tasks.postTask(POST, "code", address(0), false, 1 ether, 0, deadline, "");

    vm.expectRevert(IHupTasks.InvalidSlots.selector);
    tasks.postTask{ value: 1001 }(POST, "code", address(0), false, 1, 1001, deadline, "");

    vm.expectRevert(IHupTasks.InvalidWindow.selector);
    tasks.postTask{ value: 1 ether }(POST, "code", address(0), false, 1 ether, 1, uint64(block.timestamp), "");

    vm.expectRevert(IHupTasks.InvalidWindow.selector);
    tasks.postTask{ value: 1 ether }(POST, "code", address(0), false, 1 ether, 1, uint64(block.timestamp) + 30 minutes, "");

    vm.expectRevert(IHupTasks.InvalidWindow.selector);
    tasks.postTask{ value: 1 ether }(POST, "code", address(0), false, 1 ether, 1, uint64(block.timestamp) + 91 days, "");

    vm.expectRevert(IHupTasks.InvalidCategory.selector);
    tasks.postTask{ value: 1 ether }(POST, "", address(0), false, 1 ether, 1, deadline, "");

    vm.expectRevert(IHupTasks.InvalidCategory.selector);
    tasks.postTask{ value: 1 ether }(POST, "a-category-label-far-past-32-bytes", address(0), false, 1 ether, 1, deadline, "");

    vm.expectRevert(IHupTasks.InvalidPubKey.selector);
    tasks.postTask{ value: 1 ether }(POST, "code", address(0), false, 1 ether, 1, deadline, hex"0401");

    vm.expectRevert(abi.encodeWithSelector(IHupTasks.InsufficientPayment.selector, 0.5 ether, 1 ether));
    tasks.postTask{ value: 0.5 ether }(POST, "code", address(0), false, 1 ether, 1, deadline, "");
    vm.stopPrank();
  }

  function test_postTaskChecksThePostItself() external {
    uint64 deadline = _deadline();

    vm.prank(stranger);
    vm.expectRevert(IHupTasks.NotPostCreator.selector);
    tasks.postTask{ value: 0.1 ether }(POST, "code", address(0), false, 0.1 ether, 1, deadline, "");

    _reply(2, poster);
    vm.prank(poster);
    vm.expectRevert(IHupTasks.NotAPost.selector);
    tasks.postTask{ value: 1 ether }(2, "code", address(0), false, 1 ether, 1, deadline, "");

    vm.prank(poster);
    vm.expectRevert(IHupTasks.NotAPost.selector);
    tasks.postTask{ value: 1 ether }(99, "code", address(0), false, 1 ether, 1, deadline, "");

    hup.put(3, IHup.ContentType.Post, 0, poster, false);
    vm.prank(poster);
    vm.expectRevert(IHupTasks.CommentsDisabled.selector);
    tasks.postTask{ value: 1 ether }(3, "code", address(0), false, 1 ether, 1, deadline, "");

    hup.put(4, IHup.ContentType.Post, 0, poster, true);
    hup.remove(4);
    vm.prank(poster);
    vm.expectRevert(IHupTasks.NotAPost.selector);
    tasks.postTask{ value: 1 ether }(4, "code", address(0), false, 1 ether, 1, deadline, "");
  }

  function test_postTaskEscrowsRewardPlusFrozenFee() external {
    vm.prank(admin);
    tasks.setTaskFeeBps(500);

    vm.prank(poster);
    uint256 escrowed = tasks.postTask{ value: 3.15 ether }(POST, "translate", address(0), false, 1 ether, 3, _deadline(), "");

    assertEq(escrowed, 3.15 ether, "escrow includes the fee");
    assertEq(address(tasks).balance, 3.15 ether, "held");
    assertEq(tasks.escrowOf(POST), 3.15 ether, "escrowOf");

    IHupTasks.Task memory task = tasks.getTask(POST);
    assertEq(task.poster, poster, "poster");
    assertEq(uint256(task.feeBps), 500, "fee frozen");
    assertEq(task.feePerSlot, 0.05 ether, "fee per slot");
    assertFalse(task.isSealed, "open");

    vm.prank(admin);
    tasks.setTaskFeeBps(1000);
    assertEq(tasks.getTask(POST).feePerSlot, 0.05 ether, "later fee change leaves the task alone");

    vm.prank(poster);
    vm.expectRevert(IHupTasks.TaskExists.selector);
    tasks.postTask{ value: 1 ether }(POST, "translate", address(0), false, 1 ether, 1, _deadline(), "");
  }

  // --- approving ---

  function test_approvePaysTheReplyAuthor() external {
    vm.prank(admin);
    tasks.setTaskFeeBps(1000);
    vm.prank(poster);
    tasks.postTask{ value: 2.2 ether }(POST, "translate", address(0), false, 1 ether, 2, _deadline(), "");

    _reply(2, alice);
    vm.expectEmit(true, true, true, true);
    emit SlotPaid(POST, 2, alice, 1 ether, 0.1 ether, 0, 0, false, "");
    _approve(_one(2));

    assertEq(alice.balance, 1 ether, "worker gets the full advertised reward");
    assertEq(tasks.collectedFees(address(0)), 0.1 ether, "fee to the ledger");
    assertEq(uint256(tasks.getTask(POST).paidSlots), 1, "paid slots");
    assertTrue(tasks.isPaid(POST, 2), "marked");
    assertEq(tasks.escrowOf(POST), 1.1 ether, "one slot left");
  }

  function test_approveBatchPaysEveryWorker() external {
    _fund(1 ether, 3);
    _reply(2, alice);
    _reply(3, bob);
    _reply(4, carol);

    IHupTasks.Approval[] memory list = new IHupTasks.Approval[](3);
    list[0] = IHupTasks.Approval(2, 0, 0, "");
    list[1] = IHupTasks.Approval(3, 0, 0, "");
    list[2] = IHupTasks.Approval(4, 0, 0, "");
    _approve(list);

    assertEq(alice.balance + bob.balance + carol.balance, 3 ether, "all paid");
    assertEq(address(tasks).balance, 0, "escrow spent");
  }

  function test_approveRejectsAnythingButALiveReplyOnThePost() external {
    _fund(1 ether, 5);

    vm.prank(stranger);
    vm.expectRevert(IHupTasks.NotPoster.selector);
    tasks.approve(POST, _one(2));

    // unknown id
    vm.prank(poster);
    vm.expectRevert(abi.encodeWithSelector(IHupTasks.NotASubmission.selector, 42));
    tasks.approve(POST, _one(42));

    // a post, not a reply
    hup.put(2, IHup.ContentType.Post, 0, alice, true);
    vm.prank(poster);
    vm.expectRevert(abi.encodeWithSelector(IHupTasks.NotASubmission.selector, 2));
    tasks.approve(POST, _one(2));

    // a reply on some other post
    hup.put(3, IHup.ContentType.Comment, 2, alice, true);
    vm.prank(poster);
    vm.expectRevert(abi.encodeWithSelector(IHupTasks.NotASubmission.selector, 3));
    tasks.approve(POST, _one(3));

    // a deleted reply
    _reply(4, alice);
    hup.remove(4);
    vm.prank(poster);
    vm.expectRevert(abi.encodeWithSelector(IHupTasks.NotASubmission.selector, 4));
    tasks.approve(POST, _one(4));

    // the poster's own reply
    _reply(5, poster);
    vm.prank(poster);
    vm.expectRevert(abi.encodeWithSelector(IHupTasks.SelfApproval.selector, 5));
    tasks.approve(POST, _one(5));
  }

  function test_approvePaysAReplyOnlyOnce() external {
    _fund(1 ether, 3);
    _reply(2, alice);

    _approve(_one(2));

    vm.prank(poster);
    vm.expectRevert(abi.encodeWithSelector(IHupTasks.AlreadyPaid.selector, 2));
    tasks.approve(POST, _one(2));

    _reply(3, bob);
    IHupTasks.Approval[] memory dup = new IHupTasks.Approval[](2);
    dup[0] = IHupTasks.Approval(3, 0, 0, "");
    dup[1] = IHupTasks.Approval(3, 0, 0, "");
    vm.prank(poster);
    vm.expectRevert(abi.encodeWithSelector(IHupTasks.AlreadyPaid.selector, 3));
    tasks.approve(POST, dup);

    assertEq(bob.balance, 0, "the duplicate batch reverted whole");
  }

  function test_approveStopsAtTheSlotCount() external {
    _fund(1 ether, 1);
    _reply(2, alice);
    _reply(3, bob);

    IHupTasks.Approval[] memory two = new IHupTasks.Approval[](2);
    two[0] = IHupTasks.Approval(2, 0, 0, "");
    two[1] = IHupTasks.Approval(3, 0, 0, "");
    vm.prank(poster);
    vm.expectRevert(IHupTasks.NoSlotsLeft.selector);
    tasks.approve(POST, two);

    _approve(_one(2));
    vm.prank(poster);
    vm.expectRevert(IHupTasks.NoSlotsLeft.selector);
    tasks.approve(POST, _one(3));

    vm.prank(poster);
    vm.expectRevert(IHupTasks.InvalidBatch.selector);
    tasks.approve(POST, new IHupTasks.Approval[](0));
  }

  function test_approveOneWorkerMayFillSeveralSlots() external {
    _fund(1 ether, 2);
    _reply(2, alice);
    _reply(3, alice);

    _approve(_one(2));
    _approve(_one(3));

    assertEq(alice.balance, 2 ether, "two replies, two slots");
  }

  function test_approveBubblesAnUnreceivableWorker() external {
    _fund(1 ether, 1);
    RejectingReceiver worker = new RejectingReceiver();
    _reply(2, address(worker));

    vm.prank(poster);
    vm.expectRevert(IHupTasks.TransferFailed.selector);
    tasks.approve(POST, _one(2));

    assertEq(tasks.escrowOf(POST), 1 ether, "nothing moved");
  }

  // --- sealed ---

  function test_sealedTaskStoresTheKeyAndPublishesReveals() external {
    _fundSealed(1 ether, 1);
    assertTrue(tasks.getTask(POST).isSealed, "sealed");
    assertEq(tasks.taskPubKeys(POST), PUBKEY, "pubkey stored");

    _reply(2, alice);
    bytes memory key = hex"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    IHupTasks.Approval[] memory list = new IHupTasks.Approval[](1);
    list[0] = IHupTasks.Approval(2, 0, 0, key);

    vm.expectEmit(true, true, true, true);
    emit SlotPaid(POST, 2, alice, 1 ether, 0, 0, 0, false, key);
    _approve(list);
  }

  function test_revealRules() external {
    _fund(1 ether, 1);
    _reply(2, alice);

    IHupTasks.Approval[] memory list = new IHupTasks.Approval[](1);
    list[0] = IHupTasks.Approval(2, 0, 0, hex"01");
    vm.prank(poster);
    vm.expectRevert(IHupTasks.RevealNotAllowed.selector);
    tasks.approve(POST, list);

    hup.put(10, IHup.ContentType.Post, 0, poster, true);
    vm.prank(poster);
    tasks.postTask{ value: 1 ether }(10, "code", address(0), false, 1 ether, 1, _deadline(), PUBKEY);
    hup.put(11, IHup.ContentType.Comment, 10, alice, true);

    list[0] = IHupTasks.Approval(11, 0, 0, new bytes(65));
    vm.prank(poster);
    vm.expectRevert(IHupTasks.RevealKeyTooLarge.selector);
    tasks.approve(10, list);
  }

  // --- ERC-8004 ---

  function test_ratingLandsOnTheWorkersAgent() external {
    _fund(1 ether, 1);
    _reply(2, alice);
    identity.mint(0, alice);

    vm.expectEmit(true, true, true, true);
    emit SlotPaid(POST, 2, alice, 1 ether, 0, 0, 90, true, "");
    _approve(_rated(2, 0, 90));

    assertEq(reputation.calls(), 1, "one feedback");
    assertEq(reputation.lastAgentId(), 0, "agent id zero is a real agent");
    assertEq(uint256(uint128(reputation.lastValue())), 90, "rating");
    assertEq(reputation.lastTag1(), "starred", "tag1");
    assertEq(reputation.lastTag2(), "translate", "tag2 is the category");
    assertEq(reputation.lastClient(), address(tasks), "HupTasks is the client");
    assertEq(reputation.lastHash(), keccak256(abi.encode(block.chainid, address(tasks), POST, uint256(2))), "hash");
  }

  function test_ratingAcceptsTheAgentWallet() external {
    _fund(1 ether, 1);
    _reply(2, alice);
    identity.mint(7, bob);
    identity.setWallet(7, alice);

    _approve(_rated(2, 7, 80));

    assertEq(reputation.calls(), 1, "wallet counts as control");
  }

  function test_ratingSkipsAnAgentTheWorkerDoesNotControl() external {
    _fund(1 ether, 2);
    _reply(2, alice);
    _reply(3, alice);
    identity.mint(7, bob);

    vm.expectEmit(true, true, true, true);
    emit SlotPaid(POST, 2, alice, 1 ether, 0, 7, 100, false, "");
    _approve(_rated(2, 7, 100));

    _approve(_rated(3, 404, 100));

    assertEq(reputation.calls(), 0, "no feedback for someone else's agent or a missing one");
    assertEq(alice.balance, 2 ether, "paid regardless");
  }

  function test_brokenRegistryNeverBlocksPayment() external {
    _fund(1 ether, 2);
    _reply(2, alice);
    _reply(3, bob);
    identity.mint(1, alice);
    identity.mint(2, bob);

    reputation.setMode(1);
    _approve(_rated(2, 1, 100));

    reputation.setMode(2);
    _approve(_rated(3, 2, 100));

    assertEq(alice.balance + bob.balance, 2 ether, "both paid");
    assertEq(reputation.calls(), 0, "no feedback recorded");
  }

  function test_zeroRatingAndNoRegistrySkipFeedback() external {
    _fund(1 ether, 3);
    _reply(2, alice);
    _reply(3, bob);
    _reply(4, carol);
    identity.mint(1, alice);
    identity.mint(2, bob);

    _approve(_rated(2, 1, 0));
    assertEq(reputation.calls(), 0, "rating zero");

    vm.prank(admin);
    tasks.setReputationRegistry(address(0));
    assertEq(tasks.identityRegistry(), address(0), "identity cleared too");

    _approve(_rated(3, 2, 50));
    assertEq(reputation.calls(), 0, "registry off");

    vm.prank(poster);
    vm.expectRevert(IHupTasks.InvalidRating.selector);
    tasks.approve(POST, _rated(4, 2, 101));
  }

  function test_constructorReadsTheIdentityRegistry() external view {
    assertEq(tasks.reputationRegistry(), address(reputation), "reputation");
    assertEq(tasks.identityRegistry(), address(identity), "identity from the reputation registry");
  }

  // --- cancel and reclaim ---

  function test_cancelOnlyBeforeAnyoneReplied() external {
    _fund(1 ether, 2);

    vm.prank(stranger);
    vm.expectRevert(IHupTasks.NotPoster.selector);
    tasks.cancel(POST);

    uint256 before = poster.balance;
    vm.prank(poster);
    tasks.cancel(POST);
    assertEq(poster.balance - before, 2 ether, "full refund");
    assertTrue(tasks.getTask(POST).closed, "closed");

    _reply(2, alice);
    vm.prank(poster);
    vm.expectRevert(IHupTasks.TaskIsClosed.selector);
    tasks.approve(POST, _one(2));
  }

  function test_cancelLockedOnceSomeoneReplied() external {
    _fund(1 ether, 2);
    _reply(2, alice);

    vm.prank(poster);
    vm.expectRevert(IHupTasks.CancelLocked.selector);
    tasks.cancel(POST);

    // The reply's author deleting it frees the poster again; the poster cannot delete it
    hup.remove(2);
    vm.prank(poster);
    tasks.cancel(POST);
  }

  function test_reclaimReturnsUnpaidSlotsAfterTheDeadline() external {
    vm.prank(admin);
    tasks.setTaskFeeBps(1000);
    vm.prank(poster);
    tasks.postTask{ value: 3.3 ether }(POST, "translate", address(0), false, 1 ether, 3, _deadline(), "");
    _reply(2, alice);
    _approve(_one(2));

    vm.prank(poster);
    vm.expectRevert(IHupTasks.TaskStillOpen.selector);
    tasks.reclaim(POST);

    vm.warp(uint256(tasks.getTask(POST).deadline));
    uint256 before = poster.balance;
    vm.prank(poster);
    tasks.reclaim(POST);

    assertEq(poster.balance - before, 2.2 ether, "two unpaid slots, fee included");
    assertEq(address(tasks).balance, 0.1 ether, "only the earned fee stays");
    assertEq(tasks.escrowOf(POST), 0, "nothing escrowed");

    vm.prank(poster);
    vm.expectRevert(IHupTasks.TaskIsClosed.selector);
    tasks.reclaim(POST);
  }

  function test_approveStillWorksAfterTheDeadlineUntilReclaim() external {
    _fund(1 ether, 1);
    _reply(2, alice);
    vm.warp(uint256(tasks.getTask(POST).deadline) + 1 days);

    _approve(_one(2));
    assertEq(alice.balance, 1 ether, "late review still pays");
  }

  function test_reclaimCannotReenter() external {
    ReentrantPoster attacker = new ReentrantPoster(tasks);
    hup.put(20, IHup.ContentType.Post, 0, address(attacker), true);
    vm.deal(address(this), 1 ether);
    attacker.post{ value: 1 ether }(20, _deadline());

    vm.warp(block.timestamp + WEEK);
    attacker.reclaim();

    assertFalse(attacker.reentered(), "second reclaim refused");
    assertEq(address(attacker).balance, 1 ether, "refunded once");
  }

  // --- pause ---

  function test_pauseStopsNewWorkButNeverTheExit() external {
    _fund(1 ether, 1);
    _reply(2, alice);

    vm.prank(admin);
    tasks.pause();

    vm.prank(poster);
    vm.expectRevert(EnforcedPause.selector);
    tasks.approve(POST, _one(2));

    hup.put(30, IHup.ContentType.Post, 0, poster, true);
    vm.prank(poster);
    vm.expectRevert(EnforcedPause.selector);
    tasks.postTask{ value: 1 ether }(30, "code", address(0), false, 1 ether, 1, _deadline(), "");

    vm.warp(uint256(tasks.getTask(POST).deadline));
    vm.prank(poster);
    tasks.reclaim(POST);
    assertTrue(tasks.getTask(POST).closed, "reclaimed while paused");
  }

  // --- slots and deadline ---

  function test_addSlotsAndExtendDeadline() external {
    vm.prank(admin);
    tasks.setTaskFeeBps(1000);
    vm.prank(poster);
    tasks.postTask{ value: 1.1 ether }(POST, "translate", address(0), false, 1 ether, 1, _deadline(), "");

    vm.prank(poster);
    vm.expectRevert(abi.encodeWithSelector(IHupTasks.InsufficientPayment.selector, 1 ether, 2.2 ether));
    tasks.addSlots{ value: 1 ether }(POST, 2);

    vm.prank(poster);
    tasks.addSlots{ value: 2.2 ether }(POST, 2);
    assertEq(uint256(tasks.getTask(POST).slots), 3, "slots");
    assertEq(tasks.escrowOf(POST), 3.3 ether, "escrow");

    uint64 current = tasks.getTask(POST).deadline;
    vm.startPrank(poster);
    vm.expectRevert(IHupTasks.InvalidWindow.selector);
    tasks.extendDeadline(POST, current);

    vm.expectRevert(IHupTasks.InvalidWindow.selector);
    tasks.extendDeadline(POST, uint64(block.timestamp) + 91 days);

    tasks.extendDeadline(POST, current + 1 days);
    vm.stopPrank();
    assertEq(uint256(tasks.getTask(POST).deadline), uint256(current) + 1 days, "extended");

    vm.prank(stranger);
    vm.expectRevert(IHupTasks.NotPoster.selector);
    tasks.addSlots(POST, 1);
  }

  // --- tokens ---

  function test_erc20EscrowAndPayout() external {
    MockERC20 usdc = new MockERC20();
    usdc.mint(poster, 10e6);

    vm.startPrank(poster);
    usdc.approve(address(tasks), 3e6);
    vm.expectRevert(IHupTasks.UnexpectedNativePayment.selector);
    tasks.postTask{ value: 1 }(POST, "design", address(usdc), false, 1e6, 3, _deadline(), "");
    tasks.postTask(POST, "design", address(usdc), false, 1e6, 3, _deadline(), "");
    vm.stopPrank();

    assertEq(usdc.balanceOf(address(tasks)), 3e6, "escrowed");

    _reply(2, alice);
    _approve(_one(2));
    assertEq(usdc.balanceOf(alice), 1e6, "paid in token");

    vm.warp(uint256(tasks.getTask(POST).deadline));
    vm.prank(poster);
    tasks.reclaim(POST);
    assertEq(usdc.balanceOf(poster), 9e6, "rest back");
  }

  function test_feeOnTransferTokenRejected() external {
    MockFeeToken token = new MockFeeToken();
    token.mint(poster, 10 ether);

    vm.startPrank(poster);
    token.approve(address(tasks), 1 ether);
    vm.expectRevert(IHupTasks.UnsupportedToken.selector);
    tasks.postTask(POST, "code", address(token), false, 1 ether, 1, _deadline(), "");
    vm.stopPrank();
  }

  function test_lsp7EscrowAndPayout() external {
    MockLSP7Pay token = new MockLSP7Pay();
    token.mint(poster, 5 ether);

    vm.startPrank(poster);
    token.authorizeOperator(address(tasks), 2 ether);
    tasks.postTask(POST, "code", address(token), true, 1 ether, 2, _deadline(), "");
    vm.stopPrank();

    assertTrue(tasks.getTask(POST).isLsp7, "lsp7");
    assertEq(token.balanceOf(address(tasks)), 2 ether, "escrowed");

    _reply(2, alice);
    _approve(_one(2));
    assertEq(token.balanceOf(alice), 1 ether, "paid");
  }

  // --- fees ---

  function test_feeLedgerNeverReachesEscrow() external {
    vm.prank(admin);
    tasks.setTaskFeeBps(1000);
    vm.prank(poster);
    tasks.postTask{ value: 2.2 ether }(POST, "translate", address(0), false, 1 ether, 2, _deadline(), "");
    _reply(2, alice);
    _approve(_one(2));

    address treasury = address(0x7EA);
    vm.prank(admin);
    tasks.withdrawFees(address(0), false, treasury);
    assertEq(treasury.balance, 0.1 ether, "only the earned fee");
    assertEq(tasks.escrowOf(POST), 1.1 ether, "escrow intact");

    vm.prank(admin);
    vm.expectRevert(IHupTasks.NothingToWithdraw.selector);
    tasks.withdrawFees(address(0), false, treasury);

    vm.prank(stranger);
    vm.expectRevert(IHupTasks.Unauthorized.selector);
    tasks.withdrawFees(address(0), false, stranger);

    vm.prank(admin);
    vm.expectRevert(IHupTasks.InvalidFeeBps.selector);
    tasks.setTaskFeeBps(1001);
  }

  function test_bareTransfersRefused() external {
    vm.prank(stranger);
    (bool ok, ) = address(tasks).call{ value: 1 }("");
    assertFalse(ok, "no receive");
  }

  function test_moderatorHidesWithoutTouchingMoney() external {
    _fund(1 ether, 1);

    vm.prank(stranger);
    vm.expectRevert(IHupTasks.Unauthorized.selector);
    tasks.setHidden(POST, true);

    vm.prank(admin);
    tasks.setHidden(POST, true);
    assertTrue(tasks.getTask(POST).hidden, "hidden");
    assertEq(tasks.escrowOf(POST), 1 ether, "money unaffected");
  }
}
