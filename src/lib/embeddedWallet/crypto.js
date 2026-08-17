/**
 * @file lib/embeddedWallet/crypto.js
 * @description Browser-side key material handling for the email embedded wallet.
 *
 * Custody model: the private key is generated here and never leaves the browser
 * whole. Day to day it exists as two XOR halves — a device share parked in
 * IndexedDB and a server share the keystore route releases to the signed-in
 * owner — joined in memory to sign. Recovery is a scrypt-stretched,
 * AES-256-GCM-encrypted copy of the full key (the "backup blob") that only the
 * recovery password opens; the server stores it opaque. A 2-of-2 XOR split is
 * information-theoretically secure: either half alone reveals nothing.
 */

import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'
import { validateMnemonic } from '@scure/bip39'
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'

// OWASP's "sensitive storage" scrypt cost (~128 MB, ~1s in-browser): the blob
// guards a private key, so the KDF is what stands between a DB leak and a
// brute-forced recovery password. Serialized into kdf_params so parameters can
// be raised later without breaking existing blobs.
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1, dkLen: 32 }

const DB_NAME = 'hup-embedded-wallet'
const STORE = 'shares'
const DEVICE_SHARE_KEY = 'device-share'
const MARKER_KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || '__hup-v1-'}embedded-wallet`

// --- Hex / bytes ---

const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

const hexToBytes = (hex) => {
  const clean = hex.replace(/^0x/, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

// --- Key generation and 2-of-2 split ---

/** @returns {{privateKey: `0x${string}`, address: `0x${string}`}} */
export const createWalletKey = () => {
  const privateKey = generatePrivateKey()
  return { privateKey, address: privateKeyToAccount(privateKey).address }
}

/**
 * Import an existing wallet: a raw private key (with or without 0x) or a
 * 12–24 word seed phrase. Seeds derive the standard first account
 * (m/44'/60'/0'/0/0 — what MetaMask shows as Account 1), so an imported
 * phrase lands on the address the user already knows.
 * @param {string} input
 * @returns {{privateKey: `0x${string}`, address: `0x${string}`}}
 * @throws when the input is neither a valid key nor a valid phrase
 */
export const importWalletKey = (input) => {
  const trimmed = String(input || '').trim()

  if (/^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
    const privateKey = (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`).toLowerCase()
    return { privateKey, address: privateKeyToAccount(privateKey).address }
  }

  const words = trimmed.toLowerCase().split(/\s+/)
  if (words.length >= 12 && words.length <= 24) {
    const mnemonic = words.join(' ')
    // mnemonicToAccount derives from ANY words — the BIP-39 checksum check is
    // what catches typos and swapped words before they become a wrong wallet
    if (!validateMnemonic(mnemonic, englishWordlist)) {
      throw new Error('That seed phrase is not valid — check the words and their order')
    }
    const account = mnemonicToAccount(mnemonic)
    const keyBytes = account.getHdKey().privateKey
    return { privateKey: `0x${bytesToHex(keyBytes)}`, address: account.address }
  }

  throw new Error('Enter a private key (64 hex characters) or a 12–24 word seed phrase')
}

/** One-time pad split; both outputs are plain 64-char hex without 0x. */
export const splitKey = (privateKey) => {
  const key = hexToBytes(privateKey)
  const pad = crypto.getRandomValues(new Uint8Array(key.length))
  const other = key.map((byte, i) => byte ^ pad[i])
  return { deviceShare: bytesToHex(pad), serverShare: bytesToHex(other) }
}

/** @returns {`0x${string}`} the private key */
export const joinShares = (deviceShare, serverShare) => {
  const a = hexToBytes(deviceShare)
  const b = hexToBytes(serverShare)
  if (a.length !== 32 || b.length !== 32) throw new Error('Malformed key shares')
  return `0x${bytesToHex(a.map((byte, i) => byte ^ b[i]))}`
}

// --- Recovery backup (scrypt + AES-256-GCM) ---

const deriveAesKey = async (password, salt, params) => {
  const bits = await scryptAsync(password.normalize('NFKC'), salt, params)
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export const serializeKdfParams = () => JSON.stringify({ kdf: 'scrypt', ...SCRYPT_PARAMS })

/** @returns {Promise<string>} opaque JSON blob safe to store server-side */
export const encryptBackup = async (privateKey, password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await deriveAesKey(password, salt, SCRYPT_PARAMS)
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, hexToBytes(privateKey))
  return JSON.stringify({ v: 1, salt: bytesToHex(salt), iv: bytesToHex(iv), data: bytesToHex(new Uint8Array(sealed)) })
}

/**
 * @param {string} blob as produced by encryptBackup
 * @param {string} kdfParams as stored alongside it
 * @returns {Promise<`0x${string}`>} the private key
 * @throws when the password is wrong (GCM authentication fails)
 */
export const decryptBackup = async (blob, kdfParams, password) => {
  const { salt, iv, data } = JSON.parse(blob)
  const { N, r, p, dkLen } = JSON.parse(kdfParams)
  const aesKey = await deriveAesKey(password, hexToBytes(salt), { N, r, p, dkLen })
  const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(iv) }, aesKey, hexToBytes(data))
  return `0x${bytesToHex(new Uint8Array(opened))}`
}

// --- Device share persistence ---
// IndexedDB records (one per account, keyed by wallet address) plus a
// synchronous localStorage marker: wagmi's isAuthorized wants a fast answer on
// boot, and reading IndexedDB there would race reconnect. Multiple accounts
// can keep shares on one browser — the login dialog's chooser lists them, and
// switching accounts never destroys the other account's share.

const openDb = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const idbRequest = (mode, run) =>
  openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = run(tx.objectStore(STORE))
        tx.oncomplete = () => {
          db.close()
          resolve(req.result)
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }),
  )

// First deployments stored a single record under a constant key; re-home it
// under its address so pre-chooser wallets appear in the account list.
const migrateLegacyShare = async () => {
  const legacy = await idbRequest('readonly', (store) => store.get(DEVICE_SHARE_KEY))
  if (!legacy?.address) return
  await idbRequest('readwrite', (store) => store.put(legacy, legacy.address.toLowerCase()))
  await idbRequest('readwrite', (store) => store.delete(DEVICE_SHARE_KEY))
}

/** @param {{email: string, address: string, share: string}} record */
export const saveDeviceShare = async (record) => {
  await idbRequest('readwrite', (store) => store.put(record, record.address.toLowerCase()))
  localStorage.setItem(MARKER_KEY, record.address)
}

/** @returns {Promise<{email: string, address: string, share: string} | undefined>} */
export const loadDeviceShare = async (address) => {
  if (!address) return undefined
  await migrateLegacyShare()
  return idbRequest('readonly', (store) => store.get(address.toLowerCase()))
}

/** Every account with a share on this browser, for the login chooser. */
export const listDeviceShares = async () => {
  await migrateLegacyShare()
  const records = await idbRequest('readonly', (store) => store.getAll())
  return (records || []).filter((record) => record?.address && record?.share)
}

/** Forget one account's share; the marker moves to any remaining account. */
export const forgetDeviceShare = async (address) => {
  await idbRequest('readwrite', (store) => store.delete(address.toLowerCase()))
  const remaining = await listDeviceShares()
  if (remaining.length === 0) localStorage.removeItem(MARKER_KEY)
  else localStorage.setItem(MARKER_KEY, remaining[0].address)
}

export const forgetAllDeviceShares = async () => {
  await idbRequest('readwrite', (store) => store.clear())
  localStorage.removeItem(MARKER_KEY)
}

/** Synchronous boot-time hint that at least one device share should exist. */
export const hasDeviceShareMarker = () => typeof window !== 'undefined' && Boolean(localStorage.getItem(MARKER_KEY))
