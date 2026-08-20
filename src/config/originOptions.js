/**
 * @file config/originOptions.js
 * @description The onchain half of "where are you from" — the origins offered above the real
 * countries in the profile picker, for the many people here whose honest answer is a chain rather
 * than a place.
 *
 * These are not countries and never pretend to be. They share one column with ISO codes only
 * because the two vocabularies cannot collide: an ISO 3166-1 alpha-2 code is always exactly two
 * uppercase letters, and every slug here is lowercase and longer. Shape alone tells them apart,
 * so neither side needs a prefix.
 *
 * Slugs are the stored value and must never be renamed once shipped — a wallet that filed under
 * `lukso` keeps that string forever. Add new entries wherever they belong in the order; an
 * unknown slug renders as a bare globe rather than breaking, so a profile set from a later build
 * still survives a rollback.
 *
 * Dependency-free on purpose: the API route validates writes against this list while the picker
 * renders from it, and neither should pull in the other's world (same reason
 * config/communityCategories.js and config/contracts.js exist).
 *
 * Emoji, not logos: they need no assets, no licence, and no dark-mode variant. Where a project
 * has an obvious one it wins — LUKSO is 🆙 for Universal Profiles, Robinhood is its feather,
 * Solana is the sunlight it is named after.
 */

export const ORIGIN_OPTIONS = [
  { slug: 'web3', label: 'Web3', emoji: '🌐' },
  { slug: 'blockchain', label: 'Blockchain', emoji: '⛓️' },
  { slug: 'metaverse', label: 'The Metaverse', emoji: '🕶️' },
  { slug: 'moon', label: 'The Moon', emoji: '🌕' },
  { slug: 'ethereum', label: 'Ethereum', emoji: '💎' },
  { slug: 'lukso', label: 'LUKSO', emoji: '🆙' },
  { slug: 'base', label: 'Base', emoji: '🔵' },
  { slug: 'arbitrum', label: 'Arbitrum', emoji: '🔷' },
  { slug: 'bnb', label: 'BNB Chain', emoji: '🟡' },
  { slug: 'celo', label: 'Celo', emoji: '🟢' },
  { slug: 'monad', label: 'Monad', emoji: '🟣' },
  { slug: 'robinhood', label: 'Robinhood', emoji: '🪶' },
  { slug: 'solana', label: 'Solana', emoji: '☀️' },
  { slug: 'bitcoin', label: 'Bitcoin', emoji: '🟠' },
]

/** Lookup by slug, for the renderer and the write-side validator alike. */
export const findOriginOption = (slug) => ORIGIN_OPTIONS.find((option) => option.slug === slug) || null
