/**
 * @file lib/explorer.js
 * @description Explorer links that know which kind of chain a row lives on. EVM explorers all
 * take `${base}/tx/${hash}` and `${base}/address/${address}` with the base stored on the
 * `networks` row; Solana's explorer needs a cluster query on every non-mainnet link, so those
 * come from config/solana.js instead of the row.
 */
import { isSolanaNetworkId, solanaExplorerUrl } from '@/config/solana'

const trimSlash = (value) => String(value).replace(/\/$/, '')

/**
 * The transaction behind a post, status, tip … row.
 * @param {{network_id?: number|string, tx_hash?: string|null, explorer_url?: string|null}} row
 * @returns {string|null}
 */
export const txExplorerUrl = (row) => {
  if (!row?.tx_hash) return null
  if (isSolanaNetworkId(row.network_id)) return solanaExplorerUrl(row.network_id, 'tx', row.tx_hash)
  if (!row.explorer_url) return null
  return `${trimSlash(row.explorer_url)}/tx/${row.tx_hash}`
}

/**
 * An account on a network's explorer.
 * @param {number|string} networkId
 * @param {string} address
 * @param {string|null} [evmBaseUrl] - The EVM explorer base for non-Solana networks.
 * @returns {string|null}
 */
export const addressExplorerUrl = (networkId, address, evmBaseUrl = null) => {
  if (!address) return null
  if (isSolanaNetworkId(networkId)) return solanaExplorerUrl(networkId, 'address', address)
  if (!evmBaseUrl) return null
  return `${trimSlash(evmBaseUrl)}/address/${address}`
}
