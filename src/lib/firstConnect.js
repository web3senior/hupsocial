/**
 * @file lib/firstConnect.js
 * @description Remembers that a wallet's users row was created by the connect that just happened,
 * so the username prompt can tell someone arriving for the first time from someone who has been
 * here since before handles existed.
 *
 * sessionStorage, not localStorage: "this is your first connect" is true for exactly one visit,
 * and it must not survive the tab that saw it.
 */

const key = (address) => `hup:first-connect:${String(address || '').toLowerCase()}`

/** Records that this address was just created. */
export const markFirstConnect = (address) => {
  if (!address || typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key(address), '1')
  } catch {
    /* Blocked storage only costs the required prompt its "required" — the ask still happens. */
  }
}

/** Whether this address arrived for the first time in this session. */
export const readFirstConnect = (address) => {
  if (!address || typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(key(address)) === '1'
  } catch {
    return false
  }
}

/** Forgets the mark once the prompt it was for is done with. */
export const clearFirstConnect = (address) => {
  if (!address || typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(key(address))
  } catch {
    /* Nothing to clear. */
  }
}
