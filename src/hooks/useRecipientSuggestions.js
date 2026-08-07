'use client'

/**
 * @file hooks/useRecipientSuggestions.js
 * @description Ranked recipient suggestions for RecipientField, merged from the server search and
 * this browser's own send history.
 *
 * The server is asked on a debounce because a recipient field is typed into character by character
 * and every keystroke would otherwise cost an ENS lookup and a GraphQL query. Recents answer
 * instantly from localStorage, which is what makes the list feel immediate while the network catches
 * up — and they are the one source that knows the difference between a wallet you have heard of and
 * a wallet you have actually paid.
 */

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { isResolvedSource, readRecentRecipients, searchRecipients } from '@/lib/recipientSearch'

const DEBOUNCE_MS = 300
const MAX_SUGGESTIONS = 10

// Mirrors the server's ranking with `recent` folded in — having paid someone before outranks any
// name match, but never outranks the address or ENS name the user typed themselves
const SOURCE_RANK = { address: 0, ens: 1, recent: 2, following: 3, hup: 4, lukso: 5 }

// Stable empty reference so an idle field doesn't hand its consumer a new array every render
const NO_SUGGESTIONS = []

const matchesQuery = (item, needle) =>
  !needle ||
  item.address.toLowerCase().includes(needle) ||
  (item.name || '').toLowerCase().includes(needle) ||
  (item.ensName || '').toLowerCase().includes(needle)

/**
 * @param {Object} params
 * @param {string} params.query Whatever is in the field.
 * @param {string|null} [params.viewer] The sending wallet — seeds recents and the "you follow" list.
 * @param {string[]} [params.exclude] Addresses to leave out (yourself, already-picked entries).
 * @param {boolean} [params.enabled] Set false to stop searching entirely (e.g. a disabled field).
 * @returns {{suggestions: Array<Object>, isLoading: boolean, resolved: Object|null}}
 */
export default function useRecipientSuggestions({ query, viewer = null, exclude, enabled = true }) {
  const trimmed = String(query || '').trim()

  const [debouncedQuery, setDebouncedQuery] = useState(trimmed)
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [trimmed])

  // The response carries the query it answered. `keepPreviousData` keeps the list from blanking
  // between keystrokes, which means `data` routinely belongs to a query the user has already typed
  // past — and a resolution applied from the wrong query would silently point the field at the
  // previous recipient's wallet.
  const { data, isLoading } = useSWR(
    enabled ? ['recipient-search', debouncedQuery, viewer?.toLowerCase() ?? null] : null,
    ([, q, who]) => searchRecipients(q, { viewer: who, limit: MAX_SUGGESTIONS }).then((results) => ({ query: q, results })),
    { revalidateOnFocus: false, keepPreviousData: true },
  )
  const isStale = data ? data.query !== trimmed : false

  const recents = useMemo(() => readRecentRecipients(viewer), [viewer])

  // Keyed on the contents rather than the array so a call site passing `exclude={[address]}` inline
  // doesn't rebuild the whole suggestion list on every render
  const excludeKey = (exclude || [])
    .filter(Boolean)
    .map((address) => String(address).toLowerCase())
    .sort()
    .join(',')
  const excluded = useMemo(() => new Set(excludeKey ? excludeKey.split(',') : []), [excludeKey])

  const suggestions = useMemo(() => {
    if (!enabled) return NO_SUGGESTIONS

    const needle = trimmed.toLowerCase()
    const merged = new Map()

    for (const item of [...recents.filter((recent) => matchesQuery(recent, needle)), ...(data?.results || [])]) {
      const key = item.address.toLowerCase()
      if (excluded.has(key)) continue

      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...item })
        continue
      }
      // Later sources only fill blanks; the better-ranked source keeps the row's heading
      existing.name = existing.name || item.name
      existing.avatar = existing.avatar || item.avatar
      existing.ensName = existing.ensName || item.ensName
      existing.followerCount = existing.followerCount ?? item.followerCount
      if (SOURCE_RANK[item.source] < SOURCE_RANK[existing.source]) existing.source = item.source
    }

    const ranked = [...merged.values()].sort(
      (a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || (b.followerCount ?? 0) - (a.followerCount ?? 0),
    )

    return ranked.length ? ranked.slice(0, MAX_SUGGESTIONS) : NO_SUGGESTIONS
  }, [enabled, trimmed, recents, data, excluded])

  // Only the answer to what is *currently* typed counts. Suggestions may lag a keystroke behind
  // without harm — picking one is a deliberate act — but a resolution is applied on the user's
  // behalf, so it is gated on the response actually belonging to the text in the field.
  const resolved = useMemo(() => {
    if (isStale || debouncedQuery !== trimmed) return null
    return suggestions.find((item) => isResolvedSource(item.source)) ?? null
  }, [isStale, debouncedQuery, trimmed, suggestions])

  return { suggestions, isLoading: enabled && (isLoading || isStale || debouncedQuery !== trimmed), resolved }
}
