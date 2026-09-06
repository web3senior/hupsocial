// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { TestBase } from "../shared/TestVm.sol";
import { HupDropCollectionLSP7 } from "../../v2/Extensions/HupDropCollectionLSP7.sol";
import { HupDropCollectionLSP8 } from "../../v2/Extensions/HupDropCollectionLSP8.sol";
import { HupDropsDeployerLSP7 } from "../../v2/Extensions/HupDropsDeployerLSP7.sol";
import { HupDropsDeployerLSP8 } from "../../v2/Extensions/HupDropsDeployerLSP8.sol";
import {
  _LSP4_METADATA_KEY,
  _LSP4_TOKEN_NAME_KEY,
  _LSP4_TOKEN_TYPE_NFT,
  _LSP4_TOKEN_TYPE_COLLECTION,
  _LSP4_CREATORS_ARRAY_KEY,
  _LSP4_CREATORS_MAP_KEY_PREFIX
} from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";
import { _LSP8_TOKEN_METADATA_BASE_URI, _INTERFACEID_LSP8 } from "@lukso/lsp8-contracts/contracts/LSP8Constants.sol";
import { _INTERFACEID_LSP7 } from "@lukso/lsp7-contracts/contracts/LSP7Constants.sol";

/// @dev What a Universal Profile answers to the LSP0 interface probe.
contract MockUP {
  function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == 0x24871b3d;
  }
}

/// @dev The collections are deployed with this test as the engine, so `engineMint` is callable
///      directly and every collection rule is exercised without the engine in front of it.
contract HupDropCollectionLSP8Test is TestBase {
  address internal creator = address(0xC4EA704);
  address internal holder = address(0x604D34);
  address internal stranger = address(0x574311);

  HupDropCollectionLSP8 internal coll;

  function setUp() public {
    coll = new HupDropCollectionLSP8(
      address(this),
      creator,
      3,
      "Lukso Art",
      "LART",
      _LSP4_TOKEN_TYPE_COLLECTION,
      bytes("meta-placeholder"),
      bytes("baseuri-placeholder"),
      creator,
      500,
      true
    );
  }

  function test_constructor_storesIdentityAndValidates() external {
    assertEq(coll.owner(), creator, "creator owns from block one");
    assertEq(coll.drops(), address(this), "engine recorded");
    assertEq(coll.tokenSupplyCap(), 3, "cap getter");
    assertEq(coll.getData(_LSP4_TOKEN_NAME_KEY), bytes("Lukso Art"), "LSP4 name");
    assertEq(coll.getData(_LSP4_METADATA_KEY), bytes("meta-placeholder"), "metadata seeded");
    assertEq(coll.getData(_LSP8_TOKEN_METADATA_BASE_URI), bytes("baseuri-placeholder"), "base uri seeded");

    vm.expectRevert(HupDropCollectionLSP8.InvalidAddress.selector);
    new HupDropCollectionLSP8(address(0), creator, 3, "A", "A", _LSP4_TOKEN_TYPE_NFT, "", "", address(0), 0, false);

    vm.expectRevert(HupDropCollectionLSP8.InvalidTokenType.selector);
    new HupDropCollectionLSP8(address(this), creator, 3, "A", "A", 3, "", "", address(0), 0, false);

    vm.expectRevert(HupDropCollectionLSP8.InvalidRoyalty.selector);
    new HupDropCollectionLSP8(address(this), creator, 3, "A", "A", _LSP4_TOKEN_TYPE_NFT, "", "", creator, 1_001, false);

    vm.expectRevert(HupDropCollectionLSP8.InvalidAddress.selector);
    new HupDropCollectionLSP8(address(this), creator, 3, "A", "A", _LSP4_TOKEN_TYPE_NFT, "", "", address(0), 500, false);
  }

  function test_creatorRecord_eoaAndUniversalProfile() external {
    // EOA creator: array of one, raw address element, zero interface id in the map.
    assertEq(coll.getData(_LSP4_CREATORS_ARRAY_KEY), abi.encodePacked(bytes16(uint128(1))), "array length 1");
    assertEq(
      coll.getData(bytes32(bytes.concat(bytes16(_LSP4_CREATORS_ARRAY_KEY), bytes16(uint128(0))))),
      abi.encodePacked(creator),
      "element 0 is the creator"
    );
    assertEq(
      coll.getData(bytes32(bytes.concat(_LSP4_CREATORS_MAP_KEY_PREFIX, bytes2(0), bytes20(creator)))),
      abi.encodePacked(bytes4(0), bytes16(uint128(0))),
      "EOA creator probes to zero interface id"
    );

    // Universal Profile creator: the LSP0 interface id is stamped instead.
    MockUP up = new MockUP();
    HupDropCollectionLSP8 upColl = new HupDropCollectionLSP8(
      address(this), address(up), 3, "U", "U", _LSP4_TOKEN_TYPE_NFT, "", "", address(0), 0, false
    );
    assertEq(
      upColl.getData(bytes32(bytes.concat(_LSP4_CREATORS_MAP_KEY_PREFIX, bytes2(0), bytes20(address(up))))),
      abi.encodePacked(bytes4(0x24871b3d), bytes16(uint128(0))),
      "UP creator probes to LSP0 id"
    );
  }

  function test_engineMint_onlyDropsSequentialIdsAndCap() external {
    vm.prank(stranger);
    vm.expectRevert(HupDropCollectionLSP8.OnlyDrops.selector);
    coll.engineMint(stranger, 1, 1);

    coll.engineMint(holder, 1, 3);
    assertEq(coll.tokenOwnerOf(bytes32(uint256(1))), holder, "id 1");
    assertEq(coll.tokenOwnerOf(bytes32(uint256(3))), holder, "id 3");
    assertEq(coll.totalSupply(), 3, "supply");
    assertEq(coll.balanceOf(holder), 3, "balance");

    vm.expectRevert(HupDropCollectionLSP8.SupplyExceeded.selector);
    coll.engineMint(holder, 4, 1);
  }

  function test_burn_neverReopensTheCap() external {
    coll.engineMint(holder, 1, 3);

    vm.prank(holder);
    coll.burn(bytes32(uint256(3)), "");
    assertEq(coll.totalSupply(), 2, "circulating shrank");
    assertEq(coll.totalMinted(), 3, "high-water mark untouched");

    // LSP8CappedSupply would let this through — the hand-rolled cap must not.
    vm.expectRevert(HupDropCollectionLSP8.SupplyExceeded.selector);
    coll.engineMint(holder, 4, 1);
  }

  function test_burn_authorizationAndGating() external {
    coll.engineMint(holder, 1, 2);

    vm.prank(stranger);
    vm.expectRevert();
    coll.burn(bytes32(uint256(1)), ""); // neither owner nor operator

    vm.prank(holder);
    coll.authorizeOperator(stranger, bytes32(uint256(1)), "");
    vm.prank(stranger);
    coll.burn(bytes32(uint256(1)), ""); // operator burn (burn-to-claim)
    assertEq(coll.totalSupply(), 1, "operator burn worked");

    HupDropCollectionLSP8 sealed_ = new HupDropCollectionLSP8(
      address(this), creator, 0, "S", "S", _LSP4_TOKEN_TYPE_NFT, "", "", address(0), 0, false
    );
    sealed_.engineMint(holder, 1, 1);
    vm.prank(holder);
    vm.expectRevert(HupDropCollectionLSP8.BurningDisabled.selector);
    sealed_.burn(bytes32(uint256(1)), "");
  }

  function test_enumerable_staysConsistentAcrossBurns() external {
    coll.engineMint(holder, 1, 3);
    vm.prank(holder);
    coll.burn(bytes32(uint256(3)), "");

    assertEq(coll.tokenAt(0), bytes32(uint256(1)), "index 0");
    assertEq(coll.tokenAt(1), bytes32(uint256(2)), "index 1");
  }

  function test_metadataFreeze_locksAtStorageLayer() external {
    vm.prank(creator);
    coll.setData(_LSP4_METADATA_KEY, bytes("the reveal")); // owner reveal pre-freeze
    assertEq(coll.getData(_LSP4_METADATA_KEY), bytes("the reveal"), "reveal written");

    vm.prank(stranger);
    vm.expectRevert();
    coll.freezeMetadata(); // owner only

    vm.prank(creator);
    coll.freezeMetadata();

    vm.prank(creator);
    vm.expectRevert(HupDropCollectionLSP8.MetadataIsFrozen.selector);
    coll.setData(_LSP4_METADATA_KEY, bytes("swap attempt"));

    vm.prank(creator);
    vm.expectRevert(HupDropCollectionLSP8.MetadataIsFrozen.selector);
    coll.setData(_LSP8_TOKEN_METADATA_BASE_URI, bytes("swap attempt"));

    // The batch entry point funnels through the same storage guard.
    bytes32[] memory keys = new bytes32[](1);
    bytes[] memory values = new bytes[](1);
    keys[0] = _LSP4_METADATA_KEY;
    values[0] = bytes("batch swap attempt");
    vm.prank(creator);
    vm.expectRevert(HupDropCollectionLSP8.MetadataIsFrozen.selector);
    coll.setDataBatch(keys, values);

    // Unguarded keys stay writable — the freeze is about the art, not the store.
    vm.prank(creator);
    coll.setData(keccak256("SomeOtherKey"), bytes("fine"));
  }

  function test_royaltyAndInterfaces() external {
    (address receiver, uint256 amount) = coll.royaltyInfo(0, 10_000);
    assertEq(receiver, creator, "royalty receiver");
    assertEq(amount, 500, "5%");

    vm.prank(creator);
    coll.setRoyalty(address(0), 0);
    (, amount) = coll.royaltyInfo(0, 10_000);
    assertEq(amount, 0, "cleared");

    vm.prank(creator);
    vm.expectRevert(HupDropCollectionLSP8.InvalidRoyalty.selector);
    coll.setRoyalty(creator, 1_001);

    assertTrue(coll.supportsInterface(0x2a55205a), "ERC2981 registered");
    assertTrue(coll.supportsInterface(_INTERFACEID_LSP8), "LSP8 id intact");
  }
}

contract HupDropCollectionLSP7Test is TestBase {
  address internal creator = address(0xC4EA704);
  address internal holder = address(0x604D34);
  address internal stranger = address(0x574311);

  HupDropCollectionLSP7 internal coll;

  function setUp() public {
    coll = new HupDropCollectionLSP7(
      address(this), creator, 10, "Lukso Edition", "LED", bytes("meta-placeholder"), creator, 250, true
    );
  }

  function test_constructor_identityAndNonDivisible() external {
    assertEq(coll.owner(), creator, "creator owns");
    assertEq(coll.drops(), address(this), "engine recorded");
    assertEq(coll.decimals(), 0, "non-divisible edition");
    assertEq(coll.tokenSupplyCap(), 10, "cap getter");
    assertEq(coll.getData(_LSP4_METADATA_KEY), bytes("meta-placeholder"), "metadata seeded");

    vm.expectRevert(HupDropCollectionLSP7.InvalidAddress.selector);
    new HupDropCollectionLSP7(address(0), creator, 10, "A", "A", "", address(0), 0, false);
  }

  function test_engineMint_onlyDropsAndCap() external {
    vm.prank(stranger);
    vm.expectRevert(HupDropCollectionLSP7.OnlyDrops.selector);
    coll.engineMint(stranger, 0, 1);

    coll.engineMint(holder, 0, 10);
    assertEq(coll.balanceOf(holder), 10, "editions minted");
    assertEq(coll.totalSupply(), 10, "supply");

    vm.expectRevert(HupDropCollectionLSP7.SupplyExceeded.selector);
    coll.engineMint(holder, 0, 1);
  }

  function test_burn_neverReopensTheCap() external {
    coll.engineMint(holder, 0, 10);

    vm.prank(holder);
    coll.burn(holder, 4, "");
    assertEq(coll.totalSupply(), 6, "circulating shrank");
    assertEq(coll.totalMinted(), 10, "high-water mark untouched");

    vm.expectRevert(HupDropCollectionLSP7.SupplyExceeded.selector);
    coll.engineMint(holder, 0, 1);
  }

  function test_burn_authorizationAndGating() external {
    coll.engineMint(holder, 0, 10);

    vm.prank(stranger);
    vm.expectRevert();
    coll.burn(holder, 1, ""); // no operator authorization

    vm.prank(holder);
    coll.authorizeOperator(stranger, 3, "");
    vm.prank(stranger);
    coll.burn(holder, 3, ""); // operator burn within allowance
    assertEq(coll.totalSupply(), 7, "operator burn worked");

    HupDropCollectionLSP7 sealed_ = new HupDropCollectionLSP7(
      address(this), creator, 0, "S", "S", "", address(0), 0, false
    );
    sealed_.engineMint(holder, 0, 5);
    vm.prank(holder);
    vm.expectRevert(HupDropCollectionLSP7.BurningDisabled.selector);
    sealed_.burn(holder, 1, "");
  }

  function test_metadataFreeze_locksAtStorageLayer() external {
    vm.prank(creator);
    coll.setData(_LSP4_METADATA_KEY, bytes("the reveal"));

    vm.prank(creator);
    coll.freezeMetadata();

    vm.prank(creator);
    vm.expectRevert(HupDropCollectionLSP7.MetadataIsFrozen.selector);
    coll.setData(_LSP4_METADATA_KEY, bytes("swap attempt"));

    vm.prank(creator);
    coll.setData(keccak256("SomeOtherKey"), bytes("fine"));
  }

  function test_creatorRecordAndInterfaces() external {
    assertEq(coll.getData(_LSP4_CREATORS_ARRAY_KEY), abi.encodePacked(bytes16(uint128(1))), "array length 1");
    assertEq(
      coll.getData(bytes32(bytes.concat(_LSP4_CREATORS_MAP_KEY_PREFIX, bytes2(0), bytes20(creator)))),
      abi.encodePacked(bytes4(0), bytes16(uint128(0))),
      "EOA creator map entry"
    );

    (address receiver, uint256 amount) = coll.royaltyInfo(0, 10_000);
    assertEq(receiver, creator, "royalty receiver");
    assertEq(amount, 250, "2.5%");

    assertTrue(coll.supportsInterface(0x2a55205a), "ERC2981 registered");
    assertTrue(coll.supportsInterface(_INTERFACEID_LSP7), "LSP7 id intact");
  }
}

contract LspDeployersTest is TestBase {
  address internal creator = address(0xC4EA704);
  address internal stranger = address(0x574311);

  function test_deployerLsp8_roundTripAndCallerLock() external {
    HupDropsDeployerLSP8 dep = new HupDropsDeployerLSP8(address(this));

    vm.prank(stranger);
    vm.expectRevert(HupDropsDeployerLSP8.OnlyDrops.selector);
    dep.deploy(creator, 5, "");

    bytes memory params = abi.encode(
      "Deployed", "DEP", _LSP4_TOKEN_TYPE_COLLECTION, bytes("m"), bytes("b"), creator, uint96(300), true
    );
    address coll = dep.deploy(creator, 5, params);

    HupDropCollectionLSP8 c = HupDropCollectionLSP8(payable(coll));
    assertEq(c.owner(), creator, "creator owns");
    assertEq(c.drops(), address(this), "engine is the deployer's engine");
    assertEq(c.tokenSupplyCap(), 5, "cap forwarded");
    assertEq(c.getData(_LSP4_TOKEN_NAME_KEY), bytes("Deployed"), "name decoded");
  }

  function test_deployerLsp7_roundTripAndCallerLock() external {
    HupDropsDeployerLSP7 dep = new HupDropsDeployerLSP7(address(this));

    vm.prank(stranger);
    vm.expectRevert(HupDropsDeployerLSP7.OnlyDrops.selector);
    dep.deploy(creator, 5, "");

    bytes memory params = abi.encode("Edition", "ED", bytes("m"), address(0), uint96(0), false);
    address coll = dep.deploy(creator, 7, params);

    HupDropCollectionLSP7 c = HupDropCollectionLSP7(payable(coll));
    assertEq(c.owner(), creator, "creator owns");
    assertEq(c.tokenSupplyCap(), 7, "cap forwarded");
    assertEq(c.decimals(), 0, "non-divisible");
  }
}
