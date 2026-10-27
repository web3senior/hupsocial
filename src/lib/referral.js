/**
 * @file lib/referral.js
 * @description Who sent a visitor to Hup. A Hupster shares `hup.social/?ref=<handle or address>`;
 * the first visit remembers the code in this browser, and the wallet's first connect hands it to
 * the profile POST, which records it only when that request creates the account.
 *
 * First touch wins: a later ?ref= never overwrites one already remembered, so whoever actually
 * brought the visitor keeps the credit. The code expires so a stale one cannot claim a signup
 * weeks later.
 */

export const REF_PARAM = 'ref'

const STORAGE_KEY = 'hup:referral'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

// A handle or an address — anything else in the query string is not worth remembering.
const REF_PATTERN = /^@?[A-Za-z0-9_.-]{2,64}$/

/** Remembers ?ref= from the current URL, unless one is already held. Client only. */
export const captureReferral = () => {
  try {
    const ref = new URLSearchParams(window.location.search).get(REF_PARAM)?.trim()
    if (!ref || !REF_PATTERN.test(ref) || readReferral()) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ref, at: Date.now() }))
  } catch {
    // Storage blocked (private window): the visit simply carries no referral
  }
}

/** The remembered code, or null when there is none or it has expired. Client only. */
export const readReferral = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!stored?.ref || Date.now() - Number(stored.at) > TTL_MS) return null
    return stored.ref
  } catch {
    return null
  }
}

/** The link a wallet shares: its handle when it has one, its address otherwise. */
export const referralLink = (origin, { username, address }) => `${origin.replace(/\/+$/, '')}/?${REF_PARAM}=${encodeURIComponent(username || address)}`
