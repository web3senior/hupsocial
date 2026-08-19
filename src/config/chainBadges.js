/**
 * @file config/chainBadges.js
 * @description The small chain mark that sits on the corner of a token's icon.
 *
 * A badge answers one question — "which chain is this token actually on?" — so it is only
 * worth drawing when the answer is not already obvious. Native coins carry their chain in the
 * artwork itself (the Bitcoin logo IS Bitcoin), and badging those just doubles the mark up.
 * Tokens are the ambiguous case: $ANSEM could be an SPL mint or an ERC20 and nothing about
 * the bull tells you which.
 *
 * That distinction falls straight out of a DefiLlama key, so nothing has to be declared per
 * token: `solana:<mint>` and `ethereum:0x…` name their chain, while `coingecko:ethereum`
 * describes a native coin and gets no badge.
 *
 * EVM marks are reused from the wagmi chain objects rather than copied, so a chain whose
 * branding is updated there updates here too.
 */

import { SLUG_CHAIN_IDS } from './cashtags'
import { config } from './wagmi'

// Solana is not a wagmi chain, so its mark has no home to borrow from. Three slanted bars in
// the brand gradient, on a dark disc so it reads against pale token artwork.
const SOLANA_ICON = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#0B0B14"/><defs><linearGradient id="sol" x1="7" y1="22.5" x2="24" y2="9.5" gradientUnits="userSpaceOnUse"><stop stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient></defs><path d="M9.6 20.4a.7.7 0 0 1 .5-.2h13a.35.35 0 0 1 .25.6l-2.55 2.55a.7.7 0 0 1-.5.2h-13a.35.35 0 0 1-.25-.6l2.55-2.55Z" fill="url(#sol)"/><path d="M9.6 8.45a.72.72 0 0 1 .5-.2h13a.35.35 0 0 1 .25.6l-2.55 2.55a.7.7 0 0 1-.5.2h-13a.35.35 0 0 1-.25-.6L9.6 8.45Z" fill="url(#sol)"/><path d="M20.85 14.39a.7.7 0 0 0-.5-.2h-13a.35.35 0 0 0-.25.6l2.55 2.55a.7.7 0 0 0 .5.2h13a.35.35 0 0 0 .25-.6l-2.55-2.55Z" fill="url(#sol)"/></svg>`

// Slugs the app has no chain for — and every `coingecko:` native — simply render no badge.

const LABELS = {
  ethereum: 'Ethereum',
  bsc: 'BNB Chain',
  arbitrum: 'Arbitrum',
  base: 'Base',
  celo: 'Celo',
  lukso: 'LUKSO',
  solana: 'Solana',
}

const SOLANA_URL = `data:image/svg+xml,${encodeURIComponent(SOLANA_ICON)}`

/**
 * The badge for a chain slug, or null when it needs none.
 * @param {string} slug a DefiLlama chain slug, or 'coingecko' for a native coin
 * @returns {{url: string, label: string}|null}
 */
export const chainBadgeFor = (slug) => {
  const key = String(slug || '').toLowerCase()
  // Native coins already say which chain they are
  if (!key || key === 'coingecko') return null

  if (key === 'solana') return { url: SOLANA_URL, label: LABELS.solana }

  const chainId = SLUG_CHAIN_IDS[key]
  if (!chainId) return null
  const chain = config.chains.find((item) => item.id === chainId)
  // A chain in the registry that carries no artwork gets no badge rather than a broken one
  return chain?.iconUrl ? { url: chain.iconUrl, label: LABELS[key] ?? chain.name } : null
}

// A native coin's artwork is its chain's mark, so the chains the app already carries can
// supply it. Coins on chains the app has no client for (BTC, XRP, …) fall through to
// TokenIcon's coin glyph rather than to a wrong logo.
const NATIVE_CHAIN_IDS = {
  ETH: 1,
  LYX: 42,
  BNB: 56,
  CELO: 42220,
}

/**
 * Logo for a native coin's cashtag, or null when the app has no artwork for that chain.
 * @param {string} symbol
 */
export const nativeLogoFor = (symbol) => {
  const key = String(symbol || '').toUpperCase()
  // Solana is not a wagmi chain, so $SOL has no chain object to borrow from and fell through
  // to the blank coin glyph
  if (key === 'SOL') return SOLANA_URL
  const chainId = NATIVE_CHAIN_IDS[key]
  if (!chainId) return null
  return config.chains.find((item) => item.id === chainId)?.iconUrl ?? null
}
