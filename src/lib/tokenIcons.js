// Best-effort token artwork, resolvable on the client with no key and no round trip through
// our own server. TrustWallet's asset repo is the only logo CDN that spans this app's EVM
// chains; a miss simply 404s and the caller's fallback glyph stays visible underneath.
//
// Server-side code that can afford a fetch has a richer source in lib/tokenLogos.js
// (GeckoTerminal), and LUKSO LSP7s carry their own icon onchain (lib/luksoAssets.js).

import { getAddress } from 'viem'

// TrustWallet blockchain slugs per chainId. Chains it doesn't index — LUKSO, Monad,
// Robinhood, every testnet — are absent on purpose: those tokens keep the fallback glyph.
export const TRUSTWALLET_SLUGS = {
  1: 'ethereum',
  56: 'smartchain',
  8453: 'base',
  42161: 'arbitrum',
  42220: 'celo',
}

/**
 * CDN logo URL for an ERC20, or null when the chain isn't indexed or the address is junk.
 * The repo keys assets by EIP-55 address, so the input is checksummed here — lowercased
 * first, since a paste with a mangled checksum should still resolve.
 * @param {number|string} chainId
 * @param {string} address
 * @returns {string|null}
 */
export const tokenIconUrl = (chainId, address) => {
  const slug = TRUSTWALLET_SLUGS[Number(chainId)]
  if (!slug || !address) return null
  try {
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/assets/${getAddress(
      String(address).toLowerCase(),
    )}/logo.png`
  } catch {
    return null
  }
}
