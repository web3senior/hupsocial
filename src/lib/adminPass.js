/**
 * @file lib/adminPass.js
 * @description The admin pass: one signature from the admin wallet that opens the admin page and
 * the private reads behind it (support tickets, post reports) until it runs out. Shared by the
 * client, which signs and carries it, and the server, which checks it — so the message is built
 * in exactly one place.
 *
 * A read is not a write, so the pass carries an expiry instead of a burned nonce: re-signing for
 * every list refresh would be noise, and the signature unlocks nothing that changes state.
 */

// How long one signature keeps the page open.
export const ADMIN_PASS_TTL_MS = 8 * 60 * 60 * 1000

export const ADMIN_PASS_HEADER = 'x-hup-admin-pass'

/**
 * @param {{ wallet: string, expiresAt: number }} params
 * @returns {string}
 */
export const adminPassMessage = ({ wallet, expiresAt }) =>
  `Open the Hup admin page.\nWallet: ${wallet}\nValid until: ${new Date(expiresAt).toISOString()}`

/** The pass as one header-safe string. Every field is ASCII, so plain base64 is enough. */
export const encodeAdminPass = (pass) => btoa(JSON.stringify(pass))

/** The pass back out of a header, or null when it is missing or malformed. */
export const decodeAdminPass = (value) => {
  if (!value) return null
  try {
    const pass = JSON.parse(atob(value))
    const valid = typeof pass?.wallet === 'string' && typeof pass?.signature === 'string' && Number.isFinite(pass?.expiresAt)
    return valid ? pass : null
  } catch {
    return null
  }
}
