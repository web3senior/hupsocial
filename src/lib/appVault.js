import CryptoJS from 'crypto-js'
import ecies from 'eciesjs'
import { ethers } from 'ethers'
import { decryptData, encryptData } from './cryptoHelper'

export const ENCRYPTED_APP_KEY_STORAGE = 'encryptedAppKey'
export const APP_PASSWORD_SESSION_STORAGE = 'localPassword'

const LAST_WALLET_KEY = '_lastWallet'

// Clears all vault / burner / session keys when the connected wallet changes.
// Call this at the start of any effect that reads vault data.
// Returns true if stale data was cleared.
export function clearVaultIfWalletChanged(address) {
  if (!address || typeof window === 'undefined') return false
  const current = address.toLowerCase()
  const last = localStorage.getItem(LAST_WALLET_KEY)
  localStorage.setItem(LAST_WALLET_KEY, current)
  if (!last || last === current) return false

  const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''
  localStorage.removeItem(ENCRYPTED_APP_KEY_STORAGE)
  localStorage.removeItem(`${prefix}chat_burner_key`)
  localStorage.removeItem(`${prefix}chat_burner_address`)
  sessionStorage.removeItem(APP_PASSWORD_SESSION_STORAGE)
  sessionStorage.removeItem(`${prefix}chat_unlocked_burner_key`)
  return true
}

function normalizePrivateKeyHex(rawHex) {
  if (!rawHex || typeof rawHex !== 'string') return null
  const withoutPrefix = rawHex.startsWith('0x') ? rawHex.slice(2) : rawHex
  return /^[0-9a-fA-F]{64}$/.test(withoutPrefix) ? withoutPrefix.toLowerCase() : null
}

function decryptLegacyPayloadWithPassword(encryptedKey, password) {
  if (!password) return null
  const bytesKey = CryptoJS.AES.decrypt(encryptedKey, password)
  const decrypted = bytesKey.toString(CryptoJS.enc.Utf8)
  return normalizePrivateKeyHex(decrypted) ? decrypted : null
}

async function decryptAppPrivateKeyHex(encryptedKey, sessionPassword) {
  try {
    return await decryptData(encryptedKey, sessionPassword)
  } catch {
    const legacyWithPlainPassword = decryptLegacyPayloadWithPassword(encryptedKey, sessionPassword)
    if (legacyWithPlainPassword) {
      return legacyWithPlainPassword
    }

    const legacySecret = process.env.NEXT_PUBLIC_ENCRYPTION_KEY
    if (!legacySecret) {
      throw new Error('Failed to decrypt key with current vault format.')
    }

    const bytesPass = CryptoJS.AES.decrypt(sessionPassword, legacySecret)
    const originalPassword = bytesPass.toString(CryptoJS.enc.Utf8)
    if (!originalPassword) {
      throw new Error('Legacy password payload is invalid.')
    }

    const legacyWithEncryptedPassword = decryptLegacyPayloadWithPassword(encryptedKey, originalPassword)
    if (!legacyWithEncryptedPassword) {
      throw new Error('Legacy key payload is invalid.')
    }

    return legacyWithEncryptedPassword
  }
}

async function decryptAppPrivateKeyHexWithPassword(encryptedKey, password) {
  try {
    return await decryptData(encryptedKey, password)
  } catch {
    const decrypted = decryptLegacyPayloadWithPassword(encryptedKey, password)
    if (!decrypted) {
      throw new Error('Invalid password or unsupported key payload.')
    }
    return decrypted
  }
}

export async function lockAppPrivateKey(rawPrivateKeyHex, password) {
  return encryptData(rawPrivateKeyHex, password)
}

export async function unlockAppKeyFromStorage() {
  const encryptedKey = localStorage.getItem(ENCRYPTED_APP_KEY_STORAGE)
  const sessionPassword = sessionStorage.getItem(APP_PASSWORD_SESSION_STORAGE)
  if (!encryptedKey || !sessionPassword) return null

  const decryptedKeyHex = await decryptAppPrivateKeyHex(encryptedKey, sessionPassword)
  const cleanPrivateKey = normalizePrivateKeyHex(decryptedKeyHex)
  if (!cleanPrivateKey) {
    throw new Error('Invalid decrypted private key format.')
  }

  const privKey = new ecies.PrivateKey(ethers.getBytes(`0x${cleanPrivateKey}`))
  const pubKeyHex = privKey.publicKey.toHex(false)
  const formattedPubKey = pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`

  return {
    privKey,
    privKeyHex: cleanPrivateKey,
    pubKey: formattedPubKey,
    privateKeyHash: ethers.keccak256(`0x${cleanPrivateKey}`),
  }
}

export async function unlockAppKeyWithPassword(password) {
  if (!password) {
    throw new Error('Password is required.')
  }

  const encryptedKey = localStorage.getItem(ENCRYPTED_APP_KEY_STORAGE)
  if (!encryptedKey) {
    throw new Error('No encrypted app key found.')
  }

  const decryptedKeyHex = await decryptAppPrivateKeyHexWithPassword(encryptedKey, password)
  const cleanPrivateKey = normalizePrivateKeyHex(decryptedKeyHex)
  if (!cleanPrivateKey) {
    throw new Error('Decrypted private key is invalid.')
  }

  sessionStorage.setItem(APP_PASSWORD_SESSION_STORAGE, password)

  const privKey = new ecies.PrivateKey(ethers.getBytes(`0x${cleanPrivateKey}`))
  const pubKeyHex = privKey.publicKey.toHex(false)
  const formattedPubKey = pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`

  return {
    privKey,
    privKeyHex: cleanPrivateKey,
    pubKey: formattedPubKey,
    privateKeyHash: ethers.keccak256(`0x${cleanPrivateKey}`),
  }
}
