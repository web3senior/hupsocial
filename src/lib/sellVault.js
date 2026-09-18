// Gated-content encryption helpers for HupSell listings.
//
// The seller encrypts once with a random content key and publishes only ciphertext. Every buyer
// then receives that key ECIES-wrapped to their own public key, published onchain by the seller
// via grantAccess. Nothing here ever reaches a server: no content key, no plaintext, no identity.
// That is the whole difference from the storeCrypto.js path this replaces, where the server held
// a master secret and a `store_content_keys` row — lose the database there and every gated post
// was unreadable forever. Here a lost database costs an index and nothing else.
//
// The identity keypair is a child of the app-wide security vault (src/lib/securityVault.js) under
// its own label, so it is domain-separated from the community key while still unlocking from the
// same signature + PIN the user already knows.

import ecies from 'eciesjs'
import { Buffer } from 'buffer'
import { unlockMaster, getCachedMasterHex, deriveChildKeyBytes, CHILD_KEY_LABELS } from './securityVault'
import HupSellABI from '@/abis/HupSell.json'

export const sellVaultSessionKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''}sell_vault_unlocked`

function identityFromSeed(seedBytes) {
  const privKey = new ecies.PrivateKey(seedBytes)
  const pubKeyHex = privKey.publicKey.toHex(false)

  return {
    privKeyHex: Buffer.from(seedBytes).toString('hex'),
    pubKeyHex: pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`,
  }
}

/**
 * Derives the sell identity keypair via the security vault's master secret. Reproducible on any
 * device from the same wallet + same security PIN, which is what makes a buyer's access portable
 * without anything being escrowed on a server.
 * @param {string} address - the connected wallet address
 * @param {string} pin - the user's security PIN
 * @param {(args: { message: string }) => Promise<string>} signMessageAsync - wagmi's useSignMessage().signMessageAsync
 */
export async function deriveSellIdentity(address, pin, signMessageAsync) {
  const masterHex = await unlockMaster(address, pin, signMessageAsync)
  const seedBytes = await deriveChildKeyBytes(masterHex, CHILD_KEY_LABELS.sellVault)
  return identityFromSeed(seedBytes)
}

/** Derives the identity with no prompt when the vault is already unlocked. Null if locked. */
export async function deriveIdentityFromCachedMaster() {
  const masterHex = getCachedMasterHex()
  if (!masterHex) return null

  const seedBytes = await deriveChildKeyBytes(masterHex, CHILD_KEY_LABELS.sellVault)
  return identityFromSeed(seedBytes)
}

export function cacheUnlockedIdentity(privKeyHex) {
  sessionStorage.setItem(sellVaultSessionKey, privKeyHex)
}

export function getCachedIdentityPrivKeyHex() {
  return sessionStorage.getItem(sellVaultSessionKey)
}

export function clearCachedIdentity() {
  sessionStorage.removeItem(sellVaultSessionKey)
}

/**
 * The identity for this session, deriving and caching it promptlessly if the vault is unlocked.
 * Returns null when the vault is locked and the caller must ask for the PIN.
 */
export async function resolveIdentity() {
  const cached = getCachedIdentityPrivKeyHex()
  if (cached) return { privKeyHex: cached, pubKeyHex: pubKeyFromPrivKeyHex(cached) }

  const derived = await deriveIdentityFromCachedMaster()
  if (!derived) return null

  cacheUnlockedIdentity(derived.privKeyHex)
  return derived
}

export function pubKeyFromPrivKeyHex(privKeyHex) {
  const clean = privKeyHex.startsWith('0x') ? privKeyHex.slice(2) : privKeyHex
  const pubKeyHex = new ecies.PrivateKey(Buffer.from(clean, 'hex')).publicKey.toHex(false)
  return pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`
}

// --- Content-key wrap/unwrap (ECIES, same call shape as communityVault.js) ---

export function generateContentKey() {
  return window.crypto.getRandomValues(new Uint8Array(32))
}

export function wrapContentKey(rawContentKeyBytes, recipientPubKeyHex) {
  const pubKeyHex = recipientPubKeyHex.startsWith('0x') ? recipientPubKeyHex : `0x${recipientPubKeyHex}`
  const wrapped = ecies.encrypt(pubKeyHex, Buffer.from(rawContentKeyBytes))
  // eciesjs returns a Uint8Array, NOT a Buffer — Uint8Array.toString('hex') silently ignores the
  // argument and yields comma-separated decimals, which poisons the tx calldata. Wrap in Buffer.
  return `0x${Buffer.from(wrapped).toString('hex')}`
}

export function unwrapContentKey(wrappedHex, privKeyHex) {
  const cleanWrapped = wrappedHex.startsWith('0x') ? wrappedHex.slice(2) : wrappedHex
  const cleanPriv = privKeyHex.startsWith('0x') ? privKeyHex.slice(2) : privKeyHex
  const decrypted = ecies.decrypt(Buffer.from(cleanPriv, 'hex'), Buffer.from(cleanWrapped, 'hex'))
  return new Uint8Array(decrypted)
}

// --- Content encrypt/decrypt (AES-256-GCM via Web Crypto) ---

/**
 * Encrypts a listing's payload under a fresh content key. The returned envelope is what gets
 * uploaded to IPFS and pointed at by the listing's contentURI; the key never leaves the browser
 * until it is wrapped for a specific buyer.
 */
export async function encryptContent(rawContentKeyBytes, plaintextObj) {
  const key = await window.crypto.subtle.importKey('raw', rawContentKeyBytes, 'AES-GCM', false, ['encrypt'])
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(plaintextObj)))

  return {
    v: 1,
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  }
}

export async function decryptContent(rawContentKeyBytes, ivBase64, ciphertextBase64) {
  const key = await window.crypto.subtle.importKey('raw', rawContentKeyBytes, 'AES-GCM', false, ['decrypt'])
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(ivBase64, 'base64') },
    key,
    Buffer.from(ciphertextBase64, 'base64'),
  )

  return JSON.parse(new TextDecoder().decode(decrypted))
}

// --- One-shot resolution for render sites ---

/**
 * Best-effort decryption of a gated post for the connected viewer. Promptless: only uses an
 * identity already unlocked this session. Returns null when the viewer holds no key — which is
 * the same answer for "never bought it" and "bought it, seller has not granted yet", because
 * neither is something the client can distinguish without the onchain read it already did.
 * @returns the decrypted content object, or null.
 */
export async function tryDecryptGatedContent(publicClient, contractAddress, viewerAddress, postId, envelope) {
  if (!envelope?.ciphertext || !publicClient || !contractAddress || !viewerAddress) return null

  const identity = await resolveIdentity()
  if (!identity) return null

  try {
    const wrapped = await publicClient.readContract({
      address: contractAddress,
      abi: HupSellABI,
      functionName: 'wrappedKeys',
      args: [BigInt(postId), viewerAddress],
    })
    if (!wrapped || wrapped === '0x') return null

    const rawKey = unwrapContentKey(wrapped, identity.privKeyHex)
    return await decryptContent(rawKey, envelope.iv, envelope.ciphertext)
  } catch {
    return null
  }
}
