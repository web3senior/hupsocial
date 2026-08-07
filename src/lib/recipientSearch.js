'use client'

/**
 * @file lib/recipientSearch.js
 * @description Everything the app needs to turn "who am I sending this to" into an address.
 *
 * The search itself is server work — the Hup database, the LUKSO profile index and ENS all answer
 * in one round trip through /api/v1/users/search, so no call site has to know which of them can
 * answer a given query. This module is the client half: the fetch, the vocabulary the picker
 * renders, and the local list of people this browser has actually sent to before.
 *
 * Recents are deliberately local. Who you have paid is not public the way a follow is, so it never
 * leaves the device, and it is keyed by sender so one browser shared between two wallets doesn't
 * suggest one's history to the other.
 */

import { normalizeAddress } from '@/lib/walletAssets'

const MAX_RECENTS = 6
const recentsKey = (owner) => `hup:recent-recipients:${owner.toLowerCase()}`

/** A recipient field's value: what was typed, what it resolved to, and who that turned out to be. */
export const EMPTY_RECIPIENT = Object.freeze({ input: '', address: null, profile: null })

/**
 * Where a suggestion came from, in the order the picker heads them. The label is a claim about
 * evidence, not decoration — "Universal Profiles" is a name someone chose for themselves, while
 * "You follow" is something the viewer did, and the two deserve different trust.
 */
export const RECIPIENT_GROUP_LABELS = {
  address: 'This address',
  ens: 'ENS',
  recent: 'Sent to before',
  following: 'You follow',
  hup: 'On Hup',
  lukso: 'Universal Profiles',
}

/** Sources that identify one specific wallet rather than offering candidates. */
export const isResolvedSource = (source) => source === 'address' || source === 'ens'

/** Builds a field value from raw text, resolving it immediately when it is already an address. */
export const recipientFromInput = (input) => ({
  input,
  address: normalizeAddress(String(input).trim()),
  profile: null,
})

/** Builds a field value from a picked suggestion. */
export const recipientFromSuggestion = (suggestion) => ({
  input: suggestion.name || suggestion.ensName || suggestion.address,
  address: suggestion.address,
  profile: suggestion,
})

/**
 * People matching `query`, ranked across every source the server can reach. An address or a
 * resolvable ENS name comes back as a single entry; anything else is a candidate list. Returns []
 * on network failure or an aborted request — the caller's plain address field is the fallback.
 * @param {string} query Name fragment, full address, or ENS name.
 * @param {{viewer?: string|null, limit?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<Array<{address: string, name: string|null, avatar: string|null, source: string, ensName: string|null, followerCount: number|null}>>}
 */
export async function searchRecipients(query, { viewer, limit, signal } = {}) {
  const params = new URLSearchParams({ q: String(query || '').trim() })
  if (viewer) params.set('viewer', viewer)
  if (limit) params.set('limit', String(limit))

  try {
    const response = await fetch(`/api/v1/users/search?${params.toString()}`, { signal })
    if (!response.ok) return []

    const body = await response.json()
    return Array.isArray(body?.data) ? body.data : []
  } catch {
    return []
  }
}

/**
 * Wallets this browser has sent to as `owner`, most recent first.
 * @param {string|null} owner The sending wallet.
 */
export function readRecentRecipients(owner) {
  if (!owner || typeof window === 'undefined') return []

  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentsKey(owner)) || '[]')
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item) => ({
        address: normalizeAddress(item?.address || ''),
        name: item?.name || null,
        avatar: item?.avatar || null,
        ensName: item?.ensName || null,
        followerCount: null,
        source: 'recent',
      }))
      .filter((item) => item.address)
      .slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

/**
 * Records a completed send so the next one can start from it. Call after the transfer confirms,
 * never on submit — an address that reverted is not somewhere the user meant to send.
 * @param {string|null} owner The sending wallet.
 * @param {{address: string, name?: string|null, avatar?: string|null, ensName?: string|null}} recipient
 */
export function rememberRecipient(owner, recipient) {
  const holder = normalizeAddress(owner || '')
  const address = normalizeAddress(recipient?.address || '')
  if (!holder || !address || typeof window === 'undefined') return

  const next = [
    { address, name: recipient.name || null, avatar: recipient.avatar || null, ensName: recipient.ensName || null },
    ...readRecentRecipients(holder).filter((item) => item.address !== address),
  ].slice(0, MAX_RECENTS)

  try {
    window.localStorage.setItem(recentsKey(holder), JSON.stringify(next))
  } catch {
    // A full or blocked store just means this send doesn't shortcut the next one
  }
}
