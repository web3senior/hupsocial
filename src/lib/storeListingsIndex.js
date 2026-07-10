/**
 * @file lib/storeListingsIndex.js
 * @description Discovery index for HupStore listings ("premium" posts). The chain is the
 * source of truth — HupStore keys listings by postId with no enumeration getter, so the
 * bazzar/premium feed can't be answered from chain data alone. Mirroring the
 * community_join_requests pattern, the client pings the sync endpoint right after a listing
 * or purchase tx confirms, and the server re-reads getListing() onchain before writing, so
 * rows can't be spoofed into the premium feed.
 */

import Web3 from 'web3'
import pool from '@/lib/db'
import { config, CONTRACTS } from '@/config/wagmi'
import { STORE_ADDRESSES } from '@/lib/tokens'
import storeAbi from '@/abis/HupStore.json'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

let tableReady = null
export function ensureStoreListingsTable() {
  if (!tableReady) {
    tableReady = pool.execute(`
      CREATE TABLE IF NOT EXISTS store_listings (
        network_id INT UNSIGNED NOT NULL,
        post_id BIGINT UNSIGNED NOT NULL,
        seller VARCHAR(42) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        listed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (network_id, post_id)
      )
    `)
  }
  return tableReady
}

/**
 * Re-reads a post's listing from the chain and mirrors it into store_listings.
 * Returns the resulting premium state, or supported: false when the chain has
 * no store contract configured.
 */
export async function syncListingFromChain(networkId, postId) {
  const chain = config.chains.find((c) => c.id === Number(networkId))
  // STORE_ADDRESSES (lib/tokens) is the server-side source of truth for store deployments;
  // CONTRACTS is the client config and can lag behind it — accept whichever is set.
  const storeAddress = STORE_ADDRESSES[Number(networkId)] || CONTRACTS[`chain${networkId}`]?.store

  if (!chain || !storeAddress) {
    return { supported: false, premium: false, isActive: false }
  }

  const web3 = new Web3(new Web3.providers.HttpProvider(chain.rpcUrls.default.http[0]))
  const contract = new web3.eth.Contract(storeAbi, storeAddress)
  const listing = await contract.methods.getListing(postId).call()

  await ensureStoreListingsTable()

  const hasListing = Boolean(listing?.seller) && listing.seller.toLowerCase() !== ZERO_ADDRESS
  if (!hasListing) {
    // Never listed (or a spoofed ping) — make sure no stale row survives
    await pool.execute('DELETE FROM store_listings WHERE network_id = ? AND post_id = ?', [networkId, postId])
    return { supported: true, premium: false, isActive: false }
  }

  const isActive = Boolean(listing.isActive)
  await pool.execute(
    `INSERT INTO store_listings (network_id, post_id, seller, is_active)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE seller = VALUES(seller), is_active = VALUES(is_active)`,
    [networkId, postId, listing.seller.toLowerCase(), isActive ? 1 : 0],
  )
  return { supported: true, premium: true, isActive }
}
