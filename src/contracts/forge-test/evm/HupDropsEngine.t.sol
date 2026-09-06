// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./Fixture.sol";
import { HupDrops } from "../../v2/Extensions/HupDrops.sol";
import { IHupDrops } from "../../v2/Extensions/IHupDrops.sol";

contract HupDropsCreateTest is DropsFixture {
  function test_createDrop_deploys721AndStoresDrop() external {
    (uint256 dropId, address coll) = _simple721(1 ether, 100, 0);

    assertEq(dropId, 1, "first drop id");
    assertEq(engine.dropCount(), 1, "dropCount");
    assertEq(engine.dropIdOf(coll), dropId, "reverse lookup");

    IHupDrops.Drop memory drop = engine.getDrop(dropId);
    assertEq(drop.collection, coll, "collection");
    assertEq(drop.creator, creator, "creator");
    assertEq(drop.standardId, STANDARD_721, "standard");
    assertEq(drop.maxSupply, 100, "maxSupply");
    assertEq(drop.minted, 0, "minted");
    assertEq(drop.closed, false, "closed");

    HupDropCollection721 c = HupDropCollection721(coll);
    assertEq(c.owner(), creator, "collection owner is creator");
    assertEq(c.drops(), address(engine), "collection minter is engine");
    assertEq(c.maxSupply(), 100, "collection cap");
    assertEq(c.name(), "Drop 721", "name");
    assertEq(c.symbol(), "D721", "symbol");
  }

  function test_createDrop_secondDropIncrementsId() external {
    _simple721(0, 10, 0);
    (uint256 dropId2, ) = _simple1155(0, 10);
    assertEq(dropId2, 2, "second drop id");
  }

  function test_createDrop_unregisteredStandardReverts() external {
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidStandard.selector);
    engine.createDrop(address(0), 9, _params721(), 10, 0, false, _one(_openPhase(0)), _noSplits());
  }

  function test_createDrop_referralBpsCapReverts() external {
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidReferralBps.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 5_001, false, _one(_openPhase(0)), _noSplits());
  }

  function test_createDrop_zeroOrTooManyPhasesReverts() external {
    IHupDrops.PhaseInput[] memory none = new IHupDrops.PhaseInput[](0);
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidPhases.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, none, _noSplits());

    IHupDrops.PhaseInput[] memory nine = new IHupDrops.PhaseInput[](9);
    for (uint256 i = 0; i < 9; i++) nine[i] = _openPhase(0);
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidPhases.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, nine, _noSplits());
  }

  function test_createDrop_creationFeeExact() external {
    vm.prank(admin);
    engine.setCreationFee(0.1 ether);

    vm.prank(creator);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.InsufficientPayment.selector, 0, 0.1 ether));
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(_openPhase(0)), _noSplits());

    vm.prank(creator);
    engine.createDrop{ value: 0.1 ether }(address(0), STANDARD_721, _params721(), 10, 0, false, _one(_openPhase(0)), _noSplits());
    assertEq(address(engine).balance, 0.1 ether, "fee retained");
  }

  // --- Followers gate ---

  function test_followersGate_namedAccount() external {
    // The creator follows nobody; the drop gates on a company account instead
    address company = address(0xC0FFEE);
    IHupDrops.PhaseInput memory phase = _openPhase(0);
    phase.gate = IHupDrops.GateType.Followers;
    phase.gateAsset = company;

    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 10, 0, _one(phase));

    followers.setFollowing(minter, company, true);
    assertTrue(engine.isMintable(dropId, 0, minter, 1), "a follower of the named account may mint");

    followers.setFollowing(stranger, creator, true);
    assertFalse(engine.isMintable(dropId, 0, stranger, 1), "following the creator is not enough");

    vm.deal(minter, 1 ether);
    _mintAs(minter, dropId, 0, 1, 0);
  }

  function test_followersGate_unsetStillMeansCreator() external {
    IHupDrops.PhaseInput memory phase = _openPhase(0);
    phase.gate = IHupDrops.GateType.Followers;
    // gateAsset left at zero — every drop made before the account could be named looks like this

    (uint256 dropId, ) = _createDrop(STANDARD_721, _params721(), 10, 0, _one(phase));

    assertFalse(engine.isMintable(dropId, 0, minter, 1), "not following the creator yet");
    followers.setFollowing(minter, creator, true);
    assertTrue(engine.isMintable(dropId, 0, minter, 1), "following the creator is what an unset gate means");

    _mintAs(minter, dropId, 0, 1, 0);
  }

  // --- Featured tier ---

  function test_createDrop_featuredChargesBothFees() external {
    vm.prank(admin);
    engine.setCreationFee(0.1 ether);
    vm.prank(admin);
    engine.setFeaturedFee(0.4 ether);

    // The surcharge rides on top of the creation fee, so neither alone is enough
    vm.prank(creator);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.InsufficientPayment.selector, 0.1 ether, 0.5 ether));
    engine.createDrop{ value: 0.1 ether }(address(0), STANDARD_721, _params721(), 10, 0, true, _one(_openPhase(0)), _noSplits());

    vm.prank(creator);
    (uint256 dropId, ) = engine.createDrop{ value: 0.5 ether }(
      address(0),
      STANDARD_721,
      _params721(),
      10,
      0,
      true,
      _one(_openPhase(0)),
      _noSplits()
    );

    assertTrue(engine.getDrop(dropId).featured, "featured at creation");
    assertEq(address(engine).balance, 0.5 ether, "both fees retained");
  }

  function test_createDrop_unfeaturedRejectsSurcharge() external {
    vm.prank(admin);
    engine.setFeaturedFee(0.4 ether);

    // Paying the surcharge without asking for the tier would buy nothing
    vm.prank(creator);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.InsufficientPayment.selector, 0.4 ether, 0));
    engine.createDrop{ value: 0.4 ether }(address(0), STANDARD_721, _params721(), 10, 0, false, _one(_openPhase(0)), _noSplits());
  }

  function test_createDrop_featuredFreeWhenFeeUnset() external {
    vm.prank(creator);
    (uint256 dropId, ) = engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, true, _one(_openPhase(0)), _noSplits());
    assertTrue(engine.getDrop(dropId).featured, "featured with the fee at zero");
  }

  function test_featureDrop_later() external {
    (uint256 dropId, ) = _simple721(0, 10, 0);
    assertFalse(engine.getDrop(dropId).featured, "starts unfeatured");

    vm.prank(admin);
    engine.setFeaturedFee(0.25 ether);

    vm.deal(creator, 1 ether);
    vm.prank(creator);
    engine.featureDrop{ value: 0.25 ether }(address(0), dropId);

    assertTrue(engine.getDrop(dropId).featured, "featured after the fact");
    assertEq(address(engine).balance, 0.25 ether, "surcharge retained");
  }

  function test_featureDrop_twiceReverts() external {
    (uint256 dropId, ) = _simple721(0, 10, 0);
    vm.prank(creator);
    engine.featureDrop(address(0), dropId);

    // Not a subscription: a second payment would buy nothing and be unrecoverable
    vm.prank(creator);
    vm.expectRevert(IHupDrops.AlreadyFeatured.selector);
    engine.featureDrop(address(0), dropId);
  }

  function test_featureDrop_closedDropReverts() external {
    (uint256 dropId, ) = _simple721(0, 10, 0);
    vm.prank(creator);
    engine.closeDrop(dropId);

    // Every featured surface filters closed drops out, so the fee would buy nothing
    vm.prank(creator);
    vm.expectRevert(IHupDrops.DropNotActive.selector);
    engine.featureDrop(address(0), dropId);
  }

  function test_featureDrop_onlyCreator() external {
    (uint256 dropId, ) = _simple721(0, 10, 0);

    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.featureDrop(address(0), dropId);
  }

  function test_featureDrop_wrongValueReverts() external {
    (uint256 dropId, ) = _simple721(0, 10, 0);
    vm.prank(admin);
    engine.setFeaturedFee(0.25 ether);

    vm.deal(creator, 1 ether);
    vm.prank(creator);
    vm.expectRevert(abi.encodeWithSelector(IHupDrops.InsufficientPayment.selector, 0.1 ether, 0.25 ether));
    engine.featureDrop{ value: 0.1 ether }(address(0), dropId);
  }

  function test_featureDrop_unknownDropReverts() external {
    vm.prank(creator);
    vm.expectRevert(IHupDrops.DropNotFound.selector);
    engine.featureDrop(address(0), 999);
  }

  function test_setFeaturedFee_onlyAdmin() external {
    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setFeaturedFee(1 ether);

    vm.prank(admin);
    engine.setFeaturedFee(1 ether);
    assertEq(engine.featuredFee(), 1 ether, "featured fee set");
  }

  function test_createDrop_viaSessionKey() external {
    hup.setSession(primary, burner, block.timestamp + 1 hours);

    vm.prank(burner);
    (uint256 dropId, ) = engine.createDrop(primary, STANDARD_721, _params721(), 10, 0, false, _one(_openPhase(0)), _noSplits());

    assertEq(engine.getDrop(dropId).creator, primary, "creator is primary, not burner");
  }

  function test_createDrop_sessionWrongOrExpiredReverts() external {
    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.createDrop(primary, STANDARD_721, _params721(), 10, 0, false, _one(_openPhase(0)), _noSplits());

    hup.setSession(primary, burner, block.timestamp - 1);
    vm.prank(burner);
    vm.expectRevert(IHupDrops.SessionExpired.selector);
    engine.createDrop(primary, STANDARD_721, _params721(), 10, 0, false, _one(_openPhase(0)), _noSplits());
  }

  function test_createDrop_phaseNameTooLongReverts() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.name = "0123456789012345678901234567890123456789012345678901234567890123X"; // 65 bytes
    vm.prank(creator);
    vm.expectRevert(IHupDrops.PhaseNameTooLong.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(p), _noSplits());
  }

  function test_createDrop_invertedWindowReverts() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.startTime = 100;
    p.endTime = 100;
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidPhases.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(p), _noSplits());
  }

  function test_createDrop_allocationAboveSupplyReverts() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.allocation = 11;
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidPhases.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(p), _noSplits());
  }

  function test_createDrop_freePhaseWithTokenReverts() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.token = address(0xBEEF);
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidPaymentToken.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(p), _noSplits());
  }

  function test_createDrop_followersGateWithoutSystemReverts() external {
    HupDrops bare = new HupDrops(address(hup), address(0), admin, address(0));
    HupDropsDeployer721 bareDeployer = new HupDropsDeployer721(address(bare));
    vm.prank(admin);
    bare.setDeployer(STANDARD_721, address(bareDeployer));

    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.gate = IHupDrops.GateType.Followers;
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidGateConfig.selector);
    bare.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(p), _noSplits());
  }

  function test_createDrop_communityGateBadConfigReverts() external {
    // Zero community id on an engine WITH a registry
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.gate = IHupDrops.GateType.Community;
    p.gateData = bytes32(0);
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidGateConfig.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(p), _noSplits());

    // Engine without a registry
    HupDrops bare = new HupDrops(address(hup), address(0), admin, address(followers));
    HupDropsDeployer721 bareDeployer = new HupDropsDeployer721(address(bare));
    vm.prank(admin);
    bare.setDeployer(STANDARD_721, address(bareDeployer));
    p.gateData = bytes32(uint256(1));
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidGateConfig.selector);
    bare.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(p), _noSplits());
  }

  function test_createDrop_assetGateNeedsAssetAndMin() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.gate = IHupDrops.GateType.AssetHolders;
    p.gateAsset = address(0);
    p.gateMin = 1;
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidGateConfig.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(p), _noSplits());

    p.gateAsset = address(0xBEEF);
    p.gateMin = 0;
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidGateConfig.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(p), _noSplits());
  }

  function test_createDrop_whenPausedReverts() external {
    vm.prank(admin);
    engine.pause();
    vm.prank(creator);
    vm.expectRevert(EnforcedPause.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(_openPhase(0)), _noSplits());
  }

  function test_deployers_rejectDirectCalls() external {
    vm.prank(stranger);
    vm.expectRevert(HupDropsDeployer721.OnlyDrops.selector);
    d721.deploy(creator, 10, _params721());

    vm.prank(stranger);
    vm.expectRevert(HupDropsDeployer1155.OnlyDrops.selector);
    d1155.deploy(creator, 10, _params1155());
  }

  function test_createDrop_badParamsBlobReverts() external {
    vm.prank(creator);
    vm.expectRevert();
    engine.createDrop(address(0), STANDARD_721, abi.encode("only a name"), 10, 0, false, _one(_openPhase(0)), _noSplits());
  }
}

contract HupDropsPhaseTest is DropsFixture {
  uint256 internal dropId;

  function setUp() public override {
    super.setUp();
    (dropId, ) = _simple721(0, 100, 0);
  }

  function test_addPhase_appendsWithNewIndex() external {
    vm.prank(creator);
    uint256 idx = engine.addPhase(dropId, _openPhase(1 ether));
    assertEq(idx, 1, "appended at index 1");
    assertEq(engine.phasesOf(dropId).length, 2, "two phases");
    assertEq(engine.phasesOf(dropId)[1].price, 1 ether, "appended price");
  }

  function test_addPhase_onlyCreatorOrSession() external {
    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.addPhase(dropId, _openPhase(0));

    hup.setSession(creator, burner, block.timestamp + 1 hours);
    vm.prank(burner);
    uint256 idx = engine.addPhase(dropId, _openPhase(0));
    assertEq(idx, 1, "session append works");
  }

  function test_addPhase_capsAtMaxPhases() external {
    vm.startPrank(creator);
    for (uint256 i = 1; i < 8; i++) {
      engine.addPhase(dropId, _openPhase(0));
    }
    vm.expectRevert(IHupDrops.InvalidPhases.selector);
    engine.addPhase(dropId, _openPhase(0));
    vm.stopPrank();
  }

  function test_addPhase_afterCloseReverts() external {
    vm.prank(creator);
    engine.closeDrop(dropId);
    vm.prank(creator);
    vm.expectRevert(IHupDrops.DropNotActive.selector);
    engine.addPhase(dropId, _openPhase(0));
  }

  function test_addPhase_validatesLikeCreate() external {
    IHupDrops.PhaseInput memory p = _openPhase(0);
    p.allocation = 101; // above maxSupply 100
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidPhases.selector);
    engine.addPhase(dropId, p);
  }

  function test_addPhaseBatch_allOrNothing() external {
    IHupDrops.PhaseInput memory bad = _openPhase(0);
    bad.startTime = 10;
    bad.endTime = 5;
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidPhases.selector);
    engine.addPhaseBatch(dropId, _two(_openPhase(0), bad));
    assertEq(engine.phasesOf(dropId).length, 1, "nothing appended");

    vm.prank(creator);
    uint256 first = engine.addPhaseBatch(dropId, _two(_openPhase(0), _openPhase(1 ether)));
    assertEq(first, 1, "first appended index");
    assertEq(engine.phasesOf(dropId).length, 3, "both appended");
  }

  function test_addPhaseBatch_overCapReverts() external {
    IHupDrops.PhaseInput[] memory eight = new IHupDrops.PhaseInput[](8);
    for (uint256 i = 0; i < 8; i++) eight[i] = _openPhase(0);
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidPhases.selector);
    engine.addPhaseBatch(dropId, eight); // 1 existing + 8 > MAX_PHASES
  }

  function test_setPhasePaused_togglesAndBlocksMint() external {
    vm.prank(creator);
    engine.setPhasePaused(dropId, 0, true);

    vm.prank(minter);
    vm.expectRevert(IHupDrops.PhaseNotActive.selector);
    engine.mint(address(0), dropId, 0, 1, address(0));

    vm.prank(creator);
    engine.setPhasePaused(dropId, 0, false);
    _mintAs(minter, dropId, 0, 1, 0);
    assertEq(engine.getDrop(dropId).minted, 1, "mints after resume");
  }

  function test_setPhasePaused_badIndexReverts() external {
    vm.prank(creator);
    vm.expectRevert(IHupDrops.PhaseNotFound.selector);
    engine.setPhasePaused(dropId, 5, true);
  }

  function test_setPhasePaused_strangerReverts() external {
    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setPhasePaused(dropId, 0, true);
  }

  function test_activePhaseOf_windowsAndPause() external {
    IHupDrops.PhaseInput memory late = _openPhase(0);
    late.startTime = uint64(block.timestamp + 1 days);
    vm.prank(creator);
    engine.addPhase(dropId, late);

    (bool found, uint256 idx) = engine.activePhaseOf(dropId);
    assertTrue(found, "phase 0 live");
    assertEq(idx, 0, "phase 0 index");

    vm.prank(creator);
    engine.setPhasePaused(dropId, 0, true);
    (found, idx) = engine.activePhaseOf(dropId);
    assertFalse(found, "none live while paused and phase 1 future");

    vm.warp(block.timestamp + 2 days);
    (found, idx) = engine.activePhaseOf(dropId);
    assertTrue(found, "phase 1 live after warp");
    assertEq(idx, 1, "phase 1 index");
  }
}

contract HupDropsAllowlistTest is DropsFixture {
  uint256 internal dropId;

  function setUp() public override {
    super.setUp();
    (dropId, ) = _simple721(0, 100, 0);
  }

  function test_setAllowlisted_setsAndUnsets() external {
    vm.prank(creator);
    engine.setAllowlisted(dropId, minter, true);
    assertTrue(engine.allowlist(dropId, minter), "listed");

    vm.prank(creator);
    assertEq(engine.allowlistCount(dropId), 1, "count 1");

    vm.prank(creator);
    engine.setAllowlisted(dropId, minter, false);
    assertFalse(engine.allowlist(dropId, minter), "unlisted");
    vm.prank(creator);
    assertEq(engine.allowlistCount(dropId), 0, "count 0");
  }

  function test_setAllowlistedBatch_capAt100() external {
    address[] memory many = new address[](101);
    for (uint256 i = 0; i < 101; i++) many[i] = address(uint160(0x10000 + i));
    vm.prank(creator);
    vm.expectRevert(IHupDrops.BatchTooLarge.selector);
    engine.setAllowlistedBatch(dropId, many, true);

    address[] memory hundred = new address[](100);
    for (uint256 i = 0; i < 100; i++) hundred[i] = address(uint160(0x10000 + i));
    vm.prank(creator);
    engine.setAllowlistedBatch(dropId, hundred, true);
    vm.prank(creator);
    assertEq(engine.allowlistCount(dropId), 100, "hundred listed");
  }

  function test_allowlistViews_creatorGated() external {
    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.allowlistCount(dropId);

    hup.setSession(creator, burner, block.timestamp + 1 hours);
    vm.prank(burner);
    engine.allowlistCount(dropId); // session may read

    // The list outlives the sale: views still work on a closed drop.
    vm.prank(creator);
    engine.closeDrop(dropId);
    vm.prank(creator);
    engine.allowlistCount(dropId);
  }

  function test_allowlistOf_pagingClamps() external {
    address[] memory five = new address[](5);
    for (uint256 i = 0; i < 5; i++) five[i] = address(uint160(0x20000 + i));
    vm.prank(creator);
    engine.setAllowlistedBatch(dropId, five, true);

    vm.prank(creator);
    address[] memory page = engine.allowlistOf(dropId, 3, type(uint256).max);
    assertEq(page.length, 2, "tail clamped, no overflow");

    vm.prank(creator);
    page = engine.allowlistOf(dropId, 9, 10);
    assertEq(page.length, 0, "offset past end is empty");

    vm.prank(creator);
    page = engine.allowlistOf(dropId, 0, 0);
    assertEq(page.length, 0, "zero limit is empty");
  }

  function test_allowlistEdits_strangerReverts() external {
    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setAllowlisted(dropId, stranger, true);
  }
}

contract HupDropsCloseTest is DropsFixture {
  uint256 internal dropId;

  function setUp() public override {
    super.setUp();
    (dropId, ) = _simple721(0, 100, 0);
  }

  function test_closeDrop_byCreator() external {
    vm.expectEmit(true, false, false, true);
    emit IHupDrops.DropClosed(dropId, false);
    vm.prank(creator);
    engine.closeDrop(dropId);

    assertTrue(engine.getDrop(dropId).closed, "closed");
    vm.prank(minter);
    vm.expectRevert(IHupDrops.DropNotActive.selector);
    engine.mint(address(0), dropId, 0, 1, address(0));
  }

  function test_closeDrop_byAdminFlagsModeration() external {
    vm.expectEmit(true, false, false, true);
    emit IHupDrops.DropClosed(dropId, true);
    vm.prank(admin);
    engine.closeDrop(dropId);
  }

  function test_closeDrop_bySession() external {
    hup.setSession(creator, burner, block.timestamp + 1 hours);
    vm.expectEmit(true, false, false, true);
    emit IHupDrops.DropClosed(dropId, false);
    vm.prank(burner);
    engine.closeDrop(dropId);
  }

  function test_closeDrop_strangerReverts() external {
    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.closeDrop(dropId);
  }

  function test_closeDrop_twiceReverts() external {
    vm.prank(creator);
    engine.closeDrop(dropId);
    vm.prank(creator);
    vm.expectRevert(IHupDrops.DropNotActive.selector);
    engine.closeDrop(dropId);
  }

  function test_closeDrop_unknownReverts() external {
    vm.prank(creator);
    vm.expectRevert(IHupDrops.DropNotFound.selector);
    engine.closeDrop(99);
  }
}

contract HupDropsAdminTest is DropsFixture {
  function test_feeSetters_capsEnforced() external {
    vm.prank(admin);
    vm.expectRevert(IHupDrops.InvalidFeeBps.selector);
    engine.setMintFeeBps(1_001);

    vm.startPrank(admin);
    engine.setMintFeeBps(1_000);
    engine.setMintFee(0.01 ether);
    engine.setMintFeeEnabled(true);
    engine.setCreationFee(1 ether);
    vm.stopPrank();

    assertEq(engine.mintFeeBps(), 1_000, "bps");
    assertEq(engine.mintFee(), 0.01 ether, "flat");
    assertTrue(engine.mintFeeEnabled(), "enabled");
    assertEq(engine.creationFee(), 1 ether, "creation");
  }

  function test_addressSetters_rejectZero() external {
    vm.prank(admin);
    vm.expectRevert(IHupDrops.InvalidAddress.selector);
    engine.setTrustedForwarder(address(0), true);

    vm.prank(admin);
    vm.expectRevert(IHupDrops.InvalidAddress.selector);
    engine.setHupContract(address(0));
  }

  function test_setDeployer_zeroRetiresStandard() external {
    vm.prank(admin);
    engine.setDeployer(STANDARD_721, address(0));
    vm.prank(creator);
    vm.expectRevert(IHupDrops.InvalidStandard.selector);
    engine.createDrop(address(0), STANDARD_721, _params721(), 10, 0, false, _one(_openPhase(0)), _noSplits());
  }

  function test_adminFunctions_rejectNonAdmin() external {
    vm.startPrank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.pause();
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setMintFeeBps(1);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setDeployer(1, address(0));
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.withdrawAll(payable(stranger));
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.setFollowerSystem(address(0));
    vm.stopPrank();
  }

  function test_adminViaForwarderRejected() external {
    // Admin identity must be msg.sender, never a relayed suffix.
    bytes memory data = abi.encodeWithSelector(engine.pause.selector);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    fwd.forward(address(engine), data, admin);
  }

  function test_pauseBlocksAndUnpauseRestores() external {
    (uint256 dropId, ) = _simple721(0, 10, 0);
    vm.prank(admin);
    engine.pause();

    vm.prank(minter);
    vm.expectRevert(EnforcedPause.selector);
    engine.mint(address(0), dropId, 0, 1, address(0));

    vm.prank(admin);
    engine.unpause();
    _mintAs(minter, dropId, 0, 1, 0);
    assertEq(engine.getDrop(dropId).minted, 1, "minted after unpause");
  }

  function test_roles_grantRevokeRenounce() external {
    bytes32 role = engine.ADMIN_ROLE();

    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.grantRole(role, stranger);
    vm.prank(admin);
    engine.grantRole(role, stranger);
    vm.prank(stranger);
    engine.pause(); // new admin works

    vm.prank(admin);
    engine.revokeRole(role, stranger);
    vm.prank(stranger);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.unpause();

    vm.prank(admin);
    vm.expectRevert(IHupDrops.Unauthorized.selector);
    engine.renounceRole(role, stranger); // confirmation must be self
  }

  function test_withdrawAll_sweepsEverything() external {
    vm.prank(admin);
    engine.setCreationFee(1 ether);
    _simple721(0, 10, 0); // pays 1 ether in

    address payable sink = payable(address(0xFEE51));
    vm.prank(admin);
    engine.withdrawAll(sink);
    assertEq(sink.balance, 1 ether, "swept");
    assertEq(address(engine).balance, 0, "drained");

    vm.prank(admin);
    vm.expectRevert(IHupDrops.TransferFailed.selector);
    engine.withdrawAll(sink); // zero balance

    vm.prank(admin);
    vm.expectRevert(IHupDrops.InvalidAddress.selector);
    engine.withdrawAll(payable(address(0)));
  }

  function test_withdrawAll_rejectingReceiverReverts() external {
    vm.prank(admin);
    engine.setCreationFee(1 ether);
    _simple721(0, 10, 0);

    RejectingReceiver bad = new RejectingReceiver();
    vm.prank(admin);
    vm.expectRevert(IHupDrops.TransferFailed.selector);
    engine.withdrawAll(payable(address(bad)));
  }

  function test_withdrawToken_erc20AndLsp7() external {
    MockERC20 t20 = new MockERC20();
    t20.mint(address(engine), 5 ether);
    address sink = address(0xFEE52);

    vm.prank(admin);
    engine.withdrawToken(address(t20), sink, false);
    assertEq(t20.balanceOf(sink), 5 ether, "erc20 swept");

    MockLSP7Pay t7 = new MockLSP7Pay();
    t7.mint(address(engine), 3 ether);
    vm.prank(admin);
    engine.withdrawToken(address(t7), sink, true);
    assertEq(t7.balanceOf(sink), 3 ether, "lsp7 swept");

    vm.prank(admin);
    vm.expectRevert(IHupDrops.TransferFailed.selector);
    engine.withdrawToken(address(t20), sink, false); // empty again
  }

  function test_version() external view {
    assertEq(engine.version(), "1.0.0", "version");
  }

  function test_unattributedDepositAccepted() external {
    (bool ok, ) = address(engine).call{ value: 1 ether }("");
    assertTrue(ok, "plain deposit accepted");
    assertEq(address(engine).balance, 1 ether, "held");
  }
}
