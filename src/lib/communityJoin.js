/**
 * @file lib/communityJoin.js
 * @description The one `communities` join every post query uses, pinned to the HupCommunity
 * deployment this build actually talks to on each network.
 *
 * A post row records only its community's numeric id, but `communities` is keyed by
 * (network_id, contract_address, id) — so a chain that has hosted more than one HupCommunity
 * deployment holds several rows per (network_id, id). Joining on the id pair alone MULTIPLIES
 * every community post by the number of deployments on its chain, which is what made a community
 * with a single post render that post four times on LUKSO Testnet (the feed joins twice: once in
 * the paginated derived table, once again in the hydration select).
 *
 * Pinning also resolves the ambiguity correctly rather than arbitrarily: id 1 on a retired
 * deployment is a different community from id 1 on the current one. The communities directory
 * route already filters retired deployments out the same way, and posts left unresolved by this
 * join land in the "community row not indexed" case the feed's visibility rules handle.
 */

import { CONTRACTS } from '@/config/contracts'

// Addresses come from server-side config (never from a request) and are shape-checked before
// being inlined, so this stays a constant string rather than a per-request parameter list —
// callers' carefully ordered query params stay untouched. cidex stores contract_address
// lowercase under a binary collation, hence the toLowerCase().
const pinConditions = (alias) =>
  Object.entries(CONTRACTS)
    .map(([chainKey, contracts]) => [Number(chainKey.replace('chain', '')), contracts?.community])
    .filter(([networkId, address]) => Number.isInteger(networkId) && /^0x[0-9a-fA-F]{40}$/.test(address || ''))
    .map(([networkId, address]) => `(${alias}.network_id = ${networkId} AND ${alias}.contract_address = '${address.toLowerCase()}')`)

/**
 * The HupCommunity address this build talks to on one network, or null when that chain has no
 * deployment configured. Single-community reads default to it so `communities` rows left behind
 * by a retired deployment can't answer a lookup that only knows (network_id, id).
 */
export const currentCommunityContract = (networkId) => {
  const address = CONTRACTS[`chain${Number(networkId)}`]?.community
  return /^0x[0-9a-fA-F]{40}$/.test(address || '') ? address.toLowerCase() : null
}

/** Extra ON condition restricting a `communities` join to the current deployment per network. */
export const communityJoinPin = (alias = 'comm') => {
  const conditions = pinConditions(alias)
  return conditions.length > 0 ? ` AND (${conditions.join(' OR ')})` : ''
}

/** The full join clause: `LEFT JOIN communities comm ON …` with the pin applied. */
export const communityJoin = (alias = 'comm', postAlias = 'p') =>
  `LEFT JOIN communities ${alias} ON ${alias}.network_id = ${postAlias}.network_id AND ${alias}.id = ${postAlias}.community_id${communityJoinPin(alias)}`
