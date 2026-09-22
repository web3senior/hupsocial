// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { TestBase } from "../shared/TestVm.sol";
import { Hup } from "../../v2/Hup.sol";
import { IHup } from "../../v2/IHup.sol";
import { HupScheduleForwarder } from "../../v2/HupScheduleForwarder.sol";
import { IHupScheduleForwarder } from "../../v2/IHupScheduleForwarder.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev The signing cheatcodes TestVm leaves out.
interface SignVm {
  function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
  function addr(uint256 privateKey) external returns (address);
  function etch(address target, bytes calldata newRuntimeBytecode) external;
}

/// @dev Universal Profile stand-in: a contract account whose controller key signs, checked through ERC-1271.
contract MockContractAccount {
  address public immutable controller;

  constructor(address controller_) {
    controller = controller_;
  }

  function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
    (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(hash, signature);
    return err == ECDSA.RecoverError.NoError && recovered == controller ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
  }

  function cancelOn(HupScheduleForwarder forwarder, uint256 nonce) external {
    require(msg.sender == controller, "not controller");
    forwarder.cancel(nonce);
  }
}

contract HupScheduleForwarderTest is TestBase {
  SignVm internal constant keys = SignVm(address(uint160(uint256(keccak256("hevm cheat code")))));

  uint256 internal constant AUTHOR_KEY = 0xA11CE;
  uint256 internal constant CONTROLLER_KEY = 0xC0DE;
  uint48 internal constant NOW = 1_000_000;
  uint48 internal constant DUE = 2_000_000;
  uint48 internal constant DEADLINE = DUE + 3 days;

  HupScheduleForwarder internal forwarder;
  Hup internal hup;
  address internal author;
  address internal admin = address(0xAD);

  function setUp() public {
    vm.warp(NOW);
    forwarder = new HupScheduleForwarder();
    hup = new Hup(address(forwarder), admin);
    author = keys.addr(AUTHOR_KEY);
  }

  function _request(address from, uint256 nonce, string memory metadata)
    internal
    view
    returns (IHupScheduleForwarder.ScheduledRequest memory)
  {
    return
      IHupScheduleForwarder.ScheduledRequest({
        from: from,
        to: address(hup),
        gas: 600_000,
        nonce: nonce,
        notBefore: DUE,
        deadline: DEADLINE,
        data: abi.encodeCall(IHup.create, (from, IHup.ContentType.Post, metadata, 0, true))
      });
  }

  function _sign(uint256 key, bytes32 digest) internal returns (bytes memory) {
    (uint8 v, bytes32 r, bytes32 s) = keys.sign(key, digest);
    return abi.encodePacked(r, s, v);
  }

  function _signed(uint256 key, IHupScheduleForwarder.ScheduledRequest memory request) internal returns (bytes memory) {
    return _sign(key, forwarder.hashRequest(request));
  }

  // --- Timing ---

  function test_executesAtItsTimeAndCreditsTheAuthor() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.warp(DUE);
    forwarder.execute(request, signature);

    IHup.ContentView memory content = hup.getContent(1, address(0));
    assertEq(content.creator, author, "post is attributed to the signer, not the relayer");
    assertEq(content.metadata, "ipfs://scheduled", "the signed metadata is what landed");
    assertTrue(forwarder.nonceUsed(author, 42), "nonce is spent");
  }

  function test_refusesToRunEarly() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.warp(DUE - 1);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.TooEarly.selector, DUE));
    forwarder.execute(request, signature);
  }

  function test_refusesAfterTheDeadline() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.warp(uint256(DEADLINE) + 1);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.Expired.selector, DEADLINE));
    forwarder.execute(request, signature);
  }

  // --- Nonces ---

  function test_aNonceRunsOnce() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.warp(DUE);
    forwarder.execute(request, signature);

    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.NonceUsed.selector, author, 42));
    forwarder.execute(request, signature);
  }

  function test_noncesNeedNoOrder() public {
    IHupScheduleForwarder.ScheduledRequest memory later = _request(author, 9, "ipfs://nine");
    IHupScheduleForwarder.ScheduledRequest memory earlier = _request(author, 3, "ipfs://three");
    bytes memory laterSignature = _signed(AUTHOR_KEY, later);
    bytes memory earlierSignature = _signed(AUTHOR_KEY, earlier);

    vm.warp(DUE);
    forwarder.execute(later, laterSignature);
    forwarder.execute(earlier, earlierSignature);

    assertEq(hup.contentCount(), 2, "both held requests executed, in either order");
  }

  function test_cancelVoidsAHeldRequest() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.prank(author);
    forwarder.cancel(42);

    assertFalse(forwarder.verify(request, signature), "a cancelled request no longer verifies");

    vm.warp(DUE);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.NonceUsed.selector, author, 42));
    forwarder.execute(request, signature);

    vm.prank(author);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.NonceUsed.selector, author, 42));
    forwarder.cancel(42);
  }

  // --- Signatures ---

  function test_rejectsAnotherKey() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _signed(CONTROLLER_KEY, request);

    vm.warp(DUE);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.InvalidSignature.selector, author));
    forwarder.execute(request, signature);
  }

  function test_rejectsTamperedContent() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _signed(AUTHOR_KEY, request);
    request.data = abi.encodeCall(IHup.create, (author, IHup.ContentType.Post, "ipfs://swapped", 0, true));

    vm.warp(DUE);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.InvalidSignature.selector, author));
    forwarder.execute(request, signature);
  }

  function test_rejectsAMovedTime() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _signed(AUTHOR_KEY, request);
    request.notBefore = NOW;

    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.InvalidSignature.selector, author));
    forwarder.execute(request, signature);
  }

  function test_delegatedEOAStillSignsWithItsKey() public {
    // EIP-7702 leaves code on the EOA; a delegate with no ERC-1271 must not lock the key out
    keys.etch(author, hex"00");
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.warp(DUE);
    forwarder.execute(request, signature);

    assertEq(hup.getContent(1, address(0)).creator, author, "a coded EOA still signs with its own key");
  }

  function test_aKeyCannotUseThePersonalMessageForm() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    bytes memory signature = _sign(AUTHOR_KEY, MessageHashUtils.toEthSignedMessageHash(forwarder.hashRequest(request)));

    vm.warp(DUE);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.InvalidSignature.selector, author));
    forwarder.execute(request, signature);
  }

  // --- Contract accounts (Universal Profiles) ---

  function test_contractAccountSignsThroughERC1271() public {
    MockContractAccount account = new MockContractAccount(keys.addr(CONTROLLER_KEY));
    IHupScheduleForwarder.ScheduledRequest memory request = _request(address(account), 1, "ipfs://profile");
    bytes memory signature = _signed(CONTROLLER_KEY, request);

    vm.warp(DUE);
    forwarder.execute(request, signature);

    assertEq(hup.getContent(1, address(0)).creator, address(account), "post is attributed to the profile itself");
  }

  function test_contractAccountMaySignThePersonalMessageForm() public {
    MockContractAccount account = new MockContractAccount(keys.addr(CONTROLLER_KEY));
    IHupScheduleForwarder.ScheduledRequest memory request = _request(address(account), 1, "ipfs://profile");
    bytes memory signature = _sign(CONTROLLER_KEY, MessageHashUtils.toEthSignedMessageHash(forwarder.hashRequest(request)));

    vm.warp(DUE);
    forwarder.execute(request, signature);

    assertEq(hup.getContent(1, address(0)).creator, address(account), "personal-message form accepted from a contract");
  }

  function test_contractAccountRejectsAStrangersKey() public {
    MockContractAccount account = new MockContractAccount(keys.addr(CONTROLLER_KEY));
    IHupScheduleForwarder.ScheduledRequest memory request = _request(address(account), 1, "ipfs://profile");
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.warp(DUE);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.InvalidSignature.selector, address(account)));
    forwarder.execute(request, signature);
  }

  function test_contractAccountCancelsItsOwnNonce() public {
    address controller = keys.addr(CONTROLLER_KEY);
    MockContractAccount account = new MockContractAccount(controller);

    vm.prank(controller);
    account.cancelOn(forwarder, 1);

    assertTrue(forwarder.nonceUsed(address(account), 1), "cancel is attributed to the calling account");
    assertFalse(forwarder.nonceUsed(controller, 1), "and not to the key behind it");
  }

  // --- Targets ---

  function test_refusesATargetThatDoesNotTrustIt() public {
    Hup other = new Hup(address(0xF00), admin);
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    request.to = address(other);
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.warp(DUE);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.UntrustfulTarget.selector, address(other)));
    forwarder.execute(request, signature);
  }

  function test_refusesAnAccountWithNoCode() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");
    request.to = address(0xBEEF);
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.warp(DUE);
    vm.expectRevert(abi.encodeWithSelector(IHupScheduleForwarder.UntrustfulTarget.selector, address(0xBEEF)));
    forwarder.execute(request, signature);
  }

  function test_targetRevertBubblesAndKeepsTheNonce() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, string(new bytes(300)));
    bytes memory signature = _signed(AUTHOR_KEY, request);

    vm.warp(DUE);
    vm.expectRevert(abi.encodeWithSelector(IHup.MetadataTooLarge.selector, 300, 256));
    forwarder.execute(request, signature);

    assertFalse(forwarder.nonceUsed(author, 42), "a failed call never burns the nonce");
  }

  // --- Views ---

  function test_verifyAnswersBeforeTheRequestIsDue() public {
    IHupScheduleForwarder.ScheduledRequest memory request = _request(author, 42, "ipfs://scheduled");

    assertTrue(forwarder.verify(request, _signed(AUTHOR_KEY, request)), "a good request verifies while still waiting");
    assertFalse(forwarder.verify(request, _signed(CONTROLLER_KEY, request)), "a wrong key does not");

    vm.warp(uint256(DEADLINE) + 1);
    assertFalse(forwarder.verify(request, _signed(AUTHOR_KEY, request)), "an expired request does not");
  }

  function test_versionAndDomain() public view {
    assertEq(forwarder.version(), "1.0.0", "version");
    (, string memory name, string memory domainVersion, uint256 chainId, address verifyingContract, , ) = forwarder.eip712Domain();
    assertEq(name, "HupScheduleForwarder", "domain name");
    assertEq(domainVersion, "1", "domain version");
    assertEq(chainId, block.chainid, "domain chain");
    assertEq(verifyingContract, address(forwarder), "domain contract");
  }
}
