// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./Fixture.sol";
import { IHupDrops } from "../../v2/Extensions/IHupDrops.sol";

contract HupDropsMintPaymentTest is DropsFixture {
  function test_mint_freePhase() external {
    (uint256 dropId, address coll) = _simple721(0, 100, 0);
    _mintAs(minter, dropId, 0, 2, 0);

    assertEq(engine.getDrop(dropId).minted, 2, "drop counter");
    assertEq(HupDropCollection721(coll).totalMinted(), 2, "collection counter");
    assertEq(HupDropCollection721(coll).ownerOf(1), minter, "token 1");
    assertEq(HupDropCollection721(coll).ownerOf(2), minter, "token 2");
  }

  function test_mint_nativeExactPaymentRequired() external {
    (uint256 dropId, ) = _simple721(1 ether, 100, 0);

    vm.prank(minter);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.InsufficientPayment.selector, 0.5 ether, 2 ether));
    engine.mint{ value: 0.5 ether }(address(0), dropId, 0, 2, address(0));

    vm.prank(minter);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.InsufficientPayment.selector, 3 ether, 2 ether));
    engine.mint{ value: 3 ether }(address(0), dropId, 0, 2, address(0));
  }

  function test_mint_paidGoesToCreatorWholeWithoutFees() external {
    (uint256 dropId, ) = _simple721(1 ether, 100, 0);
    uint256 before = creator.balance;

    _mintAs(minter, dropId, 0, 3, 3 ether);
    assertEq(creator.balance - before, 3 ether, "creator got all");
    assertEq(address(engine).balance, 0, "engine holds nothing");
  }

  function test_mint_feeBpsAndReferralSplit() external {
    vm.prank(admin);
    engine.setMintFeeBps(250); // 2.5%
    (uint256 dropId, ) = _simple721(1 ether, 100, 1_000); // 10% referral

    uint256 creatorBefore = creator.balance;
    vm.prank(minter);
    engine.mint{ value: 3 ether }(address(0), dropId, 0, 3, referrer);

    assertEq(address(engine).balance, 0.075 ether, "platform fee retained");
    assertEq(referrer.balance, 0.3 ether, "referral share");
    assertEq(creator.balance - creatorBefore, 2.625 ether, "creator remainder");
  }

  function test_mint_referralRules() external {
    (uint256 noRefDrop, ) = _simple721(1 ether, 100, 0);
    vm.prank(minter);
    vm.expectRevert(IHupDrops.InvalidReferral.selector);
    engine.mint{ value: 1 ether }(address(0), noRefDrop, 0, 1, referrer); // drop pays no referral

    (uint256 dropId, ) = _simple721(1 ether, 100, 1_000);
    vm.prank(minter);
    vm.expectRevert(IHupDrops.InvalidReferral.selector);
    engine.mint{ value: 1 ether }(address(0), dropId, 0, 1, minter); // self

    vm.prank(minter);
    vm.expectRevert(IHupDrops.InvalidReferral.selector);
    engine.mint{ value: 1 ether }(address(0), dropId, 0, 1, creator); // creator
  }

  function test_mint_flatFeeRidesOnTop() external {
    vm.startPrank(admin);
    engine.setMintFee(0.01 ether);
    engine.setMintFeeEnabled(true);
    vm.stopPrank();

    (uint256 freeDrop, ) = _simple721(0, 100, 0);
    vm.prank(minter);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.InsufficientPayment.selector, 0, 0.03 ether));
    engine.mint(address(0), freeDrop, 0, 3, address(0));

    uint256 creatorBefore = creator.balance;
    _mintAs(minter, freeDrop, 0, 3, 0.03 ether);
    assertEq(address(engine).balance, 0.03 ether, "flat fee retained");
    assertEq(creator.balance, creatorBefore, "free stays free for creator");

    // Disabling keeps the configured amount but stops charging.
    vm.prank(admin);
    engine.setMintFeeEnabled(false);
    _mintAs(minter, freeDrop, 0, 1, 0);
    assertEq(engine.mintFee(), 0.01 ether, "amount preserved");
  }

  function test_mint_tokenPhaseErc20() external {
    MockERC20 token = new MockERC20();
    token.mint(minter, 100 ether);

    IHupDrops.PhaseInput memory p = _openPhase(2 ether);
    p.token = address(token);
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 1_000, _one(p));

    vm.prank(admin);
    engine.setMintFeeBps(500); // 5%

    vm.prank(minter);
    token.approve(address(engine), 100 ether);

    // A token phase must not carry native value beyond the flat fee (0 here).
    vm.prank(minter);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.InsufficientPayment.selector, 1 ether, 0));
    engine.mint{ value: 1 ether }(address(0), dropId, 0, 1, address(0));

    vm.prank(minter);
    engine.mint(address(0), dropId, 0, 2, referrer);

    // 4 ether total: 5% fee = 0.2, 10% referral = 0.4, creator 3.4.
    assertEq(token.balanceOf(address(engine)), 0.2 ether, "token fee held by engine");
    assertEq(token.balanceOf(referrer), 0.4 ether, "token referral");
    assertEq(token.balanceOf(creator), 3.4 ether, "token creator share");
    assertEq(token.balanceOf(minter), 96 ether, "minter debited");
  }

  function test_mint_tokenPhaseWithoutApprovalReverts() external {
    MockERC20 token = new MockERC20();
    token.mint(minter, 100 ether);

    IHupDrops.PhaseInput memory p = _openPhase(1 ether);
    p.token = address(token);
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    vm.prank(minter);
    vm.expectRevert();
    engine.mint(address(0), dropId, 0, 1, address(0));
  }

  function test_mint_tokenPhaseLsp7() external {
    MockLSP7Pay token = new MockLSP7Pay();
    token.mint(minter, 10 ether);

    IHupDrops.PhaseInput memory p = _openPhase(1 ether);
    p.token = address(token);
    p.isLsp7 = true;
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    vm.prank(minter);
    vm.expectRevert();
    engine.mint(address(0), dropId, 0, 1, address(0)); // no operator authorization yet

    vm.prank(minter);
    token.authorizeOperator(address(engine), 10 ether);
    vm.prank(minter);
    engine.mint(address(0), dropId, 0, 2, address(0));

    assertEq(token.balanceOf(creator), 2 ether, "lsp7 creator share");
    assertEq(token.balanceOf(minter), 8 ether, "lsp7 minter debited");
  }

  function test_mint_payoutRedirectAndBrickedDestination() external {
    (uint256 dropId, ) = _simple721(1 ether, 100, 0);

    address dest = address(0xDE57);
    vm.prank(creator);
    engine.setPayoutDestination(dropId, dest);

    uint256 creatorBefore = creator.balance;
    _mintAs(minter, dropId, 0, 1, 1 ether);
    assertEq(dest.balance, 1 ether, "redirected");
    assertEq(creator.balance, creatorBefore, "creator skipped");

    // A destination that cannot receive native blocks mints…
    RejectingReceiver bad = new RejectingReceiver();
    vm.prank(creator);
    engine.setPayoutDestination(dropId, address(bad));
    vm.prank(minter);
    vm.expectRevert(IHupDrops.TransferFailed.selector);
    engine.mint{ value: 1 ether }(address(0), dropId, 0, 1, address(0));

    // …and clearing it back to the creator fixes the sale in one tx.
    vm.prank(creator);
    engine.setPayoutDestination(dropId, address(0));
    _mintAs(minter, dropId, 0, 1, 1 ether);
    assertEq(creator.balance - creatorBefore, 1 ether, "creator paid after fix");
  }

  function test_setPayoutDestination_requiresDirectCreator() external {
    (uint256 dropId, ) = _simple721(1 ether, 100, 0);

    // Burner session must NOT be able to redirect revenue.
    hup.setSession(creator, burner, block.timestamp + 1 hours);
    vm.prank(burner);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setPayoutDestination(dropId, burner);

    // Neither may a forwarder-relayed creator.
    bytes memory data = abi.encodeWithSelector(engine.setPayoutDestination.selector, dropId, stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    fwd.forward(address(engine), data, creator);

    vm.prank(creator);
    engine.setPayoutDestination(dropId, stranger);
    assertEq(engine.payoutDestination(dropId), stranger, "direct creator works");
  }
}

contract HupDropsMintLimitTest is DropsFixture {
  function test_mint_quantityBounds() external {
    (uint256 dropId, ) = _simple721(0, 0, 0); // open edition

    vm.prank(minter);
    vm.expectRevert(IHupDrops.InvalidAmount.selector);
    engine.mint(address(0), dropId, 0, 0, address(0));

    vm.prank(minter);
    vm.expectRevert(IHupDrops.InvalidAmount.selector);
    engine.mint(address(0), dropId, 0, 101, address(0));

    _mintAs(minter, dropId, 0, 100, 0); // MAX_PER_TX exactly
    assertEq(engine.getDrop(dropId).minted, 100, "hundred minted");
  }

  function test_mint_supplyExceededWithRemainder() external {
    (uint256 dropId, ) = _simple721(0, 5, 0);
    _mintAs(minter, dropId, 0, 3, 0);

    vm.prank(minter);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.SupplyExceeded.selector, 3, 2));
    engine.mint(address(0), dropId, 0, 3, address(0));

    _mintAs(minter, dropId, 0, 2, 0); // exact remainder fine
    assertEq(engine.getDrop(dropId).minted, 5, "sold out");
  }

  function test_mint_allocationExceededWithRemainder() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.allocation = 4;
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    _mintAs(minter, dropId, 0, 3, 0);
    vm.prank(minter);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.AllocationExceeded.selector, 2, 1));
    engine.mint(address(0), dropId, 0, 2, address(0));
  }

  function test_mint_perWalletSharedAcrossSessionAndPrimary() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.perWallet = 2;
    (uint256 dropId, address coll) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    hup.setSession(primary, burner, block.timestamp + 1 hours);

    // Burner mints on the primary's behalf: token lands on the primary, limit counts there.
    vm.prank(burner);
    engine.mint(primary, dropId, 0, 1, address(0));
    assertEq(HupDropCollection721(coll).ownerOf(1), primary, "minted to primary");
    assertEq(engine.mintedInPhaseBy(dropId, 0, primary), 1, "counted on primary");
    assertEq(engine.mintedInPhaseBy(dropId, 0, burner), 0, "not on burner");

    vm.prank(primary);
    engine.mint(address(0), dropId, 0, 1, address(0));

    vm.prank(primary);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.WalletLimitReached.selector, 2));
    engine.mint(address(0), dropId, 0, 1, address(0));

    vm.prank(burner);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.WalletLimitReached.selector, 2));
    engine.mint(primary, dropId, 0, 1, address(0)); // burner cannot reset the limit
  }

  function test_mint_sessionAuthEnforced() external {
    (uint256 dropId, ) = _simple721(0, 10, 0);

    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.mint(primary, dropId, 0, 1, address(0)); // not the primary's burner

    hup.setSession(primary, burner, block.timestamp - 1);
    vm.prank(burner);
    vm.expectRevert(IHupDrops.SessionExpired.selector);
    engine.mint(primary, dropId, 0, 1, address(0));
  }

  function test_mint_windowBoundaries() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.startTime = uint64(block.timestamp + 100);
    p.endTime = uint64(block.timestamp + 200);
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    vm.prank(minter);
    vm.expectRevert(IHupDrops.PhaseNotActive.selector);
    engine.mint(address(0), dropId, 0, 1, address(0)); // before start

    vm.warp(p.startTime);
    _mintAs(minter, dropId, 0, 1, 0); // at startTime: open

    vm.warp(p.endTime);
    vm.prank(minter);
    vm.expectRevert(IHupDrops.PhaseNotActive.selector);
    engine.mint(address(0), dropId, 0, 1, address(0)); // at endTime: closed
  }

  function test_mint_unknownDropAndPhase() external {
    vm.prank(minter);
    vm.expectRevert(IHupDrops.DropNotFound.selector);
    engine.mint(address(0), 42, 0, 1, address(0));

    (uint256 dropId, ) = _simple721(0, 10, 0);
    vm.prank(minter);
    vm.expectRevert(IHupDrops.PhaseNotFound.selector);
    engine.mint(address(0), dropId, 7, 1, address(0));
  }

  function test_mint_contiguousIdsAcrossMints() external {
    (uint256 dropId, address coll) = _simple721(0, 100, 0);
    _mintAs(minter, dropId, 0, 2, 0);
    _mintAs(stranger, dropId, 0, 3, 0);

    assertEq(HupDropCollection721(coll).ownerOf(2), minter, "first range");
    assertEq(HupDropCollection721(coll).ownerOf(3), stranger, "second range starts at 3");
    assertEq(HupDropCollection721(coll).ownerOf(5), stranger, "second range ends at 5");
  }

  function test_isMintable_matchesMint() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.perWallet = 1;
    p.gate = IHupDrops.GateType.Allowlist;
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    assertFalse(engine.isMintable(dropId, 0, minter, 1), "gate closed");
    vm.prank(creator);
    engine.setAllowlisted(dropId, minter, true);
    assertTrue(engine.isMintable(dropId, 0, minter, 1), "gate open");
    assertFalse(engine.isMintable(dropId, 0, minter, 2), "over perWallet");

    _mintAs(minter, dropId, 0, 1, 0);
    assertFalse(engine.isMintable(dropId, 0, minter, 1), "limit spent");
    assertFalse(engine.isMintable(99, 0, minter, 1), "unknown drop");
  }
}

contract HupDropsMintGateTest is DropsFixture {
  function test_gate_allowlist() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.gate = IHupDrops.GateType.Allowlist;
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    vm.prank(minter);
    vm.expectRevert(IHupDrops.GateNotPassed.selector);
    engine.mint(address(0), dropId, 0, 1, address(0));

    vm.prank(creator);
    engine.setAllowlisted(dropId, minter, true);
    _mintAs(minter, dropId, 0, 1, 0);
    assertEq(engine.getDrop(dropId).minted, 1, "listed wallet mints");
  }

  function test_gate_followers() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.gate = IHupDrops.GateType.Followers;
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    vm.prank(minter);
    vm.expectRevert(IHupDrops.GateNotPassed.selector);
    engine.mint(address(0), dropId, 0, 1, address(0));

    followers.setFollowing(minter, creator, true);
    _mintAs(minter, dropId, 0, 1, 0);
    assertEq(engine.getDrop(dropId).minted, 1, "follower mints");
  }

  function test_gate_communityMembershipAndBan() external {
    uint256 communityId = 7;
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.gate = IHupDrops.GateType.Community;
    p.gateData = bytes32(communityId);
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    vm.prank(minter);
    vm.expectRevert(IHupDrops.GateNotPassed.selector);
    engine.mint(address(0), dropId, 0, 1, address(0)); // not a member

    community.setMember(communityId, minter, true, true);
    vm.prank(minter);
    vm.expectRevert(IHupDrops.GateNotPassed.selector);
    engine.mint(address(0), dropId, 0, 1, address(0)); // banned member

    community.setMember(communityId, minter, true, false);
    _mintAs(minter, dropId, 0, 1, 0);
    assertEq(engine.getDrop(dropId).minted, 1, "member mints");
  }

  function test_gate_assetHolders() external {
    MockGate asset = new MockGate();
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.gate = IHupDrops.GateType.AssetHolders;
    p.gateAsset = address(asset);
    p.gateMin = 5;
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    asset.set(minter, 4);
    vm.prank(minter);
    vm.expectRevert(IHupDrops.GateNotPassed.selector);
    engine.mint(address(0), dropId, 0, 1, address(0));

    asset.set(minter, 5);
    _mintAs(minter, dropId, 0, 1, 0);
    assertEq(engine.getDrop(dropId).minted, 1, "holder mints at exactly gateMin");
  }

  function test_gate_assetHolders1155IsIdScoped() external {
    Mock1155Gate asset = new Mock1155Gate();
    uint256 gateId = 3;
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.gate = IHupDrops.GateType.AssetHolders1155;
    p.gateAsset = address(asset);
    p.gateData = bytes32(gateId);
    p.gateMin = 2;
    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 100, 0, _one(p));

    asset.set(minter, 9, 10); // wrong id
    vm.prank(minter);
    vm.expectRevert(IHupDrops.GateNotPassed.selector);
    engine.mint(address(0), dropId, 0, 1, address(0));

    asset.set(minter, gateId, 2);
    _mintAs(minter, dropId, 0, 1, 0);
    assertEq(engine.getDrop(dropId).minted, 1, "id-scoped balance passes");
  }
}

contract HupDropsMintMetaTxAndReentrancyTest is DropsFixture {
  function test_mint_viaTrustedForwarder() external {
    (uint256 dropId, address coll) = _simple721(1 ether, 100, 0);

    bytes memory data = abi.encodeWithSelector(engine.mint.selector, address(0), dropId, 0, uint256(1), address(0));
    fwd.forward{ value: 1 ether }(address(engine), data, minter);

    assertEq(HupDropCollection721(coll).ownerOf(1), minter, "relayed sender is the minter");
    assertEq(engine.mintedInPhaseBy(dropId, 0, minter), 1, "counted on relayed sender");
  }

  function test_mint_untrustedForwarderIsItselfTheSender() external {
    (uint256 dropId, address coll) = _simple721(0, 100, 0);
    Forwarder rogue = new Forwarder();

    bytes memory data = abi.encodeWithSelector(engine.mint.selector, address(0), dropId, 0, uint256(1), address(0));
    rogue.forward(address(engine), data, minter);

    // The suffix is ignored: the rogue forwarder minted for itself, not for the victim.
    assertEq(HupDropCollection721(coll).ownerOf(1), address(rogue), "suffix not honoured");
    assertEq(engine.mintedInPhaseBy(dropId, 0, minter), 0, "victim untouched");
  }

  function test_mint_reentrancyViaPayoutDestinationBlocked() external {
    (uint256 dropId, ) = _createDrop(
      STANDARD_721,
      _params721(),
      100,
      0,
      _two(_openPhase(1 ether), _openPhase(0)) // paid phase 0, free phase 1 for the reentry attempt
    );

    ReentrantPayout attacker = new ReentrantPayout(address(engine));
    attacker.arm(dropId, 1, true); // swallow: prove the guard, let the outer mint finish
    vm.prank(creator);
    engine.setPayoutDestination(dropId, address(attacker));

    _mintAs(minter, dropId, 0, 1, 1 ether);
    assertTrue(attacker.attempted(), "attacker ran inside the push");
    assertFalse(attacker.reentered(), "reentrancy blocked");
    assertEq(engine.getDrop(dropId).minted, 1, "only the outer mint landed");
    assertEq(address(attacker).balance, 1 ether, "payout still delivered");

    // Bubbling variant: the failed reentry reverts the whole mint.
    attacker.arm(dropId, 1, false);
    vm.prank(minter);
    vm.expectRevert(IHupDrops.TransferFailed.selector);
    engine.mint{ value: 1 ether }(address(0), dropId, 0, 1, address(0));
  }

  function test_mint_reentrancyVia1155ReceiverBlocked() external {
    (uint256 dropId, ) = _simple1155(0, 100);

    Reentrant1155Minter attacker = new Reentrant1155Minter(address(engine));
    attacker.arm(dropId, 0);
    attacker.doMint(2);

    assertTrue(attacker.attempted(), "receiver hook ran");
    assertFalse(attacker.reentered(), "reentrancy blocked");
    assertEq(engine.getDrop(dropId).minted, 2, "only the outer mint landed");
  }

  function test_mint_erc721UnsafeMintReachesPlainContract() external {
    (uint256 dropId, address coll) = _simple721(0, 100, 0);
    PlainContract receiver = new PlainContract();

    vm.prank(address(receiver));
    engine.mint(address(0), dropId, 0, 1, address(0));
    assertEq(HupDropCollection721(coll).ownerOf(1), address(receiver), "unsafe mint cannot be blocked");
  }

  function test_mint_erc1155ToNonReceiverContractReverts() external {
    (uint256 dropId, ) = _simple1155(0, 100);
    PlainContract receiver = new PlainContract();

    vm.prank(address(receiver));
    vm.expectRevert();
    engine.mint(address(0), dropId, 0, 1, address(0)); // ERC1155 acceptance check is the standard's own constraint
  }
}
