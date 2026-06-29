// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title HupChatForwarder
 * @notice ERC2771 meta-transaction forwarder with multi-mode signature verification.
 * @dev Overrides _recoverForwardRequestSigner to accept three signature types:
 *
 *   1. Raw ECDSA of EIP-712 digest   — regular EOAs via eth_signTypedData_v4 (MetaMask, etc.)
 *   2. personal_sign of EIP-712 digest — LUKSO controller EOAs or wallets that only support eth_sign
 *   3. ERC-1271 isValidSignature      — LUKSO Universal Profiles (smart-contract wallets)
 *
 *      The relay's off-chain check mirrors this order, so any signature accepted here is
 *      pre-validated before spending on-chain gas.
 *
 * @custom:version 1.0.0
 * @custom:website https://hup.social
 */
contract HupChatForwarder is ERC2771Forwarder {
  using ECDSA for bytes32;

  constructor(string memory _name) ERC2771Forwarder(_name) {}

  function _recoverForwardRequestSigner(
    ForwardRequestData calldata request
  ) internal view virtual override returns (bool isValid, address signer) {
    bytes32 digest = _hashTypedDataV4(
      keccak256(
        abi.encode(
          FORWARD_REQUEST_TYPEHASH,
          request.from,
          request.to,
          request.value,
          request.gas,
          nonces(request.from),
          request.deadline,
          keccak256(request.data)
        )
      )
    );

    // 1. Raw ECDSA — standard eth_signTypedData_v4 (MetaMask, regular EOAs).
    (address recovered, ECDSA.RecoverError err, ) = digest.tryRecoverCalldata(request.signature);
    if (err == ECDSA.RecoverError.NoError && recovered == request.from) {
      return (true, request.from);
    }

    // 2. personal_sign — wallets that sign with Ethereum prefix (eth_sign / personal_sign).
    //    Covers LUKSO controller EOAs connecting directly without a Universal Profile.
    bytes32 personalDigest = MessageHashUtils.toEthSignedMessageHash(digest);
    (address personalRecovered, ECDSA.RecoverError personalErr, ) = personalDigest.tryRecoverCalldata(request.signature);
    if (personalErr == ECDSA.RecoverError.NoError && personalRecovered == request.from) {
      return (true, request.from);
    }

    // 3. ERC-1271 — smart-contract wallets (LUKSO Universal Profiles).
    //    personal_sign produces a sig over personal_hash(digest). LUKSO UP's isValidSignature
    //    calls ECDSA.recover(dataHash, sig) directly, so we pass the personal hash — the same
    //    hash the controller actually signed. SignatureChecker will first try raw ECDSA
    //    (recovering the controller EOA which != UP), then call UP.isValidSignature(personalDigest,
    //    sig) via ERC-1271, which succeeds because the controller is authorised.
    if (SignatureChecker.isValidSignatureNow(request.from, personalDigest, request.signature)) {
      return (true, request.from);
    }

    return (false, request.from);
  }
}
