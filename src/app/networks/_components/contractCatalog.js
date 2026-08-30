/**
 * @file app/networks/_components/contractCatalog.js
 * @description Display metadata for the per-chain deployments in config/contracts.js, shared by
 * the networks directory and the network detail page. Addresses stay in CONTRACTS — this module
 * only knows what each key is called and what it does, and turns a deployment into renderable
 * rows (skipping keys a chain does not carry).
 */

import { CONTRACTS } from '@/config/contracts'

/** The deployment record for a chain id, or null where CONTRACTS has no entry. */
export const getDeployment = (chainId) => CONTRACTS[`chain${chainId}`] || null

// Core plumbing every Hup feature sits on. Forwarder labels come from the deployment itself
// (forwarderName / hupForwarderName) because chains disagree on which build they trust.
const CORE_CONTRACTS = [
  { key: 'hup', label: 'Hup', description: 'Core social engine — posts, likes and reposts' },
  { key: 'status', label: 'HupStatus', description: 'Short-lived status updates' },
  { key: 'forwarder', labelKey: 'forwarderName', label: 'Forwarder', description: 'ERC-2771 forwarder relaying gasless actions' },
  { key: 'hupForwarder', labelKey: 'hupForwarderName', label: 'HupForwarder', description: 'The forwarder Hup core itself trusts' },
  { key: 'followerSystem', label: 'Follower System', description: 'LSP26 follower registry' },
]

// Feature extensions. A chain missing a key simply has not received that feature yet.
const FEATURE_CONTRACTS = [
  { key: 'community', label: 'HupCommunity', description: 'Communities with onchain membership' },
  { key: 'chat', label: 'HupChat', description: 'Onchain chat' },
  { key: 'store', label: 'HupBazaar', description: 'Marketplace for digital goods' },
  { key: 'tipper', label: 'HupTipper', description: 'Post tipping' },
  { key: 'trade', label: 'HupTrade', description: 'NFT sales inside posts' },
  { key: 'offers', label: 'HupOffers', description: 'Offers on NFTs' },
  { key: 'events', label: 'HupEvents', description: 'Paid onchain events directory' },
  { key: 'predict', label: 'HupPredict', description: 'Prediction markets' },
  { key: 'apps', label: 'HupApps', description: 'Mini app registry' },
  { key: 'polls', label: 'HupPolls', description: 'Onchain polls' },
  { key: 'drops', label: 'HupDrops', description: 'NFT drop launchpad engine' },
  { key: 'launch', label: 'HupLaunch', description: 'Token launchpad on Uniswap v3 pools' },
  { key: 'miner', label: 'HupMiner', description: 'Daily onchain mini game' },
]

// Third-party swap venues the swap page races. Recorded per chain, deployed by their own teams.
const SWAP_CONTRACTS = [
  { key: 'univ3Router', label: 'Uniswap v3 Router', description: 'SwapRouter02' },
  { key: 'univ3Quoter', label: 'Uniswap v3 Quoter', description: 'QuoterV2 — read-only quotes' },
  { key: 'univ4Router', label: 'Uniswap v4 Router', description: 'Universal Router' },
  { key: 'univ4PoolManager', label: 'Uniswap v4 PoolManager', description: 'Singleton holding every v4 pool' },
  { key: 'univ4Quoters', label: 'Uniswap v4 Quoter', description: 'Read-only quotes' },
  { key: 'permit2', label: 'Permit2', description: 'Shared token-approval contract' },
  { key: 'sushiV2Router', label: 'Sushi v2 Router', description: 'SushiSwap fallback venue' },
  { key: 'wnative', label: 'Wrapped Native', description: 'Canonical wrapped coin swaps settle through' },
]

/**
 * Turn a deployment into renderable rows for one catalog group: keys the chain does not carry
 * (or carries as '') are skipped, address arrays (univ4Quoters) fan out into numbered rows, and
 * forwarder labels defer to the name the deployment records.
 */
const rowsFor = (deployment, definitions) => {
  if (!deployment) return []

  const rows = []
  definitions.forEach((definition) => {
    const value = deployment[definition.key]
    if (!value || (Array.isArray(value) && value.length === 0)) return

    const label = (definition.labelKey && deployment[definition.labelKey]) || definition.label
    const addresses = Array.isArray(value) ? value : [value]
    addresses.forEach((address, index) => {
      rows.push({
        key: addresses.length > 1 ? `${definition.key}-${index}` : definition.key,
        label: addresses.length > 1 ? `${label} #${index + 1}` : label,
        description: definition.description,
        address,
      })
    })
  })
  return rows
}

export const coreRows = (deployment) => rowsFor(deployment, CORE_CONTRACTS)
export const featureRows = (deployment) => rowsFor(deployment, FEATURE_CONTRACTS)
export const swapRows = (deployment) => rowsFor(deployment, SWAP_CONTRACTS)

/** How many Hup-owned contracts (core + features, not swap venues) a chain carries. */
export const hupContractCount = (deployment) => coreRows(deployment).length + featureRows(deployment).length
