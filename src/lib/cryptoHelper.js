/**
 * Utility for encrypting/decrypting private keys, session caching, 
 * retrieving the authenticated wallet, and sending transactions.
 * Uses native browser Web Crypto API (AES-GCM 256-bit).
 */

import { ethers } from 'ethers'

const localStorageBurnerKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''}burner_key`
const sessionStorageUnlockedKey = `hup_unlocked_burner_key`

// Internal helper to derive a cryptographic key from a password and salt
async function deriveKey(password, salt) {
  const enc = new TextEncoder()
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  )
  
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypts a plaintext string (private key) using a password.
 * Returns a self-contained Base64 encoded string: salt (16 bytes) + iv (12 bytes) + ciphertext.
 */
export async function encryptData(plaintext, password) {
  try {
    const enc = new TextEncoder()
    const salt = window.crypto.getRandomValues(new Uint8Array(16))
    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    const aesKey = await deriveKey(password, salt)

    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      aesKey,
      enc.encode(plaintext)
    )

    // Combine salt, iv, and ciphertext into a single Uint8Array
    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
    combined.set(salt, 0)
    combined.set(iv, salt.length)
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

    // Convert to a clean Base64 string for localStorage
    return btoa(String.fromCharCode.apply(null, combined))
  } catch (error) {
    console.error('Encryption failed:', error)
    throw new Error('Failed to encrypt private key.')
  }
}

/**
 * Decrypts a Base64 ciphertext string using a password.
 */
export async function decryptData(encryptedBase64, password) {
  try {
    const enc = new TextEncoder()
    const dec = new TextDecoder()

    // Decode the base64 string back into a binary array
    const combined = new Uint8Array(
      atob(encryptedBase64)
        .split('')
        .map((char) => char.charCodeAt(0))
    )

    // Extract salt, iv, and ciphertext segments
    const salt = combined.slice(0, 16)
    const iv = combined.slice(16, 28)
    const ciphertext = combined.slice(28)

    const aesKey = await deriveKey(password, salt)

    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      aesKey,
      ciphertext
    )

    return dec.decode(decrypted)
  } catch (error) {
    console.error('Decryption failed:', error)
    throw new Error('Decryption failed. Incorrect password.')
  }
}

/**
 * Determines if a stored string is an encrypted ciphertext or standard unencrypted hex key.
 */
export function isPrivateKeyEncrypted(key) {
  if (!key) return false
  // Standard hex keys start with '0x' or are 64-char hex strings
  return !key.startsWith('0x') && key.length > 66
}

/**
 * Determines if the session key is unlocked and ready in memory.
 */
export function isSessionUnlocked() {
  const cachedKey = sessionStorage.getItem(sessionStorageUnlockedKey)
  if (cachedKey) return true

  const storedKey = localStorage.getItem(localStorageBurnerKey)
  if (!storedKey) return false

  // If it's stored legacy (not encrypted), it is always functionally "unlocked"
  return !isPrivateKeyEncrypted(storedKey)
}

/**
 * Retrieves the authenticated burner wallet instance.
 * Automatically handles caching and legacy plain text formats.
 * 
 * @param {string|null} password - Optional password. If omitted and key is encrypted, throws 'PASSWORD_REQUIRED'.
 * @returns {ethers.Wallet|null} Wallet instance or null if no key is stored.
 */
export async function getSessionWallet(password = null) {
  // 1. Check in-memory cache first (very fast, avoids password prompt)
  const cachedKey = sessionStorage.getItem(sessionStorageUnlockedKey)
  if (cachedKey) {
    return new ethers.Wallet(cachedKey)
  }

  const storedKey = localStorage.getItem(localStorageBurnerKey)
  if (!storedKey) return null

  // 2. Backward compatibility: if key isn't encrypted, return it immediately
  if (!isPrivateKeyEncrypted(storedKey)) {
    return new ethers.Wallet(storedKey)
  }

  // 3. Encrypted key requires password
  if (!password) {
    throw new Error('PASSWORD_REQUIRED')
  }

  const decryptedKey = await decryptData(storedKey, password)
  
  // Cache in sessionStorage for fast future lookup
  sessionStorage.setItem(sessionStorageUnlockedKey, decryptedKey)
  
  return new ethers.Wallet(decryptedKey)
}

/**
 * Locks the session by wiping the in-memory decrypted private key.
 * Does not delete the encrypted key from localStorage.
 */
export function lockSession() {
  sessionStorage.removeItem(sessionStorageUnlockedKey)
}

/**
 * Connects the burner wallet to a provider and signs/sends a transaction.
 * Bubbles up 'PASSWORD_REQUIRED' if the wallet needs to be unlocked.
 * 
 * @param {object} txData - The transaction payload (to, value, data, gasLimit, etc.).
 * @param {ethers.providers.Provider|null} customProvider - Optional custom provider instance.
 * @param {string|null} password - Optional password if decryption is needed.
 * @returns {Promise<ethers.providers.TransactionResponse>} The submitted transaction response.
 */
export async function executeBurnerTransaction(txData, customProvider = null, password = null) {
  // 1. Retrieve wallet (will throw 'PASSWORD_REQUIRED' if key is encrypted and no password/cache is available)
  const wallet = await getSessionWallet(password)
  
  if (!wallet) {
    throw new Error('NO_WALLET_FOUND')
  }

  // 2. Establish connection to provider
  let provider = customProvider
  if (!provider) {
    if (typeof window !== 'undefined' && window.ethereum) {
      provider = new ethers.providers.Web3Provider(window.ethereum)
    } else {
      throw new Error('NO_PROVIDER_AVAILABLE')
    }
  }

  // 3. Bind wallet to provider and broadcast transaction
  const signer = wallet.connect(provider)
  return await signer.sendTransaction(txData)
}