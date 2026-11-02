/**
 * @file lib/agentKeys.js
 * @description Where a Universal Profile agent's key lives: this browser, and nowhere else.
 *
 * Such a key is an LSP6 controller of the owner's profile, allowed one call (lib/lsp6.js), so it is
 * kept without a passphrase or a wallet signature — what it can do is bounded on the profile
 * itself, and the owner can see, fund and revoke it in their Universal Profile extension. Losing it
 * (another device, cleared site data) loses nothing but the LYX left on it: the agent is restored
 * by making a new key and swapping it in on the profile (agentWallet restoreControllerAgent).
 *
 * At rest it is encrypted with an AES-GCM key this browser made for itself and holds in IndexedDB
 * as a non-extractable CryptoKey: no script can read its bytes, only ask the browser to use it. So
 * the ciphertext in localStorage is worthless anywhere else — a storage dump, a synced or copied
 * profile — though code running on this origin can still use the key, as it could any key here.
 *
 * Stored per owner and key address, so two profiles on one browser never share a key.
 */

import { ethers } from 'ethers'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''
const storageKey = (owner, key) => `${prefix}agent_controller_key_${String(owner).toLowerCase()}_${String(key).toLowerCase()}`

// --- Device key ---

const DB_NAME = `${prefix}hup-agent-keys`
const STORE = 'keys'
const DEVICE_KEY_ID = 'device'

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const openDb = () => {
  const open = indexedDB.open(DB_NAME, 1)
  open.onupgradeneeded = () => open.result.createObjectStore(STORE)
  return request(open)
}

let deviceKeyPromise = null

/** This browser's own AES-GCM key, made on first use. Non-extractable, so it never leaves IndexedDB. */
const deviceKey = () => {
  deviceKeyPromise ??= (async () => {
    const db = await openDb()
    const existing = await request(db.transaction(STORE).objectStore(STORE).get(DEVICE_KEY_ID))
    if (existing) return existing
    const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(created, DEVICE_KEY_ID))
    return created
  })().catch((error) => {
    deviceKeyPromise = null
    throw error
  })
  return deviceKeyPromise
}

// --- Sealing ---

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))

const seal = async (privateKey) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), ethers.getBytes(privateKey)))
  return JSON.stringify({ v: 1, iv: toBase64(iv), data: toBase64(data) })
}

const unseal = async (stored) => {
  const { iv, data } = JSON.parse(stored)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await deviceKey(), fromBase64(data))
  return ethers.hexlify(new Uint8Array(plain))
}

// --- Keys ---

/**
 * The agent key's wallet if this browser holds it, otherwise null — including when the browser's
 * device key is gone (site data partly cleared), which leaves a blob nothing can open.
 */
export const readAgentKey = async (owner, key) => {
  if (typeof window === 'undefined' || !owner || !key) return null
  const slot = storageKey(owner, key)
  try {
    const stored = localStorage.getItem(slot)
    if (!stored) return null

    // Saved before keys were sealed: sealed now, on first read
    const isPlain = stored.startsWith('0x')
    const wallet = new ethers.Wallet(isPlain ? stored : await unseal(stored))
    if (wallet.address.toLowerCase() !== String(key).toLowerCase()) return null
    if (isPlain) localStorage.setItem(slot, await seal(wallet.privateKey))
    return wallet
  } catch {
    return null
  }
}

export const hasAgentKey = async (owner, key) => Boolean(await readAgentKey(owner, key))

/** A fresh key, sealed and saved before anything is registered or granted, so a later step can always be retried. */
export const createAgentKey = async (owner) => {
  const wallet = ethers.Wallet.createRandom()
  localStorage.setItem(storageKey(owner, wallet.address), await seal(wallet.privateKey))
  return new ethers.Wallet(wallet.privateKey)
}

/** A pasted private key as a wallet, with or without its 0x. Nothing is saved. */
export const parseAgentKey = (privateKey) => {
  try {
    const trimmed = String(privateKey ?? '').trim()
    return new ethers.Wallet(trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`)
  } catch {
    throw new Error('That is not a valid private key')
  }
}

/** Seals and saves a key the owner brought, for an agent made from an existing controller. */
export const saveAgentKey = async (owner, wallet) => {
  localStorage.setItem(storageKey(owner, wallet.address), await seal(wallet.privateKey))
  return new ethers.Wallet(wallet.privateKey)
}

/**
 * Puts an exported key back on this browser — the way to bring an agent to a new device with the
 * same key, and the LYX on it, instead of swapping in a new one. Only the agent's current key is
 * accepted: anything else would leave the browser holding a key the profile does not know.
 * @returns {Promise<import('ethers').Wallet>}
 */
export const importAgentKey = async (owner, expected, privateKey) => {
  const wallet = parseAgentKey(privateKey)
  if (wallet.address.toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`That key belongs to ${wallet.address}, not to this agent’s key ${expected}`)
  }
  localStorage.setItem(storageKey(owner, wallet.address), await seal(wallet.privateKey))
  return wallet
}

export const forgetAgentKey = (owner, key) => {
  try {
    localStorage.removeItem(storageKey(owner, key))
  } catch {
    // Nothing stored to forget
  }
}
