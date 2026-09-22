// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "./IHupScheduleForwarder.sol";

/// @dev The one ERC-2771 function a target must answer for this forwarder to call it.
interface IERC2771Target {
    function isTrustedForwarder(address forwarder) external view returns (bool);
}

/**
 * @title Hup Schedule Forwarder
 * @author Hup Labs
 * @notice ERC-2771 forwarder for requests signed now and executed later, such as scheduled posts.
 * @dev Uses IHupScheduleForwarder for the shared struct, events and errors. Differs from the stock
 *      OpenZeppelin forwarder in three ways: nonces are single-use numbers the signer picks rather
 *      than a sequence, so the signer's other meta-transactions never invalidate a held request;
 *      `notBefore` is enforced onchain, so a held request cannot run early; and contract accounts
 *      such as LUKSO Universal Profiles sign through ERC-1271. Ownerless and immutable: a target
 *      opts in or out through its own trusted-forwarder setting.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji ⏰
 */
contract HupScheduleForwarder is IHupScheduleForwarder, EIP712 {
    // --- Storage ---

    bytes32 private constant SCHEDULED_REQUEST_TYPEHASH =
        keccak256(
            "ScheduledRequest(address from,address to,uint256 gas,uint256 nonce,uint48 notBefore,uint48 deadline,bytes data)"
        );

    /// @notice Whether `from` has spent or cancelled `nonce`.
    mapping(address => mapping(uint256 => bool)) public override nonceUsed;

    // --- Events ---
    // Declared in IHupScheduleForwarder.

    // --- Modifiers ---
    // None: execution is permissionless, and the signature is the only authority.

    constructor() EIP712("HupScheduleForwarder", "1") {}

    // --- Logic ---

    /// @notice Semantic version of this deployment.
    function version() external pure override returns (string memory) {
        return "1.0.0";
    }

    /**
     * @notice Executes a signed request on its target, appending the signer as the ERC-2771 sender.
     * @dev Anyone may submit. The nonce is spent before the call and the whole transaction reverts
     *      with the target's own reason if the call fails, so a failed attempt never burns the nonce.
     * @param request The signed request.
     * @param signature The signer's EIP-712 signature, or for a contract account whatever its
     *        ERC-1271 `isValidSignature` accepts.
     */
    function execute(ScheduledRequest calldata request, bytes calldata signature) external override {
        if (!_isTrustedByTarget(request.to)) revert UntrustfulTarget(request.to);
        if (block.timestamp < request.notBefore) revert TooEarly(request.notBefore);
        if (block.timestamp > request.deadline) revert Expired(request.deadline);
        if (nonceUsed[request.from][request.nonce]) revert NonceUsed(request.from, request.nonce);
        if (!_isValidSigner(request.from, hashRequest(request), signature)) revert InvalidSignature(request.from);

        nonceUsed[request.from][request.nonce] = true;

        bytes memory data = abi.encodePacked(request.data, request.from);
        uint256 reqGas = request.gas;
        address to = request.to;
        bool success;
        uint256 gasLeft;

        assembly ("memory-safe") {
            success := call(reqGas, to, 0, add(data, 0x20), mload(data), 0x00, 0x00)
            gasLeft := gas()
        }

        _checkForwardedGas(gasLeft, reqGas);

        if (!success) {
            assembly ("memory-safe") {
                let ptr := mload(0x40)
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
        }

        emit ScheduledRequestExecuted(request.from, request.nonce, request.to);
    }

    /**
     * @notice Voids one of the caller's nonces, so any request signed with it can never execute.
     * @dev Attributed to `msg.sender`: an EOA calls directly, a Universal Profile through its own execute.
     * @param nonce The nonce to void.
     */
    function cancel(uint256 nonce) external override {
        if (nonceUsed[msg.sender][nonce]) revert NonceUsed(msg.sender, nonce);

        nonceUsed[msg.sender][nonce] = true;

        emit NonceCancelled(msg.sender, nonce);
    }

    /**
     * @notice Whether `execute` would accept this request once its `notBefore` has passed.
     * @dev Ignores `notBefore` on purpose: callers check a request long before it is due.
     */
    function verify(ScheduledRequest calldata request, bytes calldata signature) external view override returns (bool) {
        return
            _isTrustedByTarget(request.to) &&
            block.timestamp <= request.deadline &&
            !nonceUsed[request.from][request.nonce] &&
            _isValidSigner(request.from, hashRequest(request), signature);
    }

    /// @notice The EIP-712 digest a signer signs for `request`.
    function hashRequest(ScheduledRequest calldata request) public view override returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        SCHEDULED_REQUEST_TYPEHASH,
                        request.from,
                        request.to,
                        request.gas,
                        request.nonce,
                        request.notBefore,
                        request.deadline,
                        keccak256(request.data)
                    )
                )
            );
    }

    /// @dev The key check runs for every account, so an EIP-7702 wallet still signs with its own key.
    ///      A contract account may instead answer through ERC-1271, for the typed digest or for it as a
    ///      personal message, as some Universal Profile flows sign; a bare key never gets that form.
    function _isValidSigner(address signer, bytes32 digest, bytes calldata signature) private view returns (bool) {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecoverCalldata(digest, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;

        if (signer.code.length == 0) return false;

        return
            SignatureChecker.isValidERC1271SignatureNowCalldata(signer, digest, signature) ||
            SignatureChecker.isValidERC1271SignatureNowCalldata(
                signer,
                MessageHashUtils.toEthSignedMessageHash(digest),
                signature
            );
    }

    /// @dev Same raw staticcall as the OpenZeppelin forwarder, so a target that returns garbage reads
    ///      as untrusted instead of reverting: without this check anyone could act as this contract.
    function _isTrustedByTarget(address target) private view returns (bool) {
        bytes memory encodedParams = abi.encodeCall(IERC2771Target.isTrustedForwarder, (address(this)));

        bool success;
        uint256 returnSize;
        uint256 returnValue;

        assembly ("memory-safe") {
            success := staticcall(gas(), target, add(encodedParams, 0x20), mload(encodedParams), 0x00, 0x20)
            returnSize := returndatasize()
            returnValue := mload(0x00)
        }

        return success && returnSize >= 0x20 && returnValue > 0;
    }

    /// @dev Reverts when the relayer passed too little gas for the call to get `reqGas`, so a short
    ///      transaction cannot spend the nonce on a call that ran out of gas. See the OpenZeppelin
    ///      forwarder's `_checkForwardedGas` for the derivation.
    function _checkForwardedGas(uint256 gasLeft, uint256 reqGas) private pure {
        if (gasLeft < reqGas / 63) {
            assembly ("memory-safe") {
                invalid()
            }
        }
    }
}
