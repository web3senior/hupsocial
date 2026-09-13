// What a Hup Launch is priced in, resolved from config alone — no chain reads, so API routes can
// answer for a whole page of launches without a multicall per row.
//
// A launch's price, market cap and volume are raw base units of its quote asset, so every figure
// on every launch surface needs that asset's decimals to render. Native is the common case and
// always 18 here (no Hup chain runs a non-18 gas coin); an ERC20 quote comes from the curated
// list, which is the same allowlist an admin priced onchain with setQuoteAsset.
//
// Clients that are about to spend money layer an onchain read over this — see hooks/useQuoteAsset.

import { appChains } from '@/config/contracts'
import { LAUNCH_QUOTES } from '@/lib/tokens'

export const NATIVE_QUOTE = '0x0000000000000000000000000000000000000000'

/** True when this launch is priced in the chain's own coin rather than a token. */
export const isNativeQuote = (quote) => !quote || String(quote).toLowerCase() === NATIVE_QUOTE

/** The curated quote candidates for a chain, or an empty list where none are configured. */
export const quoteCandidates = (networkId) => LAUNCH_QUOTES[Number(networkId)] ?? []

/** The curated row for one address on one chain, or null when it isn't a listed candidate. */
export const findQuoteCandidate = (networkId, address) => {
  if (!address) return null
  const wanted = String(address).toLowerCase()
  return quoteCandidates(networkId).find((row) => row.address.toLowerCase() === wanted) ?? null
}

/**
 * Symbol and decimals for a launch's quote asset.
 *
 * @param {number|string} networkId The chain the launch lives on.
 * @param {string|null} address The launch's quote address; zero or absent means native.
 * @returns {{address: string, symbol: string, decimals: number, isNative: boolean}}
 */
export const resolveQuoteAsset = (networkId, address) => {
  const chain = appChains.find((entry) => entry.id === Number(networkId))

  if (isNativeQuote(address)) {
    return {
      address: NATIVE_QUOTE,
      symbol: chain?.nativeCurrency?.symbol ?? 'ETH',
      decimals: chain?.nativeCurrency?.decimals ?? 18,
      isNative: true,
    }
  }

  const curated = findQuoteCandidate(networkId, address)

  return {
    address,
    // An uncurated quote means an admin allowlisted something this build doesn't know about. The
    // ticker degrading to a short address is cosmetic; the decimals fallback is not, so clients
    // that can read the chain override both — this is only what a server route can say alone.
    symbol: curated?.symbol ?? `${String(address).slice(0, 6)}…`,
    decimals: curated?.decimals ?? 18,
    isNative: false,
    isCurated: Boolean(curated),
  }
}
