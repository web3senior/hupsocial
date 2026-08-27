import { CHAIN_ICONS } from '@/config/chainIcons'
import { appChains } from '@/config/contracts'
import { SOLANA_CHAINS, isSolanaNetworkId, solanaChainFor } from '@/config/solana'

/**
 * Every chain the app can act on — the wagmi (EVM) chains plus the Solana clusters Hup is
 * deployed on — for pickers and tab menus that list networks.
 * @returns {object[]}
 */
export const allAppChains = () => [...appChains, ...SOLANA_CHAINS]

/**
 * The chain object for any network id the app knows, EVM or Solana, or null.
 * @param {string|number} chainId
 * @returns {object|null}
 */
export const resolveChain = (chainId) => {
  if (chainId === undefined || chainId === null) return null
  if (isSolanaNetworkId(chainId)) return solanaChainFor(chainId)
  return appChains.find((candidate) => candidate.id.toString() === chainId.toString()) ?? null
}

/**
 * Resolves a chain's logo as the raw inline SVG it was drawn as, by chain id.
 *
 * The source is config/chainIcons, not the `icon` property config/wagmi stamps onto the chain
 * objects — that stamp only exists once wagmi's config has been evaluated, which server
 * renderers deliberately never do. A renderer that has to rasterize the logo itself (the post
 * link-preview card hands it to sharp) wants the markup, not a data: URI it would have to
 * decode again.
 *
 * @param {string|number} chainId The chain to look up.
 * @returns {string|null} The SVG markup, or null when the chain has no logo.
 */
export const getChainIconSvg = (chainId) => {
  if (chainId === undefined || chainId === null) return null
  if (isSolanaNetworkId(chainId)) return solanaChainFor(chainId).icon ?? null

  return CHAIN_ICONS[chainId] ?? null
}

/**
 * Resolves a chain's logo as a usable image src, by chain id.
 *
 * config/wagmi stamps `iconUrl` onto the shared chain objects as a side effect, so that is the
 * preferred source; the icon map is the fallback for callers that never pulled wagmi's config
 * into their import graph. Chains in neither resolve to null, and the caller shows the name
 * alone rather than a broken image.
 *
 * @param {string|number} chainId The chain to look up.
 * @returns {string|null} An <img> src (usually a data: URI), or null when the chain has no logo.
 */
export const getChainIconUrl = (chainId) => {
  if (chainId === undefined || chainId === null) return null
  if (isSolanaNetworkId(chainId)) return solanaChainFor(chainId).iconUrl

  const chain = appChains.find((candidate) => candidate.id.toString() === chainId.toString())
  if (chain?.iconUrl) return chain.iconUrl

  const svg = getChainIconSvg(chainId)
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null
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
  if (isSolanaNetworkId(id)) return solanaChainFor(id).name

  // Filter out the matching chain profile block matching the target identifier
  const targetChain = config.chains.find(
    (filterItem) => filterItem.id.toString() === id.toString()
  )

  return targetChain?.name ?? `Network ${id}`
}