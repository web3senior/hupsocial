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