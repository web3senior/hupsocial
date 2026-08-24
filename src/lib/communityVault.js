// Community-content encryption helpers for Private / Request-Based communities.
//
// The identity keypair is a child of the app-wide security vault (src/lib/securityVault.js):
// one signature + one security PIN unlock the master secret, and this module derives its own
// domain-separated key from it — so unlocking the vault anywhere (e.g. the in-app wallet)
// unlocks community content too, and vice versa. Deliberately separate from Chat's identity
// key, which is signature-only and already live for every existing Chat user.

import ecies from 'eciesjs'
import { Buffer } from 'buffer'
import { unlockMaster, getCachedMasterHex, deriveChildKeyBytes, CHILD_KEY_LABELS } from './securityVault'
import HupCommunityABI from '@/abis/HupCommunity'

export const communityVaultSessionKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''}community_vault_unlocked`

// Encryption is NOT inferable from the membership type. It was, back when MembershipType
// conflated admission with sealing — but the rework split them: `membershipType` now carries
// AdmissionMode (0 Open ... 4 PayToJoin) and any of those may be encrypted, which is
// keyVersion > 0 onchain and the indexed `communities.is_encrypted` flag off KeyInitialized.
// The old isEncryptedMembershipType() lived here and returned true for types 1-5 and 8; it is
// gone rather than updated, because there is no correct membership-type answer to give.

function identityFromSeed(seedBytes) {
  const privKeyHex = Buffer.from(seedBytes).toString('hex')
  const privKey = new ecies.PrivateKey(seedBytes)
  const pubKeyHex = privKey.publicKey.toHex(false)

  return {
    privKeyHex,
    pubKeyHex: pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`,
  }
}

/**
 * Derives the community identity keypair via the security vault's master secret. Reproducible on
 * any device with the same wallet + same security PIN. Only prompts for a signature if the vault
 * isn't already unlocked this session.
 * @param {string} address - the connected wallet address
 * @param {string} pin - the user's security PIN (min 6 chars, enforced by caller's UI)
 * @param {(args: { message: string }) => Promise<string>} signMessageAsync - wagmi's useSignMessage().signMessageAsync
 */
export async function deriveCommunityIdentity(address, pin, signMessageAsync) {
  const masterHex = await unlockMaster(address, pin, signMessageAsync)
  const seedBytes = await deriveChildKeyBytes(masterHex, CHILD_KEY_LABELS.communityVault)
  return identityFromSeed(seedBytes)
}

/**
 * Derives the identity without any prompt when the security vault is already unlocked (by this
 * or any other feature). Returns null if the vault is locked.
 */
export async function deriveIdentityFromCachedMaster() {
  const masterHex = getCachedMasterHex()
  if (!masterHex) return null

  const seedBytes = await deriveChildKeyBytes(masterHex, CHILD_KEY_LABELS.communityVault)
  return identityFromSeed(seedBytes)
}

export function pubKeyFromPrivKeyHex(privKeyHex) {
  const clean = privKeyHex.startsWith('0x') ? privKeyHex.slice(2) : privKeyHex
  const privKey = new ecies.PrivateKey(Buffer.from(clean, 'hex'))
  const pubKeyHex = privKey.publicKey.toHex(false)
  return pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`
}

export function cacheUnlockedIdentity(privKeyHex) {
  sessionStorage.setItem(communityVaultSessionKey, privKeyHex)
}

export function getCachedIdentityPrivKeyHex() {
  return sessionStorage.getItem(communityVaultSessionKey)
}

export function clearCachedIdentity() {
  sessionStorage.removeItem(communityVaultSessionKey)
}

// --- Content-key wrap/unwrap (ECIES, same call shape as Chat.jsx) ---

export function generateContentKey() {
  return window.crypto.getRandomValues(new Uint8Array(32))
}

export function wrapContentKey(rawContentKeyBytes, recipientPubKeyHex) {
  const pubKeyHex = recipientPubKeyHex.startsWith('0x') ? recipientPubKeyHex : `0x${recipientPubKeyHex}`
  const wrapped = ecies.encrypt(pubKeyHex, Buffer.from(rawContentKeyBytes))
  // eciesjs returns a Uint8Array, NOT a Buffer — Uint8Array.toString('hex') silently ignores the
  // argument and yields comma-separated decimals, which poisons the tx calldata (viem embeds it
  // unvalidated and the wallet rejects). Wrap in Buffer.from before hex-encoding.
  return `0x${Buffer.from(wrapped).toString('hex')}`
}

export function unwrapContentKey(wrappedHex, privKeyHex) {
  const cleanWrapped = wrappedHex.startsWith('0x') ? wrappedHex.slice(2) : wrappedHex
  const cleanPriv = privKeyHex.startsWith('0x') ? privKeyHex.slice(2) : privKeyHex
  const decrypted = ecies.decrypt(Buffer.from(cleanPriv, 'hex'), Buffer.from(cleanWrapped, 'hex'))
  return new Uint8Array(decrypted)
}

// --- Backward key chaining (history visibility) ---
// A "backlink" is the previous key version's raw content key AES-GCM-encrypted under the next
// version's key. Anyone holding version N's key + an unbroken backlink chain can derive every
// OLDER key (N-1, N-2, ...) but never a newer one — that's what lets new members read history
// without weakening rotation's forward protection against members who left.

export async function wrapKeyWithKey(rawOlderKeyBytes, rawNewerKeyBytes) {
  const key = await window.crypto.subtle.importKey('raw', rawNewerKeyBytes, 'AES-GCM', false, ['encrypt'])
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, rawOlderKeyBytes)
  return `0x${Buffer.from(iv).toString('hex')}${Buffer.from(ciphertext).toString('hex')}`
}

export async function unwrapKeyWithKey(backlinkHex, rawNewerKeyBytes) {
  const clean = backlinkHex.startsWith('0x') ? backlinkHex.slice(2) : backlinkHex
  const blob = Buffer.from(clean, 'hex')
  const key = await window.crypto.subtle.importKey('raw', rawNewerKeyBytes, 'AES-GCM', false, ['decrypt'])
  const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12) }, key, blob.subarray(12))
  return new Uint8Array(decrypted)
}

// --- Post content encrypt/decrypt (AES-256-GCM via Web Crypto, same primitive as cryptoHelper.js) ---

export async function encryptPostContent(rawContentKeyBytes, plaintextObj) {
  const key = await window.crypto.subtle.importKey('raw', rawContentKeyBytes, 'AES-GCM', false, ['encrypt'])
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(plaintextObj)))

  return {
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  }
}

export async function decryptPostContent(rawContentKeyBytes, ivBase64, ciphertextBase64) {
  const key = await window.crypto.subtle.importKey('raw', rawContentKeyBytes, 'AES-GCM', false, ['decrypt'])
  const iv = Buffer.from(ivBase64, 'base64')
  const ciphertext = Buffer.from(ciphertextBase64, 'base64')
  const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)

  return JSON.parse(new TextDecoder().decode(decrypted))
}

// --- One-shot envelope resolution for arbitrary render sites (comments, post details, quotes) ---

/**
 * Best-effort decryption of an `{encrypted: true, keyVersion, communityId, iv, ciphertext}`
 * content object anywhere in the app. Promptless: only uses the identity already unlocked in
 * this session. Tries the viewer's direct envelope for the post's version first, then the
 * backward key-chain (history visibility) from the newest envelope they hold.
 * @returns the decrypted content object, or null if the viewer has no path to the key.
 */
export async function tryDecryptCommunityContent(publicClient, contractAddress, viewerAddress, contentObj) {
  if (!contentObj?.encrypted || !publicClient || !contractAddress || !viewerAddress) return null

  let privKeyHex = getCachedIdentityPrivKeyHex()
  if (!privKeyHex) {
    // The identity may not be cached yet even though the security vault is unlocked (e.g. the
    // vault was unlocked via the in-app wallet, or an encrypted post renders on a profile/home
    // feed before the communities page — which normally seeds the cache — has run this session).
    // Derive it promptlessly from the cached master and seed the cache so sibling cards reuse it.
    const derived = await deriveIdentityFromCachedMaster()
    if (derived) {
      cacheUnlockedIdentity(derived.privKeyHex)
      privKeyHex = derived.privKeyHex
    }
  }
  const communityId = contentObj.communityId
  const targetVersion = Number(contentObj.keyVersion)
  if (!privKeyHex || !communityId || !targetVersion) return null

  const read = (functionName, args) =>
    publicClient.readContract({ address: contractAddress, abi: HupCommunityABI, functionName, args })

  try {
    let rawKey = null

    const direct = await read('wrappedKeys', [BigInt(communityId), viewerAddress, BigInt(targetVersion)])
    if (direct && direct !== '0x') {
      rawKey = unwrapContentKey(direct, privKeyHex)
    } else {
      const current = Number(await read('keyVersion', [BigInt(communityId)]))
      if (current <= targetVersion) return null

      const newest = await read('wrappedKeys', [BigInt(communityId), viewerAddress, BigInt(current)])
      if (!newest || newest === '0x') return null

      let key = unwrapContentKey(newest, privKeyHex)
      for (let v = current; v > targetVersion; v--) {
        const backlink = await read('keyBacklinks', [BigInt(communityId), BigInt(v)])
        if (!backlink || backlink === '0x') return null
        key = await unwrapKeyWithKey(backlink, key)
      }
      rawKey = key
    }

    return await decryptPostContent(rawKey, contentObj.iv, contentObj.ciphertext)
  } catch {
    return null
  }
}
