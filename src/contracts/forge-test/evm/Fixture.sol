// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { TestBase } from "../shared/TestVm.sol";
import { HupDrops } from "../../v2/Extensions/HupDrops.sol";
import { IHupDrops } from "../../v2/Extensions/IHupDrops.sol";
import { IHupSplits } from "../../v2/Extensions/IHupSplits.sol";
import { HupSplits } from "../../v2/Extensions/HupSplits.sol";
import { HupSplitter } from "../../v2/Extensions/HupSplitter.sol";
import { HupDropsDeployer721 } from "../../v2/Extensions/HupDropsDeployer721.sol";
import { HupDropsDeployer1155 } from "../../v2/Extensions/HupDropsDeployer1155.sol";
import { HupDropCollection721 } from "../../v2/Extensions/HupDropCollection721.sol";
import { HupDropCollection1155 } from "../../v2/Extensions/HupDropCollection1155.sol";
import {
  MockHup,
  Forwarder,
  MockERC20,
  MockLSP7Pay,
  MockLSP26,
  MockCommunity,
  MockGate,
  Mock1155Gate,
  RejectingReceiver,
  PlainContract,
  ReentrantPayout,
  Reentrant1155Minter
} from "./Mocks.sol";

/// @dev OZ5 errors the engine's bases revert with.
error EnforcedPause();
error OwnableUnauthorizedAccount(address account);
error ERC721NonexistentToken(uint256 tokenId);

abstract contract DropsFixture is TestBase {
  HupDrops internal engine;
  HupDropsDeployer721 internal d721;
  HupDropsDeployer1155 internal d1155;
  MockHup internal hup;
  Forwarder internal fwd;
  MockLSP26 internal followers;
  MockCommunity internal community;
  HupSplits internal splits;

  address internal admin = address(0xAD314);
  address internal creator = address(0xC4EA704);
  address internal minter = address(0x314734);
  address internal referrer = address(0x4EF344);
  address internal stranger = address(0x574311);
  address internal burner = address(0xB0094E4);
  address internal primary = address(0x9431334);

  uint256 internal constant STANDARD_721 = 1;
  uint256 internal constant STANDARD_1155 = 2;

  function setUp() public virtual {
    vm.warp(1_000_000);

    hup = new MockHup();
    fwd = new Forwarder();
    followers = new MockLSP26();
    community = new MockCommunity();

    engine = new HupDrops(address(hup), address(fwd), admin, address(followers));
    d721 = new HupDropsDeployer721(address(engine));
    d1155 = new HupDropsDeployer1155(address(engine));
    splits = new HupSplits();

    vm.startPrank(admin);
    engine.setDeployer(STANDARD_721, address(d721));
    engine.setDeployer(STANDARD_1155, address(d1155));
    engine.setCommunitySystem(address(community));
    engine.setSplits(address(splits));
    vm.stopPrank();

    vm.deal(address(this), 1_000 ether);
    vm.deal(creator, 1_000 ether);
    vm.deal(minter, 1_000 ether);
    vm.deal(stranger, 1_000 ether);
    vm.deal(burner, 1_000 ether);
    vm.deal(primary, 1_000 ether);
  }

  // --- Phase helpers ---

  function _openPhase(uint256 price) internal pure returns (IHupDrops.PhaseInput memory p) {
    p = IHupDrops.PhaseInput({
      name: "Public",
      startTime: 0,
      endTime: 0,
      paused: false,
      token: address(0),
      isLsp7: false,
      price: price,
      perWallet: 0,
      allocation: 0,
      gate: IHupDrops.GateType.Open,
      gateAsset: address(0),
      gateData: bytes32(0),
      gateMin: 0
    });
  }

  function _one(IHupDrops.PhaseInput memory p) internal pure returns (IHupDrops.PhaseInput[] memory a) {
    a = new IHupDrops.PhaseInput[](1);
    a[0] = p;
  }

  function _two(IHupDrops.PhaseInput memory p0, IHupDrops.PhaseInput memory p1) internal pure returns (IHupDrops.PhaseInput[] memory a) {
    a = new IHupDrops.PhaseInput[](2);
    a[0] = p0;
    a[1] = p1;
  }

  // --- Collection params ---

  function _params721() internal view returns (bytes memory) {
    return abi.encode("Drop 721", "D721", "ipfs://base/", ".json", "ipfs://contract", creator, uint96(500), true);
  }

  function _params1155() internal pure returns (bytes memory) {
    return abi.encode("Drop 1155", "D1155", "ipfs://edition", "ipfs://contract1155", address(0), uint96(0), true);
  }

  /// @dev _params721 with the ERC2981 receiver swapped for an arbitrary address.
  function _params721With(address royaltyReceiver, uint96 royaltyBps) internal pure returns (bytes memory) {
    return abi.encode("Drop 721", "D721", "ipfs://base/", ".json", "ipfs://contract", royaltyReceiver, royaltyBps, true);
  }

  // --- Splits ---

  function _noSplits() internal pure returns (IHupDrops.SplitsInput memory s) {
    s.payoutDestination = address(0);
    s.payout = new IHupSplits.Payee[](0);
    s.royalty = new IHupSplits.Payee[](0);
  }

  function _payees2(address a, uint16 aBps, address b, uint16 bBps) internal pure returns (IHupSplits.Payee[] memory p) {
    p = new IHupSplits.Payee[](2);
    p[0] = IHupSplits.Payee({ account: a, shareBps: aBps });
    p[1] = IHupSplits.Payee({ account: b, shareBps: bBps });
  }

  function _payees1(address a) internal pure returns (IHupSplits.Payee[] memory p) {
    p = new IHupSplits.Payee[](1);
    p[0] = IHupSplits.Payee({ account: a, shareBps: 10_000 });
  }

  // --- Drop creation ---

  function _createDrop(
    uint256 standardId,
    bytes memory params,
    uint256 maxSupply,
    uint256 referralBps,
    IHupDrops.PhaseInput[] memory phases
  ) internal returns (uint256 dropId, address collection) {
    uint256 fee = engine.creationFee();
    vm.prank(creator);
    (dropId, collection) = engine.createDrop{ value: fee }(address(0), standardId, params, maxSupply, referralBps, false, phases, _noSplits());
  }

  function _simple721(uint256 price, uint256 maxSupply, uint256 referralBps) internal returns (uint256 dropId, address collection) {
    return _createDrop(STANDARD_721, _params721(), maxSupply, referralBps, _one(_openPhase(price)));
  }

  function _simple1155(uint256 price, uint256 maxSupply) internal returns (uint256 dropId, address collection) {
    return _createDrop(STANDARD_1155, _params1155(), maxSupply, 0, _one(_openPhase(price)));
  }

  // --- Mint helper ---

  function _mintAs(address who, uint256 dropId, uint256 phaseIndex, uint256 quantity, uint256 value) internal {
    vm.prank(who);
    engine.mint{ value: value }(address(0), dropId, phaseIndex, quantity, address(0));
  }
}
