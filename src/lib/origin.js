/**
 * @file lib/origin.js
 * @description The profile origin — a real country or an onchain one — in the one form both
 * sides of the wire agree on.
 *
 * Dependency-free by design, exactly like config/originOptions.js: the picker imports it in the
 * browser and the profile route imports it on the server, so nothing here may reach for the
 * database. The one lookup that does need a query — turning `NG` into "Nigeria" — stays in the
 * route, against the `countries` table.
 *
 * Two vocabularies share one stored value and are told apart by shape alone: an ISO 3166-1
 * alpha-2 code is always exactly two uppercase letters, and every onchain slug is lowercase and
 * longer, so nothing needs a prefix to disambiguate. Normalisation leans on that — `ng` is
 * obviously the country, `LUKSO` obviously the chain — so a value that arrives in the wrong case
 * (a hand-written API call, an older client) resolves instead of failing.
 */

import { findOriginOption } from '@/config/originOptions'

/** ISO 3166-1 alpha-2: two letters, and the only two-letter shape this column accepts. */
const ISO_ALPHA2 = /^[A-Za-z]{2}$/

/**
 * The stored form of whatever was typed, or null if it is neither vocabulary. Case is decided by
 * length, not by what the caller sent: two letters is a country and uppercases, anything longer
 * is a slug and lowercases.
 */
export function normalizeOriginCode(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (ISO_ALPHA2.test(value)) return value.toUpperCase()

  const slug = value.toLowerCase()
  return findOriginOption(slug) ? slug : null
}

/** True for the country half. Assumes an already-normalised code. */
export const isCountryCode = (code) => typeof code === 'string' && /^[A-Z]{2}$/.test(code)

/**
 * The wire shape, in one place, so the picker, the profile chip and the API can never disagree.
 * `countryName` is the row the caller resolved from `countries`; without it a country still
 * renders, as its bare code.
 *
 * A country carries NO emoji. A flag is composed from two regional-indicator letters, and Windows
 * ships no flag glyphs, so rather than a flag every country rendered as its own ISO code sitting
 * next to its own name. The key stays on the shape either way — empty for a country, set for an
 * onchain origin — so consumers keep getting one object and branch on truthiness, never on kind.
 * @returns {{code: string, kind: 'country'|'onchain', label: string, emoji: string}|null}
 */
export function describeOrigin(code, countryName = null) {
  const normalized = normalizeOriginCode(code)
  if (!normalized) return null

  if (isCountryCode(normalized)) {
    return {
      code: normalized,
      kind: 'country',
      label: countryName || normalized,
      emoji: '',
    }
  }

  const option = findOriginOption(normalized)
  return {
    code: normalized,
    kind: 'onchain',
    label: option?.label || normalized,
    // A slug from a later build that this one has never heard of still renders, as a plain globe.
    emoji: option?.emoji || '🌐',
  }
}

/**
 * What a submitted `origin` form field means, in the same vocabulary parseBadgeSelection uses so
 * the profile route reads consistently: absent leaves it alone, empty clears it, anything else is
 * a value to store or a reason to reject.
 * @returns {{action: 'absent'|'clear'|'set'|'invalid', code?: string}}
 */
export function parseOriginSelection(raw) {
  if (raw === null || raw === undefined) return { action: 'absent' }

  const value = String(raw).trim()
  if (value === '' || value === 'null') return { action: 'clear' }

  const normalized = normalizeOriginCode(value)
  if (!normalized) return { action: 'invalid' }

  return { action: 'set', code: normalized }
}
