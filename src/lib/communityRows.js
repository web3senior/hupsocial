/**
 * @file lib/communityRows.js
 * @description Everything a community card renders, gathered from the indexed tables.
 *
 * The directory used to hand each card an id and let it resolve the rest onchain: communities(),
 * getRequirements(), requirementMode(), paymentRequirements(), payoutDestination(), keyVersion(),
 * governors(), registry(), canPost(), invites(), plus a decimals()/symbol()/name() per gating
 * asset — and the metadata CID over an IPFS gateway on top. Twenty cards across every deployed
 * chain was several hundred un-batched round trips before the grid painted, and the card sat on a
 * skeleton until the first one answered.
 *
 * cidex already indexes all of it, so these two helpers turn the page into three queries total.
 * The contract stays the source of truth for anything that gates a write: the detail page and the
 * Modify form still read it directly, and the indexed copy is only ever used to render.
 */

import pool from '@/lib/db'

/**
 * Community rows are keyed by (network_id, contract_address, id) — a chain can have hosted
 * several HupCommunity deployments, and each numbers its communities from 1.
 */
const rowKey = (networkId, contractAddress, communityId) => `${networkId}:${String(contractAddress).toLowerCase()}:${communityId}`

/**
 * Attaches each community's requirement list, in the contract's own order.
 *
 * One query for the whole page rather than one per row: the row-constructor IN takes the exact
 * (network, deployment, community) triples the page is showing, so a directory spanning several
 * chains still costs a single round trip.
 *
 * @param {Array<object>} rows Indexed community rows.
 * @returns {Promise<void>} Resolves once every row carries a `requirements` array.
 */
async function attachRequirements(rows) {
  for (const row of rows) row.requirements = []
  if (rows.length === 0) return

  const params = []
  for (const row of rows) params.push(row.network_id, String(row.contract_address).toLowerCase(), row.id)

  const [requirementRows] = await pool.execute(
    `SELECT network_id, contract_address, community_id, \`position\`, r_type, asset, min_balance,
            asset_name, asset_symbol, asset_decimals
     FROM community_requirements
     WHERE (network_id, LOWER(contract_address), community_id) IN (${rows.map(() => '(?, ?, ?)').join(', ')})
     ORDER BY \`position\` ASC`,
    params,
  )

  const byCommunity = new Map()
  for (const row of rows) byCommunity.set(rowKey(row.network_id, row.contract_address, row.id), row.requirements)

  for (const requirement of requirementRows) {
    const bucket = byCommunity.get(rowKey(requirement.network_id, requirement.contract_address, requirement.community_id))
    if (bucket) bucket.push(requirement)
  }
}

/**
 * Attaches the viewer's own membership standing to each row: whether they are a member, have a
 * request pending, moderate, are banned, or have an invite waiting.
 *
 * Every one of those was an eth_call per card for a connected wallet. cidex writes them from
 * registry() on each membership event, so the indexed copy is the same data one block later —
 * good enough to decide which button a card shows, while the contract itself still decides
 * whether the resulting transaction succeeds.
 *
 * Addresses are stored checksummed in ascii_bin columns, so every comparison is LOWER()ed on
 * both sides — matching a lowercased address against them directly finds nothing.
 *
 * @param {Array<object>} rows Indexed community rows.
 * @param {string|null} viewerAddress The connected wallet, if any.
 * @returns {Promise<void>} Resolves once every row carries a `viewer` object.
 */
async function attachViewerMembership(rows, viewerAddress) {
  const emptyViewer = { is_member: 0, is_pending: 0, is_moderator: 0, is_banned: 0, is_invited: 0, can_post: 0 }
  for (const row of rows) row.viewer = { ...emptyViewer }
  if (rows.length === 0 || !viewerAddress) return

  const params = [viewerAddress.toLowerCase()]
  for (const row of rows) params.push(row.network_id, String(row.contract_address).toLowerCase(), row.id)

  const [memberRows] = await pool.execute(
    `SELECT network_id, contract_address, community_id, is_member, is_pending, is_moderator, is_banned, is_invited, can_post
     FROM community_members
     WHERE LOWER(wallet_address) = ?
       AND (network_id, LOWER(contract_address), community_id) IN (${rows.map(() => '(?, ?, ?)').join(', ')})`,
    params,
  )

  const byCommunity = new Map()
  for (const row of rows) byCommunity.set(rowKey(row.network_id, row.contract_address, row.id), row)

  for (const member of memberRows) {
    const row = byCommunity.get(rowKey(member.network_id, member.contract_address, member.community_id))
    if (!row) continue
    row.viewer = {
      is_member: member.is_member,
      is_pending: member.is_pending,
      is_moderator: member.is_moderator,
      is_banned: member.is_banned,
      is_invited: member.is_invited,
      can_post: member.can_post,
    }
  }
}

/**
 * Fills in everything a community card needs beyond the row's own columns.
 * @param {Array<object>} rows Indexed community rows, mutated in place.
 * @param {string|null} viewerAddress The connected wallet, if any.
 * @returns {Promise<Array<object>>} The same rows, for convenient chaining.
 */
export async function attachCommunityExtras(rows, viewerAddress = null) {
  await Promise.all([attachRequirements(rows), attachViewerMembership(rows, viewerAddress)])
  return rows
}
