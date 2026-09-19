/**
 * @file lib/walletSignature.js
 * @description Server-side proof that a wallet signed a message, for both kinds of caller Hup has:
 * an EOA, where the address is recovered from the signature, and a smart account — a Universal
 * Profile, an embedded wallet's account, a Safe — where only the account itself can answer, through
 * ERC-1271.
 *
 * The 1271 call goes through the app's own pinned clients rather than a hardcoded LUKSO endpoint,
 * because a smart account is not a LUKSO-only thing on a nine-chain app.
 */

import { ethers } from 'ethers'
import { isEvmAddress, sameAddress } from '@/lib/address'
import { getServerPublicClient } from '@/lib/serverPublicClient'

const ERC1271_MAGIC_VALUE = '0x1626ba7e'
const ERC1271_ABI = [
  {
    name: 'isValidSignature',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
]

/** Where Universal Profiles live, and so the fallback for a caller that named no chain. */
const LUKSO_CHAIN_ID = 42

/* The chain the signer named, then LUKSO — and no further. A smart account exists on the chains
   it was deployed to; sweeping all nine would spend nine RPC timeouts proving one bad signature. */
const candidateChains = (chainId) => {
  const asked = Number(chainId)
  const ordered = [Number.isFinite(asked) && asked > 0 ? asked : null, LUKSO_CHAIN_ID]
  return [...new Set(ordered.filter(Boolean))]
}

/** Whether `account` answers ERC-1271 for this message on one chain. */
async function validOnChain(chainId, account, message, signature) {
  const client = getServerPublicClient(chainId)
  if (!client) return false

  try {
    const result = await client.readContract({
      address: account,
      abi: ERC1271_ABI,
      functionName: 'isValidSignature',
      args: [ethers.hashMessage(message), signature],
    })
    return String(result).toLowerCase() === ERC1271_MAGIC_VALUE
  } catch {
    /* No code at the address, a reverting account, a dead endpoint — none of them are a valid
       signature, and none of them should stop the next chain being asked. */
    return false
  }
}

/**
 * Whether `address` signed `message`.
 *
 * An EOA is settled locally and costs nothing. A smart account is asked directly, starting with
 * the chain the signer said it was on — only that account can confirm its own signature, and it
 * only exists on the chains it was deployed to.
 *
 * @param {string} address The account the signature is claimed for.
 * @param {string} message The exact string that was signed.
 * @param {string} signature The `personal_sign` result.
 * @param {{chainId?: number|string}} [options] Where to ask first when the account is a contract.
 * @returns {Promise<boolean>}
 */
export async function verifyWalletSignature(address, message, signature, { chainId } = {}) {
  if (!isEvmAddress(address) || typeof message !== 'string' || typeof signature !== 'string') return false

  try {
    if (sameAddress(ethers.verifyMessage(message, signature), address)) return true
  } catch {
    /* Not a recoverable ECDSA signature — a smart account's may be anything, so keep going. */
  }

  for (const id of candidateChains(chainId)) {
    if (await validOnChain(id, address, message, signature)) return true
  }

  return false
}
