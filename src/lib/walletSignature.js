/**
 * @file lib/walletSignature.js
 * @description Proving a request came from a particular wallet, on whichever chain that wallet
 * lives on.
 *
 * Two kinds of account sign here and they verify differently. A MetaMask EOA produces a
 * recoverable signature — hash the message, recover the address, compare. A Universal Profile is
 * a contract: it cannot sign at all, its controller key does, so the only account that can answer
 * "is this signature yours" is the profile itself, over ERC-1271. Asking an EOA for
 * isValidSignature reverts, and recovering an address from a UP's signature returns the
 * controller rather than the profile, so neither check alone covers both callers.
 *
 * The chain matters. An ERC-1271 call has to reach the chain the account is deployed on, and a
 * Universal Profile on LUKSO is a different contract from an ERC-4337 account on Base — the older
 * copy of this logic pointed every check at LUKSO's RPC, which quietly failed anyone whose smart
 * account was anywhere else.
 */

import { hashMessage, recoverMessageAddress } from 'viem'
import { getServerPublicClient } from '@/lib/serverPublicClient'
import { isEvmAddress, normalizeAddress } from '@/lib/address'

/** How long a signed message stays good for. Long enough to sign slowly, short enough to not be worth stealing. */
export const SIGNATURE_MAX_AGE_MS = 5 * 60_000

const ERC1271_MAGIC_VALUE = '0x1626ba7e'

const ERC1271_ABI = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'magicValue', type: 'bytes4' }],
  },
]

/**
 * Builds the message a wallet is asked to sign. One shape for the whole app so a signature taken
 * for one action can never be replayed against another: the action and the subject are inside the
 * text the wallet displays, and the timestamp bounds how long it is worth anything.
 *
 * @param {string} action What the signer is authorising, in words they will read.
 * @param {string} subject What it applies to.
 * @param {number} [timestamp] Milliseconds; defaults to now.
 * @returns {string} The message to sign.
 */
export const buildSignatureMessage = (action, subject, timestamp = Date.now()) =>
  `${action}\n${subject}\nTimestamp: ${timestamp}`

/**
 * Whether a claimed address really signed a message, covering both EOAs and smart accounts.
 *
 * The claim is checked, never derived: the caller says which address it is asserting and this
 * answers yes or no. Deriving it instead would let a UP's controller key pass as the profile.
 *
 * @param {Object} params
 * @param {string} params.address The address the caller claims signed.
 * @param {string} params.message The exact message that was signed.
 * @param {string} params.signature The signature to check.
 * @param {number|string} params.chainId Chain the account lives on, for the ERC-1271 read.
 * @returns {Promise<boolean>} True when the signature belongs to that address.
 */
export const verifyWalletSignature = async ({ address, message, signature, chainId }) => {
  if (!isEvmAddress(address) || !message || !signature) return false
  const claimed = normalizeAddress(address)

  // A contract account first: an EOA simply has no code, so this costs one read and settles the
  // ambiguity before either check can produce a misleading answer
  const client = getServerPublicClient(chainId)
  if (client) {
    const isContract = await client
      .getCode({ address: claimed })
      .then((code) => Boolean(code) && code !== '0x')
      .catch(() => false)

    if (isContract) {
      return client
        .readContract({
          address: claimed,
          abi: ERC1271_ABI,
          functionName: 'isValidSignature',
          args: [hashMessage(message), signature],
        })
        .then((result) => String(result).toLowerCase() === ERC1271_MAGIC_VALUE)
        .catch(() => false)
    }
  }

  return recoverMessageAddress({ message, signature })
    .then((recovered) => normalizeAddress(recovered) === claimed)
    .catch(() => false)
}

/**
 * Whether a message was signed recently enough to still authorise anything.
 * @param {string} message A message built by buildSignatureMessage.
 * @returns {boolean} True when its timestamp is present and inside the window.
 */
export const isSignatureFresh = (message) => {
  const stamp = String(message ?? '').match(/Timestamp:\s*(\d+)/)
  if (!stamp) return false

  const age = Date.now() - Number(stamp[1])
  // A clock a little ahead of ours is a wall-clock difference, not an attack; a long-past one is
  // the replay this window exists to stop
  return age > -SIGNATURE_MAX_AGE_MS && age < SIGNATURE_MAX_AGE_MS
}
