import { appChains } from '@/config/contracts'

/**
 * Resolves a chain's logo as a usable image src, by chain id.
 *
 * config/wagmi stamps `iconUrl` onto the shared chain objects as a side effect, so that is the
 * preferred source; the inline `icon` SVG string is the fallback for callers that never pulled
 * wagmi's config into their import graph. Chains with neither resolve to null, and the caller
 * shows the name alone rather than a broken image.
 *
 * @param {string|number} chainId The chain to look up.
 * @returns {string|null} An <img> src (usually a data: URI), or null when the chain has no logo.
 */
export const getChainIconUrl = (chainId) => {
  if (chainId === undefined || chainId === null) return null

  const chain = appChains.find((candidate) => candidate.id.toString() === chainId.toString())
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl

  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * Resolves a network's human-readable name from the global Wagmi configuration object.
 * @param {Object} config The active global Wagmi config instance.
 * @param {string|number} id The network or chain ID to query.
 * @returns {string} The resolved network name or a safe placeholder fallback.
 */
export const getNetworkDisplayName = (config, id) => {
  if (!config?.chains || id === undefined || id === null) {
    return `Network ${id}`
  }

  // Filter out the matching chain profile block matching the target identifier
  const targetChain = config.chains.find(
    (filterItem) => filterItem.id.toString() === id.toString()
  )

  return targetChain?.name ?? `Network ${id}`
}