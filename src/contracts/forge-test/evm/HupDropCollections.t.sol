// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { TestBase } from "../shared/TestVm.sol";
import { HupDropCollection721 } from "../../v2/Extensions/HupDropCollection721.sol";
import { HupDropCollection1155 } from "../../v2/Extensions/HupDropCollection1155.sol";

error OwnableUnauthorizedAccount(address account);
error ERC721NonexistentToken(uint256 tokenId);

/// @dev Deploys the collections directly with this test as the engine, so collection rules are
///      exercised without the engine's own checks in front of them.
contract HupDropCollection721Test is TestBase {
  address internal creator = address(0xC4EA704);
  address internal holder = address(0x604D34);
  address internal stranger = address(0x574311);

  HupDropCollection721 internal coll;

  function setUp() public {
    coll = new HupDropCollection721(
      address(this), creator, 5, "Art", "ART", "ipfs://base/", ".json", "ipfs://coll", creator, 500, true
    );
  }

  function test_constructor_rejectsZeroEngineAndBadRoyalty() external {
    vm.expectRevert(HupDropCollection721.InvalidAddress.selector);
    new HupDropCollection721(address(0), creator, 5, "A", "A", "", "", "", address(0), 0, false);

    vm.expectRevert(HupDropCollection721.InvalidRoyalty.selector);
    new HupDropCollection721(address(this), creator, 5, "A", "A", "", "", "", creator, 1_001, false);

    vm.expectRevert(HupDropCollection721.InvalidAddress.selector);
    new HupDropCollection721(address(this), creator, 5, "A", "A", "", "", "", address(0), 500, false);
  }

  function test_engineMint_onlyDrops() external {
    vm.prank(stranger);
    vm.expectRevert(HupDropCollection721.OnlyDrops.selector);
    coll.engineMint(stranger, 1, 1);
  }

  function test_engineMint_capEnforcedAndBurnNeverFreesIt() external {
    coll.engineMint(holder, 1, 5);
    assertEq(coll.totalMinted(), 5, "at cap");

    vm.expectRevert(HupDropCollection721.SupplyExceeded.selector);
    coll.engineMint(holder, 6, 1);

    vm.prank(holder);
    coll.burn(3);
    assertEq(coll.totalSupply(), 4, "circulating shrank");
    assertEq(coll.totalBurned(), 1, "burn counted");

    // The high-water mark never moves: a burn must not reopen the cap.
    vm.expectRevert(HupDropCollection721.SupplyExceeded.selector);
    coll.engineMint(holder, 6, 1);
  }

  function test_burn_gatingAndAuthorization() external {
    coll.engineMint(holder, 1, 2);

    vm.prank(stranger);
    vm.expectRevert();
    coll.burn(1); // not owner nor approved

    vm.prank(holder);
    coll.approve(stranger, 1);
    vm.prank(stranger);
    coll.burn(1); // approved burns
    assertEq(coll.totalBurned(), 1, "approved burn counted");

    HupDropCollection721 sealed_ = new HupDropCollection721(
      address(this), creator, 0, "S", "S", "", "", "", address(0), 0, false
    );
    sealed_.engineMint(holder, 1, 1);
    vm.prank(holder);
    vm.expectRevert(HupDropCollection721.BurningDisabled.selector);
    sealed_.burn(1);
  }

  function test_tokenURI_concatAndExistenceCheck() external {
    coll.engineMint(holder, 1, 1);
    assertEq(coll.tokenURI(1), "ipfs://base/1.json", "uri concat");

    vm.expectRevert(abi.encodeWithSelector(ERC721NonexistentToken.selector, 2));
    coll.tokenURI(2);
  }

  function test_metadata_updateFreezeAndContractURI() external {
    vm.prank(creator);
    coll.setBaseURI("ipfs://reveal/", "");
    coll.engineMint(holder, 1, 1);
    assertEq(coll.tokenURI(1), "ipfs://reveal/1", "revealed uri");

    vm.prank(stranger);
    vm.expectRevert(abi.encodeWithSelector(OwnableUnauthorizedAccount.selector, stranger));
    coll.setBaseURI("x", "y");

    vm.prank(creator);
    coll.freezeMetadata();
    vm.prank(creator);
    vm.expectRevert(HupDropCollection721.MetadataIsFrozen.selector);
    coll.setBaseURI("ipfs://again/", "");

    // Collection-level metadata is deliberately never frozen.
    vm.prank(creator);
    coll.setContractURI("ipfs://newcoll");
    assertEq(coll.contractURI(), "ipfs://newcoll", "contractURI still updatable");
  }

  function test_royalty_infoSetAndClear() external {
    (address receiver, uint256 amount) = coll.royaltyInfo(1, 10_000);
    assertEq(receiver, creator, "constructor receiver");
    assertEq(amount, 500, "5% of 10000");

    vm.prank(creator);
    vm.expectRevert(HupDropCollection721.InvalidRoyalty.selector);
    coll.setRoyalty(creator, 1_001);

    vm.prank(creator);
    coll.setRoyalty(address(0), 0); // clears
    (receiver, amount) = coll.royaltyInfo(1, 10_000);
    assertEq(amount, 0, "cleared");
  }

  function test_openEdition_zeroCapNeverExceeds() external {
    HupDropCollection721 open = new HupDropCollection721(
      address(this), creator, 0, "O", "O", "", "", "", address(0), 0, false
    );
    open.engineMint(holder, 1, 100);
    open.engineMint(holder, 101, 100);
    assertEq(open.totalMinted(), 200, "open edition unlimited");
  }
}

contract HupDropCollection1155Test is TestBase {
  address internal creator = address(0xC4EA704);
  address internal holder = address(0x604D34);
  address internal stranger = address(0x574311);

  HupDropCollection1155 internal coll;

  function setUp() public {
    coll = new HupDropCollection1155(
      address(this), creator, 10, "Edition", "ED", "ipfs://one", "ipfs://coll", creator, 250, true
    );
  }

  function test_identityAndUri() external view {
    assertEq(coll.name(), "Edition", "name stored");
    assertEq(coll.symbol(), "ED", "symbol stored");
    assertEq(coll.uri(0), "ipfs://one", "edition uri");
    assertEq(coll.uri(999), "ipfs://one", "every id resolves the same");
    assertEq(coll.TOKEN_ID(), 0, "single id");
  }

  function test_engineMint_onlyDropsAndCap() external {
    vm.prank(stranger);
    vm.expectRevert(HupDropCollection1155.OnlyDrops.selector);
    coll.engineMint(stranger, 0, 1);

    coll.engineMint(holder, 0, 10);
    assertEq(coll.balanceOf(holder, 0), 10, "editions minted");

    vm.expectRevert(HupDropCollection1155.SupplyExceeded.selector);
    coll.engineMint(holder, 0, 1);
  }

  function test_burn_gatingBothEntryPointsAndCapStaysClosed() external {
    coll.engineMint(holder, 0, 10);

    vm.prank(holder);
    coll.burn(holder, 0, 4);
    assertEq(coll.totalSupply(), 6, "circulating shrank");
    assertEq(coll.totalBurned(), 4, "burn counted");

    uint256[] memory ids = new uint256[](1);
    uint256[] memory values = new uint256[](1);
    ids[0] = 0;
    values[0] = 2;
    vm.prank(holder);
    coll.burnBatch(holder, ids, values);
    assertEq(coll.totalBurned(), 6, "batch burn counted");

    // Cap is a high-water mark: 10 were minted, burns free nothing.
    vm.expectRevert(HupDropCollection1155.SupplyExceeded.selector);
    coll.engineMint(holder, 0, 1);

    HupDropCollection1155 sealed_ = new HupDropCollection1155(
      address(this), creator, 0, "S", "S", "", "", address(0), 0, false
    );
    sealed_.engineMint(holder, 0, 5);
    vm.prank(holder);
    vm.expectRevert(HupDropCollection1155.BurningDisabled.selector);
    sealed_.burn(holder, 0, 1);
    vm.prank(holder);
    vm.expectRevert(HupDropCollection1155.BurningDisabled.selector);
    sealed_.burnBatch(holder, ids, values);
  }

  function test_metadata_freezeAndRoyalty() external {
    vm.prank(creator);
    coll.setTokenURI("ipfs://reveal");
    assertEq(coll.uri(0), "ipfs://reveal", "revealed");

    vm.prank(creator);
    coll.freezeMetadata();
    vm.prank(creator);
    vm.expectRevert(HupDropCollection1155.MetadataIsFrozen.selector);
    coll.setTokenURI("ipfs://no");

    (address receiver, uint256 amount) = coll.royaltyInfo(0, 10_000);
    assertEq(receiver, creator, "royalty receiver");
    assertEq(amount, 250, "2.5%");
  }
}
