/**
 * @file lib/burnerStorage.js
 * @description Where the in-app wallet (the burner session key) is kept on this device, one slot
 * per connected wallet.
 *
 * The key at rest is encrypted under its owner's vault master, so it is only ever usable by the
 * wallet that made it. A single device-wide slot meant that connecting a second wallet tried the
 * first wallet's key against the second wallet's vault — which fails, and was reported as a wrong
 * passphrase. Every slot below is therefore suffixed with the owner's address, and so is the
 * tab's unlocked copy, so a switch in the same tab cannot sign with the previous wallet's key.
 *
 * Keys stored before this carry no owner. They stay in the old unsuffixed slot until a wallet's
 * vault actually opens one, which is the proof of ownership; it is then moved into that wallet's
 * slot (see claimLegacyBurner). A wallet whose vault cannot open it is marked as not its owner
 * and from then on simply has no session key here, leaving the slot for the wallet it belongs to.
 * A wallet that writes a key of its own (an import) gets its own slot, which then wins over the
 * unowned one for it.
 */

import { getConnection } from 'wagmi/actions'
import { config } from '@/config/wagmi'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''

// --- Fields ---

export const BURNER_FIELDS = Object.freeze({
  key: 'burner_key',
  address: 'burner_address',
  // Which vault the stored key belongs to: 'v2' (Key Vault v2) or absent for v1
  version: 'burner_key_version',
  // After an upgrade, the v1 key re-encrypted under the v2 master
  legacy: 'burner_key_legacy',
})

const UNLOCKED_FIELD = 'unlocked_burner_key'
const FOREIGN_FIELD = 'burner_legacy_foreign'

const unownedKey = (field) => `${prefix}${field}`
const ownedKey = (field, owner) => `${prefix}${field}_${owner}`

// --- Owner ---

/** The wallet connected right now, lowercased, or null. Every slot belongs to it. */
export const burnerOwner = () => {
  if (typeof window === 'undefined') return null
  try {
    return getConnection(config)?.address?.toLowerCase() ?? null
  } catch {
    return null
  }
}

const requireOwner = () => {
  const owner = burnerOwner()
  if (!owner) throw Object.assign(new Error('Connect your wallet first'), { code: 'NO_WALLET' })
  return owner
}

const readLocal = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// --- Unowned slot (stored before keys had an owner) ---

const hasUnownedBurner = () => Boolean(readLocal(unownedKey(BURNER_FIELDS.key)) && readLocal(unownedKey(BURNER_FIELDS.address)))

const isForeignTo = (owner) => readLocal(ownedKey(FOREIGN_FIELD, owner)) === '1'

/**
 * Whether the connected wallet is reading the unowned slot rather than one of its own — i.e. the
 * key may belong to another wallet, and failing to open it says nothing about the passphrase.
 */
export const isBurnerUnclaimed = () => {
  const owner = burnerOwner()
  return Boolean(owner) && !readLocal(ownedKey(BURNER_FIELDS.key, owner)) && hasUnownedBurner() && !isForeignTo(owner)
}

/** Moves the unowned slot into the connected wallet's, once its vault has opened the key. */
export const claimLegacyBurner = () => {
  if (!isBurnerUnclaimed()) return
  const owner = burnerOwner()
  for (const field of Object.values(BURNER_FIELDS)) {
    const value = readLocal(unownedKey(field))
    if (value === null) continue
    localStorage.setItem(ownedKey(field, owner), value)
    localStorage.removeItem(unownedKey(field))
  }
}

/** Records that the unowned key is not the connected wallet's: its vault could not open it. */
export const disownLegacyBurner = () => {
  if (!isBurnerUnclaimed()) return
  localStorage.setItem(ownedKey(FOREIGN_FIELD, burnerOwner()), '1')
}

// --- Reads & writes ---

/** One field of the connected wallet's session key, or null. Not connected reads as no key. */
export const readBurner = (field) => {
  const owner = burnerOwner()
  if (!owner) return null
  if (readLocal(ownedKey(BURNER_FIELDS.key, owner))) return readLocal(ownedKey(field, owner))
  return isBurnerUnclaimed() ? readLocal(unownedKey(field)) : null
}

/**
 * Sets fields of the connected wallet's session key in its own slot; null removes one. It never
 * claims the unowned slot: a wallet importing a key has not proven the old one is its own, and
 * claiming here would overwrite another wallet's key. Code that has just opened the unowned key
 * calls claimLegacyBurner before writing to it.
 * @param {Partial<Record<keyof BURNER_FIELDS, string|null>>} values
 */
export const writeBurner = (values) => {
  const owner = requireOwner()
  for (const [name, value] of Object.entries(values)) {
    const key = ownedKey(BURNER_FIELDS[name], owner)
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  }
}

// --- Tab cache ---

/** The connected wallet's session key as plaintext, when unlocked in this tab. */
export const readUnlockedBurner = () => {
  const owner = burnerOwner()
  if (!owner) return null
  try {
    return sessionStorage.getItem(ownedKey(UNLOCKED_FIELD, owner))
  } catch {
    return null
  }
}

export const writeUnlockedBurner = (privateKey) => sessionStorage.setItem(ownedKey(UNLOCKED_FIELD, requireOwner()), privateKey)

/** Locks the session key in this tab — every wallet's, plus the copy kept before keys had owners. */
export const clearUnlockedBurners = () => {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key === unownedKey(UNLOCKED_FIELD) || key.startsWith(`${unownedKey(UNLOCKED_FIELD)}_`)) sessionStorage.removeItem(key)
    }
  } catch {
    // Nothing cached to clear
  }
}
