/**
 * @file lib/address.js
 * @description The one place that knows what a wallet address looks like on every chain Hup
 * runs on. EVM addresses are `0x` + 40 hex and case-insensitive, so they normalize to lowercase
 * (which is how the database keys them). Solana addresses are 32–44 base58 characters and
 * case-sensitive, so they must never be lowercased — normalizing one means leaving it alone.
 * Dependency-free on purpose: API routes, server components and client code all import it.
 */

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/
// Base58 has no 0, O, I or l, and an EVM address starts with `0x`, so the two never overlap
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export const isEvmAddress = (value) => typeof value === 'string' && EVM_ADDRESS.test(value)

export const isSolanaAddress = (value) => typeof value === 'string' && BASE58_ADDRESS.test(value)

export const isWalletAddress = (value) => isEvmAddress(value) || isSolanaAddress(value)

/**
 * The form an address is stored and compared in: lowercase hex, verbatim base58. Anything
 * that is not a string comes back as null so callers can pass it straight to a query.
 * @param {*} value
 * @returns {string|null}
 */
export const normalizeAddress = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return isEvmAddress(trimmed) ? trimmed.toLowerCase() : trimmed
}

/**
 * Identity check that survives mixed-case hex and case-sensitive base58 alike.
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
export const sameAddress = (left, right) => {
  const a = normalizeAddress(left)
  const b = normalizeAddress(right)
  return Boolean(a && b && a === b)
}

/**
 * `0x1234…abcd` / `ERPA3w…P2Kn` — length-agnostic, so a 32-char Solana key shortens like a
 * 42-char hex one instead of rendering in full.
 * @param {*} value
 * @param {{head?: number, tail?: number}} [options]
 * @returns {string}
 */
export const shortAddress = (value, { head = 6, tail = 4 } = {}) => {
  if (typeof value !== 'string' || !value) return ''
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/**
 * The four characters that follow a display name as its discriminator (`name#1a2b`): the
 * first hex nibbles after `0x`, or the first base58 characters.
 * @param {*} value
 * @returns {string}
 */
export const addressTag = (value) => {
  if (typeof value !== 'string' || !value) return ''
  return isEvmAddress(value) ? value.slice(2, 6) : value.slice(0, 4)
}
