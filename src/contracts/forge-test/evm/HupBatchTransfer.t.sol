// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { TestBase } from "../shared/TestVm.sol";
import { HupBatchTransfer } from "../../v2/Extensions/HupBatchTransfer.sol";
import { HupDropCollection721 } from "../../v2/Extensions/HupDropCollection721.sol";

/// @dev A recipient that refuses ERC721 — what makes safeTransferFrom worth its gas.
contract NonReceiver {}

/// @dev A recipient that accepts, so the happy path covers contracts as well as wallets.
contract Receiver {
  function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
    return this.onERC721Received.selector;
  }
}

contract HupBatchTransferTest is TestBase {
  HupBatchTransfer internal helper;
  HupDropCollection721 internal nft;

  address internal minter = address(0x0114E4);
  address internal alice = address(0xA11CE);
  address internal bob = address(0xB0B);
  address internal carol = address(0xCAADD1);

  function setUp() public {
    helper = new HupBatchTransfer();

    // The engine is this test, so it can mint straight into the sender's wallet
    nft = new HupDropCollection721(address(this), address(this), 0, "Batch", "BAT", "ipfs://base/", ".json", "ipfs://c", address(this), 0, false);
    // engineMint is the only way in, and this test is the registered engine
    nft.engineMint(minter, 1, 5);

    vm.prank(minter);
    nft.setApprovalForAll(address(helper), true);
  }

  function test_batchTransfer_oneRecipientEach() external {
    address[] memory to = new address[](3);
    to[0] = alice;
    to[1] = bob;
    to[2] = carol;

    uint256[] memory ids = new uint256[](3);
    ids[0] = 1;
    ids[1] = 2;
    ids[2] = 3;

    vm.prank(minter);
    helper.batchTransfer(address(nft), to, ids);

    assertEq(nft.ownerOf(1), alice, "token 1 to alice");
    assertEq(nft.ownerOf(2), bob, "token 2 to bob");
    assertEq(nft.ownerOf(3), carol, "token 3 to carol");
    // Nothing is ever held here, so there is no state for a token to be stranded in
    assertEq(nft.balanceOf(address(helper)), 0, "the helper owns nothing");
  }

  function test_batchTransferTo_oneRecipient() external {
    uint256[] memory ids = new uint256[](4);
    for (uint256 i = 0; i < 4; i++) ids[i] = i + 1;

    vm.prank(minter);
    helper.batchTransferTo(address(nft), alice, ids);

    assertEq(nft.balanceOf(alice), 4, "the whole run moved");
    assertEq(nft.balanceOf(minter), 1, "and nothing else did");
  }

  function test_batchTransfer_lengthMismatchReverts() external {
    address[] memory to = new address[](2);
    to[0] = alice;
    to[1] = bob;

    uint256[] memory ids = new uint256[](1);
    ids[0] = 1;

    vm.prank(minter);
    vm.expectRevert(abi.encodeWithSelector(HupBatchTransfer.LengthMismatch.selector, 2, 1));
    helper.batchTransfer(address(nft), to, ids);
  }

  function test_batchTransfer_emptyReverts() external {
    vm.prank(minter);
    vm.expectRevert(HupBatchTransfer.EmptyBatch.selector);
    helper.batchTransferTo(address(nft), alice, new uint256[](0));
  }

  function test_batchTransfer_overCapReverts() external {
    uint256[] memory ids = new uint256[](201);

    vm.prank(minter);
    vm.expectRevert(abi.encodeWithSelector(HupBatchTransfer.BatchTooLarge.selector, 201, 200));
    helper.batchTransferTo(address(nft), alice, ids);
  }

  function test_batchTransfer_withoutApprovalReverts() external {
    vm.prank(minter);
    nft.setApprovalForAll(address(helper), false);

    uint256[] memory ids = new uint256[](1);
    ids[0] = 1;

    // The helper has no power of its own — revoking the approval takes it all back
    vm.prank(minter);
    vm.expectRevert();
    helper.batchTransferTo(address(nft), alice, ids);
  }

  function test_batchTransfer_cannotMoveSomebodyElsesToken() external {
    uint256[] memory ids = new uint256[](1);
    ids[0] = 1;

    vm.prank(alice);
    vm.expectRevert();
    helper.batchTransferTo(address(nft), alice, ids);
  }

  function test_batchTransfer_nonReceiverRevertsWholeBatch() external {
    address[] memory to = new address[](2);
    to[0] = alice;
    to[1] = address(new NonReceiver());

    uint256[] memory ids = new uint256[](2);
    ids[0] = 1;
    ids[1] = 2;

    /* safeTransferFrom earning its gas: a recipient that cannot hold an NFT fails the batch
       rather than swallowing the token. Alice's transfer is rolled back with it. */
    vm.prank(minter);
    vm.expectRevert();
    helper.batchTransfer(address(nft), to, ids);

    assertEq(nft.ownerOf(1), minter, "the whole batch rolled back");
  }

  function test_batchTransfer_contractRecipientThatAcceptsIsFine() external {
    address receiver = address(new Receiver());

    uint256[] memory ids = new uint256[](1);
    ids[0] = 1;

    vm.prank(minter);
    helper.batchTransferTo(address(nft), receiver, ids);
    assertEq(nft.ownerOf(1), receiver, "a proper receiver takes it");
  }

  function test_batchTransfer_zeroCollectionReverts() external {
    uint256[] memory ids = new uint256[](1);
    ids[0] = 1;

    vm.prank(minter);
    vm.expectRevert(HupBatchTransfer.InvalidCollection.selector);
    helper.batchTransferTo(address(0), alice, ids);
  }
}
