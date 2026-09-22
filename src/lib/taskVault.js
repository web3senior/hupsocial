// Sealed task submissions. A worker encrypts the reply under a fresh content key and wraps that key
// to the task's public key; only the poster can open it. On approval the poster may publish the
// raw content key onchain (HupTasks.SlotPaid.revealKey), which lets anyone read that submission.
//
// Same primitives as HupSell (ECIES key wrap + AES-256-GCM body), under the security vault's own
// taskVault child so the poster's task identity is domain-separated from every other feature.

import { Buffer } from 'buffer'
import { getCachedMasterHex, deriveChildKeyBytes, CHILD_KEY_LABELS } from './securityVault'
import { requestVaultUnlock } from './vaultUnlockBus'
import { decryptContent, encryptContent, generateContentKey, pubKeyFromPrivKeyHex, unwrapContentKey, wrapContentKey } from './sellVault'

const sessionKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''}task_vault_unlocked`

const toHex = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`
const fromHex = (hex) => Buffer.from(String(hex).replace(/^0x/, ''), 'hex')

async function identityFromMaster(masterHex) {
  const seed = await deriveChildKeyBytes(masterHex, CHILD_KEY_LABELS.taskVault)
  const privKeyHex = Buffer.from(seed).toString('hex')
  return { privKeyHex, pubKeyHex: pubKeyFromPrivKeyHex(privKeyHex) }
}

/** The poster's task identity if the vault is already open this session, else null. */
export async function resolveTaskIdentity() {
  const cached = sessionStorage.getItem(sessionKey)
  if (cached) return { privKeyHex: cached, pubKeyHex: pubKeyFromPrivKeyHex(cached) }

  const masterHex = getCachedMasterHex()
  if (!masterHex) return null

  const identity = await identityFromMaster(masterHex)
  sessionStorage.setItem(sessionKey, identity.privKeyHex)
  return identity
}

/** Same, but opens the vault unlock dialog first when it is locked. */
export async function unlockTaskIdentity(reason) {
  const existing = await resolveTaskIdentity()
  if (existing) return existing

  await requestVaultUnlock({ reason })
  const identity = await resolveTaskIdentity()
  if (!identity) throw new Error('Your Security Vault is locked')
  return identity
}

/**
 * Seals a reply's plaintext content to the task's public key.
 * @returns {{ v: 1, iv: string, ciphertext: string, wrappedKey: string }}
 */
export async function sealSubmission(plainContent, taskPubKeyHex) {
  const contentKey = generateContentKey()
  const { iv, ciphertext } = await encryptContent(contentKey, plainContent)
  return { v: 1, iv, ciphertext, wrappedKey: wrapContentKey(contentKey, taskPubKeyHex) }
}

/** The raw content key of a sealed submission, as the hex HupTasks publishes on approval. */
export function submissionKeyHex(envelope, privKeyHex) {
  return toHex(unwrapContentKey(envelope.wrappedKey, privKeyHex))
}

/** Opens a sealed submission with the poster's identity. */
export async function openSubmission(envelope, privKeyHex) {
  const key = unwrapContentKey(envelope.wrappedKey, privKeyHex)
  return decryptContent(key, envelope.iv, envelope.ciphertext)
}

/** Opens a sealed submission with the key the poster published onchain. */
export async function openRevealedSubmission(envelope, revealKeyHex) {
  return decryptContent(new Uint8Array(fromHex(revealKeyHex)), envelope.iv, envelope.ciphertext)
}
