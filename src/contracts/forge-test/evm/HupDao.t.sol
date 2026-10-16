// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import { TestBase } from "../shared/TestVm.sol";
import { HupDao } from "../../v2/Extensions/HupDao.sol";
import { IHupDao } from "../../v2/Extensions/IHupDao.sol";
import { Forwarder, MockERC20, MockLSP7Pay } from "./Mocks.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

error EnforcedPause();

/// @dev Block-number-clocked votes token, the shape ERC20Votes deployments have by default.
contract MockVotesToken is ERC20, ERC20Votes {
  constructor() ERC20("Votes", "VOTE") EIP712("Votes", "1") {}

  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }

  function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
    super._update(from, to, value);
  }
}

/// @dev Universal Profile stand-in: a contract account that acts through execute() and signs
///      through ERC-1271 on behalf of its controller key.
contract MockUniversalProfile {
  address public immutable controller;

  constructor(address _controller) {
    controller = _controller;
  }

  function execute(address target, bytes calldata data) external returns (bytes memory) {
    require(msg.sender == controller, "controller");
    (bool ok, bytes memory ret) = target.call(data);
    if (!ok) {
      assembly {
        revert(add(ret, 32), mload(ret))
      }
    }
    return ret;
  }

  function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
    if (signature.length != 65) return 0xffffffff;
    bytes32 r = bytes32(signature[0:32]);
    bytes32 s = bytes32(signature[32:64]);
    uint8 v = uint8(signature[64]);
    return ecrecover(hash, v, r, s) == controller ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
  }
}

abstract contract DaoFixture is TestBase {
  HupDao internal dao;
  Forwarder internal fwd;
  MockERC20 internal token;

  address internal admin = address(0xA11CE0);
  address internal alice = address(0xA1);
  address internal bob = address(0xB0B);
  address internal carol = address(0xCA);

  uint32 internal constant PERIOD = 3 days;
  string internal constant META = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

  function setUp() public virtual {
    vm.warp(1_000_000);
    vm.roll(100);
    fwd = new Forwarder();
    dao = new HupDao(address(fwd), admin);
    token = new MockERC20();
  }

  function _settings(uint32 delay, uint16 quorumBps, uint256 threshold) internal pure returns (IHupDao.DaoSettings memory) {
    return IHupDao.DaoSettings({ votingDelay: delay, votingPeriod: PERIOD, quorumBps: quorumBps, proposalThreshold: threshold });
  }

  function _noMembers() internal pure returns (address[] memory) {
    return new address[](0);
  }

  function _members3() internal view returns (address[] memory members) {
    members = new address[](3);
    members[0] = alice;
    members[1] = bob;
    members[2] = carol;
  }

  function _stakedDao(uint16 quorumBps) internal returns (uint256 id) {
    vm.prank(alice);
    id = dao.createDao(IHupDao.VotingMode.Staked, address(token), false, _settings(0, quorumBps, 1), META, _noMembers());
  }

  function _stake(uint256 id, address who, uint256 amount) internal {
    token.mint(who, amount);
    vm.startPrank(who);
    token.approve(address(dao), amount);
    dao.stake(id, amount);
    vm.stopPrank();
  }

  function _tick() internal {
    vm.warp(block.timestamp + 1);
    vm.roll(block.number + 1);
  }

  function _propose(uint256 id, address who, uint8 optionCount) internal returns (uint256 proposalId) {
    vm.prank(who);
    proposalId = dao.propose(id, META, optionCount);
  }

  function _vote(uint256 proposalId, address who, uint8 option) internal {
    vm.prank(who);
    dao.castVote(proposalId, option, "");
  }

  function _endVoting(uint256 proposalId) internal {
    vm.warp(dao.getProposal(proposalId).voteEnd);
  }

  function _state(uint256 proposalId) internal view returns (uint256) {
    return uint256(dao.state(proposalId));
  }
}

contract HupDaoCreateTest is DaoFixture {
  function test_createStakedDao() public {
    uint256 id = _stakedDao(400);
    IHupDao.Dao memory d = dao.getDao(id);
    assertEq(d.id, 1, "id");
    assertEq(d.admin, alice, "admin");
    assertEq(d.token, address(token), "token");
    assertEq(uint256(d.settings.quorumBps), 400, "quorum");
    assertEq(dao.nextDaoId(), 2, "next");
  }

  function test_membersModeRejectsToken() public {
    vm.expectRevert(IHupDao.InvalidToken.selector);
    dao.createDao(IHupDao.VotingMode.Members, address(token), false, _settings(0, 0, 0), META, _noMembers());
  }

  function test_stakedModeRejectsEoaToken() public {
    vm.expectRevert(IHupDao.InvalidToken.selector);
    dao.createDao(IHupDao.VotingMode.Staked, address(0xBEEF), false, _settings(0, 0, 0), META, _noMembers());
  }

  function test_rejectsBadSettings() public {
    IHupDao.DaoSettings memory s = _settings(0, 0, 0);
    s.votingPeriod = 10 minutes;
    vm.expectRevert(IHupDao.InvalidSettings.selector);
    dao.createDao(IHupDao.VotingMode.Members, address(0), false, s, META, _noMembers());

    s = _settings(0, 10_001, 0);
    vm.expectRevert(IHupDao.InvalidSettings.selector);
    dao.createDao(IHupDao.VotingMode.Members, address(0), false, s, META, _noMembers());
  }

  function test_rejectsMembersOutsideMembersMode() public {
    vm.expectRevert(IHupDao.WrongMode.selector);
    dao.createDao(IHupDao.VotingMode.Staked, address(token), false, _settings(0, 0, 0), META, _members3());
  }

  function test_rejectsEmptyAndOversizedMetadata() public {
    vm.expectRevert(IHupDao.InvalidMetadata.selector);
    dao.createDao(IHupDao.VotingMode.Members, address(0), false, _settings(0, 0, 0), "", _noMembers());

    bytes memory big = new bytes(129);
    vm.expectRevert(abi.encodeWithSelector(IHupDao.MetadataTooLarge.selector, 129, 128));
    dao.createDao(IHupDao.VotingMode.Members, address(0), false, _settings(0, 0, 0), string(big), _noMembers());
  }

  function test_onlyAdminEditsAndRenounceFreezes() public {
    uint256 id = _stakedDao(0);

    vm.prank(bob);
    vm.expectRevert(IHupDao.NotDaoAdmin.selector);
    dao.updateMetadata(id, META);

    vm.prank(alice);
    dao.transferDaoAdmin(id, address(0));

    vm.prank(alice);
    vm.expectRevert(IHupDao.NotDaoAdmin.selector);
    dao.updateSettings(id, _settings(0, 0, 0));
  }

  function test_getDaosPaginates() public {
    _stakedDao(0);
    _stakedDao(0);
    _stakedDao(0);
    IHupDao.Dao[] memory page = dao.getDaos(1, 10);
    assertEq(page.length, 2, "len");
    assertEq(page[0].id, 2, "first");
    assertEq(dao.getDaos(3, 10).length, 0, "past end");
  }
}

contract HupDaoStakedTest is DaoFixture {
  function test_stakeGivesVotesAndUnstakeReturnsTokens() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);

    assertEq(dao.getVotes(id, alice), 100, "votes");
    assertEq(dao.unitsOf(id, alice), 100, "units");
    assertEq(token.balanceOf(address(dao)), 100, "escrow");

    vm.prank(alice);
    dao.unstake(id, 40);
    assertEq(dao.getVotes(id, alice), 60, "votes after");
    assertEq(token.balanceOf(alice), 40, "returned");
  }

  function test_unstakeMoreThanStakedReverts() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 10);
    vm.prank(alice);
    vm.expectRevert(IHupDao.InsufficientStake.selector);
    dao.unstake(id, 11);
  }

  function test_voteWeightAndSucceeded() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);
    _stake(id, bob, 30);
    _tick();

    uint256 p = _propose(id, alice, 0);
    _vote(p, alice, 1);
    _vote(p, bob, 0);

    uint256[] memory tallies = dao.getTallies(p);
    assertEq(tallies[1], 100, "for");
    assertEq(tallies[0], 30, "against");
    assertEq(_state(p), uint256(IHupDao.ProposalState.Active), "active");

    _endVoting(p);
    assertEq(_state(p), uint256(IHupDao.ProposalState.Succeeded), "succeeded");
  }

  function test_stakeAfterSnapshotCannotVote() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);
    _tick();
    uint256 p = _propose(id, alice, 0);

    _stake(id, bob, 1_000);
    vm.prank(bob);
    vm.expectRevert(IHupDao.NoVotingPower.selector);
    dao.castVote(p, 1, "");
  }

  function test_stakeInProposalBlockDoesNotCount() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);
    _tick();
    // Same block as the proposal: a flash stake must not reach the snapshot
    _stake(id, bob, 1_000);
    uint256 p = _propose(id, alice, 0);

    vm.prank(bob);
    vm.expectRevert(IHupDao.NoVotingPower.selector);
    dao.castVote(p, 1, "");
  }

  function test_moveTokensToSecondWalletCannotRevote() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);
    _tick();
    uint256 p = _propose(id, alice, 0);
    _vote(p, alice, 1);

    vm.prank(alice);
    dao.unstake(id, 100);
    vm.prank(alice);
    token.transfer(bob, 100);
    vm.startPrank(bob);
    token.approve(address(dao), 100);
    dao.stake(id, 100);
    vm.expectRevert(IHupDao.NoVotingPower.selector);
    dao.castVote(p, 1, "");
    vm.stopPrank();

    assertEq(dao.getTallies(p)[1], 100, "counted once");
  }

  function test_doubleVoteReverts() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);
    _tick();
    uint256 p = _propose(id, alice, 0);
    _vote(p, alice, 1);

    vm.prank(alice);
    vm.expectRevert(IHupDao.AlreadyVoted.selector);
    dao.castVote(p, 0, "");
  }

  function test_quorumNotReachedIsDefeated() public {
    uint256 id = _stakedDao(5_000);
    _stake(id, alice, 40);
    _stake(id, bob, 60);
    _tick();
    uint256 p = _propose(id, alice, 0);
    assertEq(dao.getProposal(p).quorumVotes, 50, "quorum votes");

    _vote(p, alice, 1);
    _endVoting(p);
    assertEq(_state(p), uint256(IHupDao.ProposalState.Defeated), "defeated");
  }

  function test_abstainCountsTowardQuorumOnly() public {
    uint256 id = _stakedDao(5_000);
    _stake(id, alice, 10);
    _stake(id, bob, 60);
    _stake(id, carol, 30);
    _tick();
    uint256 p = _propose(id, alice, 0);

    _vote(p, alice, 1);
    _vote(p, bob, 2);
    _endVoting(p);
    assertEq(_state(p), uint256(IHupDao.ProposalState.Succeeded), "abstain fills quorum");
  }

  function test_tieIsDefeated() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 50);
    _stake(id, bob, 50);
    _tick();
    uint256 p = _propose(id, alice, 0);
    _vote(p, alice, 1);
    _vote(p, bob, 0);
    _endVoting(p);
    assertEq(_state(p), uint256(IHupDao.ProposalState.Defeated), "tie");
  }

  function test_multipleChoiceWinnerAndTie() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 50);
    _stake(id, bob, 30);
    _stake(id, carol, 30);
    _tick();

    uint256 p = _propose(id, alice, 3);
    assertEq(dao.getTallies(p).length, 3, "slots");
    _vote(p, alice, 2);
    _vote(p, bob, 0);
    _endVoting(p);
    assertEq(_state(p), uint256(IHupDao.ProposalState.Succeeded), "leader");

    uint256 q = _propose(id, alice, 4);
    _vote(q, bob, 1);
    _vote(q, carol, 3);
    _endVoting(q);
    assertEq(_state(q), uint256(IHupDao.ProposalState.Defeated), "top tie");

    uint256 r = _propose(id, alice, 2);
    vm.prank(alice);
    vm.expectRevert(IHupDao.InvalidOption.selector);
    dao.castVote(r, 2, "");
  }

  function test_invalidOptionCount() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 1);
    _tick();
    vm.prank(alice);
    vm.expectRevert(IHupDao.InvalidOptionCount.selector);
    dao.propose(id, META, 1);
    vm.prank(alice);
    vm.expectRevert(IHupDao.InvalidOptionCount.selector);
    dao.propose(id, META, 9);
  }

  function test_proposalThreshold() public {
    vm.prank(alice);
    uint256 id = dao.createDao(IHupDao.VotingMode.Staked, address(token), false, _settings(0, 0, 50), META, _noMembers());
    _stake(id, bob, 49);
    _tick();

    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(IHupDao.BelowProposalThreshold.selector, 49, 50));
    dao.propose(id, META, 0);
  }

  function test_votingDelayKeepsProposalPending() public {
    vm.prank(alice);
    uint256 id = dao.createDao(IHupDao.VotingMode.Staked, address(token), false, _settings(1 days, 0, 0), META, _noMembers());
    _stake(id, alice, 10);
    _tick();
    uint256 p = _propose(id, alice, 0);

    assertEq(_state(p), uint256(IHupDao.ProposalState.Pending), "pending");
    vm.prank(alice);
    vm.expectRevert(IHupDao.VotingNotActive.selector);
    dao.castVote(p, 1, "");

    vm.warp(block.timestamp + 1 days);
    _vote(p, alice, 1);
  }

  function test_settingsChangeDoesNotTouchOpenProposal() public {
    uint256 id = _stakedDao(1_000);
    _stake(id, alice, 100);
    _tick();
    uint256 p = _propose(id, alice, 0);

    vm.prank(alice);
    dao.updateSettings(id, _settings(0, 9_000, 0));
    assertEq(dao.getProposal(p).quorumVotes, 10, "frozen quorum");
  }

  function test_unstakeWorksWhilePaused() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);

    vm.prank(admin);
    dao.pause();

    token.mint(bob, 1);
    vm.startPrank(bob);
    token.approve(address(dao), 1);
    vm.expectRevert(EnforcedPause.selector);
    dao.stake(id, 1);
    vm.stopPrank();

    vm.prank(alice);
    dao.unstake(id, 100);
    assertEq(token.balanceOf(alice), 100, "withdrawn");
  }

  function test_wrongModeCalls() public {
    uint256 id = _stakedDao(0);
    vm.prank(alice);
    vm.expectRevert(IHupDao.WrongMode.selector);
    dao.addMembers(id, _members3());
    vm.prank(alice);
    vm.expectRevert(IHupDao.WrongMode.selector);
    dao.leaveDao(id);
  }

  function test_getProposalsNewestFirst() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 1);
    _tick();
    _propose(id, alice, 0);
    _propose(id, alice, 0);
    uint256 last = _propose(id, alice, 0);

    IHupDao.Proposal[] memory page = dao.getProposals(id, 0, 2);
    assertEq(page.length, 2, "len");
    assertEq(page[0].id, last, "newest first");
    assertEq(dao.getDao(id).proposalCount, 3, "count");
  }
}

contract HupDaoLsp7Test is DaoFixture {
  MockLSP7Pay internal lsp7;

  function setUp() public override {
    super.setUp();
    lsp7 = new MockLSP7Pay();
  }

  function test_lsp7StakeAndUnstake() public {
    vm.prank(alice);
    uint256 id = dao.createDao(IHupDao.VotingMode.Staked, address(lsp7), true, _settings(0, 0, 0), META, _noMembers());
    assertTrue(dao.getDao(id).isLsp7, "lsp7 flag");

    lsp7.mint(alice, 500);
    vm.startPrank(alice);
    lsp7.authorizeOperator(address(dao), 500);
    dao.stake(id, 500);
    vm.stopPrank();
    assertEq(dao.getVotes(id, alice), 500, "votes");
    assertEq(lsp7.balanceOf(address(dao)), 500, "escrow");

    vm.prank(alice);
    dao.unstake(id, 500);
    assertEq(lsp7.balanceOf(alice), 500, "returned");
  }

  function test_lsp7StakeWithoutOperatorReverts() public {
    vm.prank(alice);
    uint256 id = dao.createDao(IHupDao.VotingMode.Staked, address(lsp7), true, _settings(0, 0, 0), META, _noMembers());
    lsp7.mint(alice, 10);
    vm.prank(alice);
    vm.expectRevert(bytes("operator"));
    dao.stake(id, 10);
  }
}

contract HupDaoDelegationTest is DaoFixture {
  function test_delegatedPowerVotesOnce() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);
    _stake(id, bob, 20);
    vm.prank(alice);
    dao.delegate(id, bob);
    assertEq(dao.delegates(id, alice), bob, "delegate");
    assertEq(dao.getVotes(id, bob), 120, "bob power");
    assertEq(dao.getVotes(id, alice), 0, "alice power");
    _tick();

    uint256 p = _propose(id, bob, 0);
    _vote(p, bob, 1);
    assertEq(dao.getReceipt(p, bob).weight, 120, "weight");

    vm.prank(alice);
    vm.expectRevert(IHupDao.NoVotingPower.selector);
    dao.castVote(p, 0, "");
  }

  function test_delegationAfterSnapshotDoesNotMovePower() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);
    _tick();
    uint256 p = _propose(id, alice, 0);

    vm.prank(alice);
    dao.delegate(id, bob);
    vm.prank(bob);
    vm.expectRevert(IHupDao.NoVotingPower.selector);
    dao.castVote(p, 1, "");
    _vote(p, alice, 1);
  }

  function test_undelegateWithZeroAddress() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 100);
    vm.prank(alice);
    dao.delegate(id, bob);
    vm.prank(alice);
    dao.delegate(id, address(0));
    assertEq(dao.delegates(id, alice), alice, "self");
    assertEq(dao.getVotes(id, alice), 100, "back");
    assertEq(dao.getVotes(id, bob), 0, "bob");
  }

  function test_stakeAfterDelegatingFlowsToDelegate() public {
    uint256 id = _stakedDao(0);
    vm.prank(alice);
    dao.delegate(id, bob);
    _stake(id, alice, 70);
    assertEq(dao.getVotes(id, bob), 70, "flows");

    vm.prank(alice);
    dao.unstake(id, 70);
    assertEq(dao.getVotes(id, bob), 0, "drains");
  }

  function test_participantsTrackHoldersAndDelegates() public {
    uint256 id = _stakedDao(0);
    _stake(id, alice, 10);
    vm.prank(alice);
    dao.delegate(id, carol);
    assertEq(dao.participantCount(id), 2, "alice + carol");

    IHupDao.Participant[] memory rows = dao.getParticipants(id, 0, 10);
    assertEq(rows[0].account, alice, "alice row");
    assertEq(rows[0].delegate, carol, "alice delegate");
    assertEq(rows[1].votes, 10, "carol votes");

    vm.prank(alice);
    dao.unstake(id, 10);
    assertEq(dao.participantCount(id), 0, "emptied");
  }

  function test_delegateBySigEoa() public {
    uint256 pk = 0xA11CE;
    address signer = vm.addr(pk);
    uint256 id = _stakedDao(0);
    _stake(id, signer, 100);

    uint256 expiry = block.timestamp + 1 hours;
    bytes memory sig = _sign(pk, id, signer, bob, 0, expiry);

    // Anyone may relay it — the signature, not the caller, is the authority
    vm.prank(carol);
    dao.delegateBySig(id, signer, bob, 0, expiry, sig);
    assertEq(dao.getVotes(id, bob), 100, "delegated");

    vm.expectRevert();
    dao.delegateBySig(id, signer, bob, 0, expiry, sig);
  }

  function test_delegateBySigRejectsWrongSignerAndExpiry() public {
    uint256 id = _stakedDao(0);
    uint256 expiry = block.timestamp + 1 hours;
    bytes memory sig = _sign(0xB0B, id, alice, bob, 0, expiry);

    vm.expectRevert(IHupDao.InvalidSignature.selector);
    dao.delegateBySig(id, alice, bob, 0, expiry, sig);

    vm.warp(expiry + 1);
    vm.expectRevert(IHupDao.SignatureExpired.selector);
    dao.delegateBySig(id, alice, bob, 0, expiry, sig);
  }

  function _sign(uint256 pk, uint256 id, address delegator, address delegatee, uint256 nonce, uint256 expiry) internal view returns (bytes memory) {
    bytes32 structHash = keccak256(abi.encode(dao.DELEGATION_TYPEHASH(), id, delegator, delegatee, nonce, expiry));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash)));
    return abi.encodePacked(r, s, v);
  }

  function _domainSeparator() internal view returns (bytes32) {
    return keccak256(
      abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        keccak256(bytes("HupDao")),
        keccak256(bytes("1")),
        block.chainid,
        address(dao)
      )
    );
  }
}

contract HupDaoMembersTest is DaoFixture {
  function _membersDao(uint16 quorumBps) internal returns (uint256 id) {
    vm.prank(alice);
    id = dao.createDao(IHupDao.VotingMode.Members, address(0), false, _settings(0, quorumBps, 1), META, _members3());
  }

  function test_oneMemberOneVote() public {
    uint256 id = _membersDao(5_000);
    assertTrue(dao.isMember(id, bob), "member");
    assertEq(dao.getPastTotalVotes(id, block.timestamp), 3, "total");
    _tick();

    uint256 p = _propose(id, alice, 0);
    assertEq(dao.getProposal(p).quorumVotes, 1, "quorum of 3 at 50%");
    _vote(p, alice, 1);
    _vote(p, bob, 1);
    _vote(p, carol, 0);
    _endVoting(p);
    assertEq(_state(p), uint256(IHupDao.ProposalState.Succeeded), "2 vs 1");
    assertEq(dao.getProposal(p).voterCount, 3, "voters");
  }

  function test_memberAddedAfterSnapshotCannotVote() public {
    uint256 id = _membersDao(0);
    _tick();
    uint256 p = _propose(id, alice, 0);

    address[] memory late = new address[](1);
    late[0] = address(0xD0);
    vm.prank(alice);
    dao.addMembers(id, late);

    vm.prank(late[0]);
    vm.expectRevert(IHupDao.NoVotingPower.selector);
    dao.castVote(p, 1, "");
  }

  function test_memberDelegationLiquid() public {
    uint256 id = _membersDao(0);
    vm.prank(carol);
    dao.delegate(id, bob);
    assertEq(dao.getVotes(id, bob), 2, "bob carries carol");
    _tick();

    uint256 p = _propose(id, alice, 0);
    _vote(p, bob, 1);
    _vote(p, alice, 0);
    _endVoting(p);
    assertEq(_state(p), uint256(IHupDao.ProposalState.Succeeded), "2 vs 1");
  }

  function test_removeAndLeave() public {
    uint256 id = _membersDao(0);
    address[] memory gone = new address[](1);
    gone[0] = carol;

    vm.prank(bob);
    vm.expectRevert(IHupDao.NotDaoAdmin.selector);
    dao.removeMembers(id, gone);

    vm.prank(alice);
    dao.removeMembers(id, gone);
    assertFalse(dao.isMember(id, carol), "removed");

    vm.prank(bob);
    dao.leaveDao(id);
    assertEq(dao.getVotes(id, bob), 0, "left");

    vm.prank(bob);
    vm.expectRevert(IHupDao.NotMember.selector);
    dao.leaveDao(id);
  }

  function test_duplicateMemberReverts() public {
    uint256 id = _membersDao(0);
    address[] memory again = new address[](1);
    again[0] = bob;
    vm.prank(alice);
    vm.expectRevert(IHupDao.AlreadyMember.selector);
    dao.addMembers(id, again);
  }

  function test_cancelRules() public {
    vm.prank(alice);
    uint256 id = dao.createDao(IHupDao.VotingMode.Members, address(0), false, _settings(1 days, 0, 1), META, _members3());
    _tick();

    // Admin may clear a pending proposal...
    uint256 p = _propose(id, bob, 0);
    vm.prank(alice);
    dao.cancel(p);
    assertEq(_state(p), uint256(IHupDao.ProposalState.Canceled), "admin canceled pending");

    // ...but not one already being voted on
    uint256 q = _propose(id, bob, 0);
    vm.warp(block.timestamp + 1 days);
    vm.prank(alice);
    vm.expectRevert(IHupDao.NotCancelable.selector);
    dao.cancel(q);

    // The proposer still can, until the vote ends
    vm.prank(bob);
    dao.cancel(q);

    uint256 r = _propose(id, bob, 0);
    vm.prank(carol);
    vm.expectRevert(IHupDao.NotCancelable.selector);
    dao.cancel(r);
  }

  function test_nonMemberCannotPropose() public {
    uint256 id = _membersDao(0);
    _tick();
    vm.prank(address(0xD0));
    vm.expectRevert(abi.encodeWithSelector(IHupDao.BelowProposalThreshold.selector, 0, 1));
    dao.propose(id, META, 0);
  }
}

contract HupDaoVotesTokenTest is DaoFixture {
  MockVotesToken internal votesToken;

  function setUp() public override {
    super.setUp();
    votesToken = new MockVotesToken();
  }

  function test_readsTokenCheckpointsOnBlockClock() public {
    vm.prank(alice);
    uint256 id = dao.createDao(IHupDao.VotingMode.VotesToken, address(votesToken), false, _settings(0, 1_000, 1), META, _noMembers());

    votesToken.mint(alice, 300);
    votesToken.mint(bob, 700);
    vm.prank(alice);
    votesToken.delegate(alice);
    vm.prank(bob);
    votesToken.delegate(bob);
    _tick();

    assertEq(dao.clock(id), block.number, "block clock");
    uint256 p = _propose(id, alice, 0);
    assertEq(dao.getProposal(p).snapshot, block.number - 1, "snapshot");
    assertEq(dao.getProposal(p).quorumVotes, 100, "10% of 1000");

    _vote(p, alice, 1);
    assertEq(dao.getReceipt(p, alice).weight, 300, "weight");

    // Moving tokens after the snapshot gives the receiver nothing for this proposal
    vm.prank(bob);
    votesToken.transfer(carol, 700);
    vm.prank(carol);
    votesToken.delegate(carol);
    _tick();
    vm.prank(carol);
    vm.expectRevert(IHupDao.NoVotingPower.selector);
    dao.castVote(p, 0, "");
    _vote(p, bob, 0);

    _endVoting(p);
    assertEq(_state(p), uint256(IHupDao.ProposalState.Defeated), "700 against");
  }

  function test_delegationHappensOnToken() public {
    vm.prank(alice);
    uint256 id = dao.createDao(IHupDao.VotingMode.VotesToken, address(votesToken), false, _settings(0, 0, 0), META, _noMembers());
    vm.prank(alice);
    vm.expectRevert(IHupDao.DelegationOnToken.selector);
    dao.delegate(id, bob);
  }

  function test_rejectsNonVotesToken() public {
    vm.expectRevert(IHupDao.InvalidToken.selector);
    dao.createDao(IHupDao.VotingMode.VotesToken, address(token), false, _settings(0, 0, 0), META, _noMembers());
  }
}

contract HupDaoWalletTest is DaoFixture {
  function test_universalProfileStakesVotesAndSigns() public {
    uint256 pk = 0xC0FFEE;
    address controllerKey = vm.addr(pk);
    MockUniversalProfile up = new MockUniversalProfile(controllerKey);
    uint256 id = _stakedDao(0);

    token.mint(address(up), 100);
    vm.startPrank(controllerKey);
    up.execute(address(token), abi.encodeCall(MockERC20.approve, (address(dao), 100)));
    up.execute(address(dao), abi.encodeCall(HupDao.stake, (id, 100)));
    vm.stopPrank();
    assertEq(dao.getVotes(id, address(up)), 100, "UP holds the power, not its key");
    assertEq(dao.getVotes(id, controllerKey), 0, "key has none");
    _tick();

    vm.startPrank(controllerKey);
    uint256 p = abi.decode(up.execute(address(dao), abi.encodeCall(HupDao.propose, (id, META, 0))), (uint256));
    assertEq(dao.getProposal(p).proposer, address(up), "UP is the proposer");
    up.execute(address(dao), abi.encodeCall(HupDao.castVote, (p, 1, "from a UP")));
    vm.stopPrank();
    assertTrue(dao.getReceipt(p, address(up)).hasVoted, "UP voted");

    // ERC-1271 delegation: the UP is the delegator, its controller signs
    uint256 expiry = block.timestamp + 1 hours;
    bytes32 structHash = keccak256(abi.encode(dao.DELEGATION_TYPEHASH(), id, address(up), bob, uint256(0), expiry));
    bytes32 domain = keccak256(
      abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        keccak256(bytes("HupDao")),
        keccak256(bytes("1")),
        block.chainid,
        address(dao)
      )
    );
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    dao.delegateBySig(id, address(up), bob, 0, expiry, abi.encodePacked(r, s, v));
    assertEq(dao.getVotes(id, bob), 100, "UP delegated by 1271");

    vm.prank(controllerKey);
    up.execute(address(dao), abi.encodeCall(HupDao.delegate, (id, address(0))));
    vm.prank(controllerKey);
    up.execute(address(dao), abi.encodeCall(HupDao.unstake, (id, 100)));
    assertEq(token.balanceOf(address(up)), 100, "paid back to the UP");
  }

  function test_trustedForwarderAttributesToSigner() public {
    vm.prank(alice);
    uint256 id = dao.createDao(IHupDao.VotingMode.Members, address(0), false, _settings(0, 0, 1), META, _members3());
    _tick();
    uint256 p = _propose(id, alice, 0);

    fwd.forward(address(dao), abi.encodeCall(HupDao.castVote, (p, 1, "")), bob);
    assertTrue(dao.getReceipt(p, bob).hasVoted, "relayed vote is bob's");
    assertFalse(dao.getReceipt(p, address(fwd)).hasVoted, "not the forwarder's");
  }

  function test_moderatorHidesWithoutTouchingVotes() public {
    vm.prank(alice);
    uint256 id = dao.createDao(IHupDao.VotingMode.Members, address(0), false, _settings(0, 0, 1), META, _members3());
    _tick();
    uint256 p = _propose(id, alice, 0);

    vm.prank(bob);
    vm.expectRevert(IHupDao.Unauthorized.selector);
    dao.setProposalHidden(p, true);

    vm.prank(admin);
    dao.setProposalHidden(p, true);
    assertTrue(dao.getProposal(p).hidden, "hidden");
    _vote(p, bob, 1);
  }
}
