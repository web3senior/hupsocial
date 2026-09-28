/**
 * @file lib/agentIdentities.js
 * @description Server-side reads of `agent_identities`, the verified wallet to ERC-8004 agent id
 * links. A link is only as true as its last read of the Identity Registry, so both readers here
 * re-read a stale one: the identity route on its response path, a profile read behind it.
 */
import { after } from 'next/server'
import pool from '@/lib/db'
import { getServerPublicClient } from '@/lib/serverPublicClient'
import { erc8004For, readAgentControl } from '@/lib/erc8004'

export const IDENTITY_STALE_SECONDS = 24 * 3600

/* One background re-read per link per window, however many profile reads land inside it. */
const RECHECK_THROTTLE_MS = 10 * 60_000
const recheckedAt = new Map()

const nowSeconds = () => Math.floor(Date.now() / 1000)

export const isStaleIdentity = (row) => nowSeconds() - Number(row.verified_at) > IDENTITY_STALE_SECONDS

/**
 * Re-reads one link from the chain. A wallet that lost the agent loses the row; a chain that did
 * not answer changes nothing.
 * @returns {Promise<object|null>} The row as it now stands, or null once deleted.
 */
export async function reverifyAgentIdentity(row) {
  const client = getServerPublicClient(row.network_id)
  if (!client) return row

  const controls = await readAgentControl(client, row.network_id, row.wallet_address, row.agent_id)
  if (controls === null) return row

  if (!controls) {
    await pool.execute('DELETE FROM agent_identities WHERE wallet_address = ? AND network_id = ?', [row.wallet_address, row.network_id])
    return null
  }

  const verifiedAt = nowSeconds()
  await pool.execute('UPDATE agent_identities SET verified_at = ? WHERE wallet_address = ? AND network_id = ?', [verifiedAt, row.wallet_address, row.network_id])
  return { ...row, verified_at: verifiedAt }
}

function scheduleReverify(row) {
  const key = `${row.wallet_address}:${row.network_id}`
  if (Date.now() - (recheckedAt.get(key) ?? 0) < RECHECK_THROTTLE_MS) return
  recheckedAt.set(key, Date.now())

  after(() => reverifyAgentIdentity(row).catch((error) => console.error('[AGENT_IDENTITY_REVERIFY_ERROR]:', error.message)))
}

/**
 * The ERC-8004 identities a profile shows. Never reads the chain on the response path.
 * @param {string} wallet An EVM address.
 * @returns {Promise<Array<{network_id: number, agent_id: string, registry: string}>>}
 */
export async function readAgentIdentities(wallet) {
  const [rows] = await pool.execute(
    'SELECT wallet_address, network_id, agent_id, verified_at FROM agent_identities WHERE wallet_address = ? ORDER BY network_id',
    [String(wallet).toLowerCase()],
  )

  return rows.map((row) => {
    if (isStaleIdentity(row)) scheduleReverify(row)
    return { network_id: Number(row.network_id), agent_id: String(row.agent_id), registry: erc8004For(row.network_id).identity }
  })
}
