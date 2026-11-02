/**
 * @file lib/keyVaultV2.js
 * @description Browser side of Key Vault v2 (derivation in lib/keyDerivationV2.mjs). One unlock is
 * one signature of the fixed KeyDerivation message plus the passphrase. Hup stores nothing: the
 * same wallet and passphrase bring back the same keys on any device, and nobody else can.
 *
 * Each device keeps two small things in localStorage, neither of which derives a key on its own:
 *   check   a verifier of the master, so a mistyped passphrase is caught instead of quietly
 *           opening a different, empty set of keys
 *   legacy  the v1 vault master, encrypted under a v2 child key, so one v2 unlock also opens the
 *           features still on v1 (communities, sell and task vaults)
 *
 * The master is cached for the tab like v1's, but it lapses after 30 idle minutes.
 */

import { hexToBytes } from '@noble/hashes/utils.js'
import { wordlists } from 'ethers'
import { hashTypedData } from 'viem'
import {
  deriveChildV2,
  deriveEvmKeyV2,
  deriveMasterV2,
  KEY_LABELS,
  keyDerivationTypedData,
  masterToHex,
  normalizeSignature,
  PASSPHRASE_MIN_LENGTH,
  passphraseVerifierV2,
} from './keyDerivationV2.mjs'
import { decryptData, encryptData } from './cryptoHelper'
import { getCachedMasterHex, masterSecretSessionKey } from './securityVault'
import { requestVaultUnlock } from './vaultUnlockBus'
import { getConnection } from 'wagmi/actions'
import { config } from '@/config/wagmi'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''
export const masterV2SessionKey = `${prefix}security_vault_master_v2`
const checkStorageKey = (address) => `${prefix}key_vault_v2_check_${address.toLowerCase()}`
const legacyStorageKey = (address) => `${prefix}key_vault_v2_legacy_${address.toLowerCase()}`

const IDLE_TIMEOUT_MS = 30 * 60 * 1000

const codedError = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra })

const readLocal = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeLocal = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode: the vault still works, it just asks for the passphrase twice next time
  }
}

// --- Cache ---

/** The unlocked v2 master as hex, or null when locked or idle past the timeout. Touching counts as use. */
/** The wallet connected right now, lowercased, or null. */
const connectedAddress = () => {
  try {
    return getConnection(config)?.address?.toLowerCase() ?? null
  } catch {
    return null
  }
}

export const getCachedMasterV2 = () => {
  if (typeof window === 'undefined') return null
  try {
    const stored = JSON.parse(sessionStorage.getItem(masterV2SessionKey) || 'null')
    if (!stored?.hex) return null
    if (Date.now() - stored.touchedAt > IDLE_TIMEOUT_MS) {
      sessionStorage.removeItem(masterV2SessionKey)
      return null
    }
    // A master belongs to the wallet that opened it: after a switch, the new wallet opens its own.
    // Otherwise one wallet's vault would derive — and sign as — another wallet's agents.
    const connected = connectedAddress()
    if (connected && stored.address && stored.address.toLowerCase() !== connected) {
      sessionStorage.removeItem(masterV2SessionKey)
      return null
    }
    sessionStorage.setItem(masterV2SessionKey, JSON.stringify({ ...stored, touchedAt: Date.now() }))
    return stored.hex
  } catch {
    return null
  }
}

const cacheMasterV2 = (hex, address) => sessionStorage.setItem(masterV2SessionKey, JSON.stringify({ hex, address, touchedAt: Date.now() }))

export const clearMasterV2 = () => sessionStorage.removeItem(masterV2SessionKey)

// --- Device check ---

/** Whether this device has seen this wallet's passphrase before. When not, the UI asks for it twice. */
export const hasDeviceCheck = (address) => Boolean(address && readLocal(checkStorageKey(address)))

/**
 * Drops this device's memory of the passphrase and the open master. Used when a derived key turns
 * out not to match a known address — the passphrase was wrong, typed the same wrong way twice —
 * and when the owner chooses to start over with a new passphrase.
 */
export const forgetDeviceCheck = (address) => {
  if (address) writeLocal(checkStorageKey(address), null)
  clearMasterV2()
}

/**
 * Drops the open master after a key derived from it failed to match a known address (an agent's,
 * the in-app wallet's), along with the device check it set — that check would otherwise keep
 * refusing the right passphrase.
 */
export const rejectMasterV2 = () => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(masterV2SessionKey) || 'null')
    if (stored?.address) writeLocal(checkStorageKey(stored.address), null)
  } catch {
    // Nothing cached to reject
  }
  clearMasterV2()
}

// --- Unlock ---

const sameBytes = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index])

const isDeclined = (error) => /rejected|denied|cancel/i.test(error?.shortMessage || error?.message || '') || error?.code === 4001

/* Typed data first. The Universal Profile extension refuses eth_signTypedData_v4 outright and
   points at eth_sign instead, so a wallet that cannot sign typed data has its controller sign the
   same EIP-712 digest as a message — still deterministic, so it still reproduces the same keys.
   A declined prompt is the user's answer, never a reason to ask a second way. */
const signKeyDerivation = async ({ address, signTypedDataAsync, signMessageAsync }) => {
  const typedData = keyDerivationTypedData(address)
  try {
    return await signTypedDataAsync(typedData)
  } catch (error) {
    if (isDeclined(error) || typeof signMessageAsync !== 'function') throw error
    return signMessageAsync({ message: { raw: hashTypedData(typedData) } })
  }
}

/**
 * Opens the v2 vault. On a device that has not seen this wallet's passphrase, the fixed signature
 * is asked for twice: a wallet that signs differently each time (passkey smart wallets) would
 * derive keys nobody could ever recover, so it is refused before anything is made from it.
 *
 * @param {{address: string, passphrase: string, signTypedDataAsync: Function, signMessageAsync?: Function}} params
 *   `signMessageAsync` is the fallback for wallets without typed data (the UP extension).
 * @returns {Promise<{masterHex: string, firstOnDevice: boolean}>}
 * @throws {Error} codes: PASSPHRASE_TOO_SHORT, NONDETERMINISTIC_SIGNER, WRONG_PASSPHRASE, or the
 *   wallet's own rejection.
 */
export const unlockMasterV2 = async ({ address, passphrase, signTypedDataAsync, signMessageAsync }) => {
  const cached = getCachedMasterV2()
  if (cached) return { masterHex: cached, firstOnDevice: false }

  if (typeof passphrase !== 'string' || passphrase.normalize('NFKC').length < PASSPHRASE_MIN_LENGTH) {
    throw codedError(`Your passphrase is at least ${PASSPHRASE_MIN_LENGTH} characters`, 'PASSPHRASE_TOO_SHORT')
  }

  const storedCheck = readLocal(checkStorageKey(address))
  const signers = { address, signTypedDataAsync, signMessageAsync }
  const signature = await signKeyDerivation(signers)

  if (!storedCheck) {
    const again = await signKeyDerivation(signers)
    if (!sameBytes(normalizeSignature(signature), normalizeSignature(again))) {
      throw codedError(
        'This wallet signs differently every time, so keys made from it could never be recovered. Use a regular wallet such as MetaMask or a Universal Profile.',
        'NONDETERMINISTIC_SIGNER',
      )
    }
  }

  const master = await deriveMasterV2({ signature, passphrase })
  const check = passphraseVerifierV2(master)
  if (storedCheck && storedCheck !== check) throw codedError('That passphrase does not open your Key Vault', 'WRONG_PASSPHRASE')

  const masterHex = masterToHex(master)
  writeLocal(checkStorageKey(address), check)
  cacheMasterV2(masterHex, address)
  await restoreLegacyMaster(address, masterHex)

  return { masterHex, firstOnDevice: !storedCheck }
}

/**
 * The v2 master, opening the shared unlock dialog when it is locked.
 * @param {{reason?: string}} [context]
 * @returns {Promise<string>} Master hex.
 */
export const ensureMasterV2 = async (context = {}) => {
  const cached = getCachedMasterV2()
  if (cached) return cached
  await requestVaultUnlock({ ...context, version: 'v2' })
  const opened = getCachedMasterV2()
  if (!opened) throw codedError('Key Vault is still locked', 'VAULT_LOCKED')
  return opened
}

// --- Passphrase ---

const GENERATED_WORDS = 6

/**
 * Six random words from the BIP-39 English list: 66 bits, far past what offline guessing reaches,
 * and still something a person can write down or remember.
 */
export const generatePassphrase = () => {
  const list = wordlists.en
  const picks = crypto.getRandomValues(new Uint16Array(GENERATED_WORDS))
  // 2048 words divide 65536 evenly, so the modulo carries no bias
  return Array.from(picks, (value) => list.getWord(value % 2048)).join('-')
}

// --- Derived keys ---

/** An EVM private key for `label` under the unlocked master. */
export const deriveKeyFromMasterV2 = (masterHex, label) => deriveEvmKeyV2(hexToBytes(masterHex), label)

// --- Legacy (v1) master ---

const legacyWrapKey = (masterHex) => masterToHex(deriveChildV2(hexToBytes(masterHex), KEY_LABELS.legacyWrap))

const restoreLegacyMaster = async (address, masterHex) => {
  const wrapped = readLocal(legacyStorageKey(address))
  if (!wrapped || getCachedMasterHex()) return
  try {
    sessionStorage.setItem(masterSecretSessionKey, await decryptData(wrapped, legacyWrapKey(masterHex)))
  } catch {
    // A wrap made under an earlier passphrase; the v1 vault still opens on its own in Settings
  }
}

/** Whether this device already links the v1 vault to the v2 one for this wallet. */
export const hasLegacyWrap = (address) => Boolean(address && readLocal(legacyStorageKey(address)))

/**
 * Stores the open v1 master wrapped under the open v2 one on this device, so the next v2 unlock
 * here restores both. A no-op unless both are open.
 * @returns {Promise<boolean>} Whether a wrap was stored.
 */
export const wrapLegacyMaster = async (address) => {
  const v1 = getCachedMasterHex()
  const v2 = getCachedMasterV2()
  if (!address || !v1 || !v2) return false
  writeLocal(legacyStorageKey(address), await encryptData(v1, legacyWrapKey(v2)))
  return true
}
