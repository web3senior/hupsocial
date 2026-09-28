/**
 * @file lib/liveServer.js
 * @description Server-only reads and writes for live streams. Rows are created and ended here;
 * everything in between (live, viewer counts, a dropped publisher) is written by
 * cidex/live-streams.js from what the media server reports.
 */

import crypto from 'crypto'
import pool from '@/lib/db'
import { hasTable } from '@/lib/schema'
import { isChatAdmin } from '@/lib/chatSession'
import { readPremium } from '@/lib/premiumServer'
import { LIVE_ACCESS } from '@/lib/live'

const TABLE = 'live_streams'

export const liveTableExists = () => hasTable(TABLE)

/**
 * Whether a wallet may start a stream, and the sentence to show when it may not.
 * @param {string} address
 * @returns {Promise<{allowed: boolean, reason: string|null}>}
 */
export const canGoLive = async (address) => {
  if (isChatAdmin(address) || LIVE_ACCESS === 'everyone') return { allowed: true, reason: null }
  const { premium } = await readPremium(address)
  return premium ? { allowed: true, reason: null } : { allowed: false, reason: 'Going live is a Premium feature' }
}

/** A one-time publish key and the hash that is stored in its place. */
export const mintStreamKey = () => {
  const key = crypto.randomBytes(24).toString('base64url')
  return { key, hash: crypto.createHash('sha256').update(key).digest('hex') }
}

const STREAM_COLUMNS = `s.id, s.wallet, s.network_id, s.title, s.status, s.viewers, s.peak_viewers, s.started_at, s.ended_at`

export const serializeStream = (row) => ({
  id: Number(row.id),
  wallet: row.wallet,
  networkId: Number(row.network_id),
  title: row.title,
  status: row.status,
  viewers: Number(row.viewers) || 0,
  peakViewers: Number(row.peak_viewers) || 0,
  startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
  endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
})

/** Streams with video arriving right now, busiest first. */
export const readLiveStreams = async (limit = 50) => {
  if (!(await liveTableExists())) return []
  const [rows] = await pool.query(
    `SELECT ${STREAM_COLUMNS} FROM ${TABLE} s WHERE s.status = 'live' ORDER BY s.viewers DESC, s.id DESC LIMIT ${Number(limit) || 50}`,
  )
  return rows.map(serializeStream)
}

/** The stream a wallet has open (pending or live), or null. */
export const readOpenStream = async (wallet) => {
  if (!(await liveTableExists())) return null
  const [[row]] = await pool.execute(
    `SELECT ${STREAM_COLUMNS} FROM ${TABLE} s WHERE s.wallet = ? AND s.status IN ('pending', 'live') ORDER BY s.id DESC LIMIT 1`,
    [wallet],
  )
  return row ? serializeStream(row) : null
}

export const countRecentStarts = async (wallet) => {
  const [[row]] = await pool.execute(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE wallet = ? AND created_at > NOW() - INTERVAL 1 HOUR`, [wallet])
  return Number(row.n) || 0
}

/** Ends whatever the wallet has open; the worker cuts the video off on its next sweep. */
export const endOpenStreams = async (wallet) => {
  const [result] = await pool.execute(
    `UPDATE ${TABLE} SET status = 'ended', ended_at = NOW(3), viewers = 0 WHERE wallet = ? AND status IN ('pending', 'live')`,
    [wallet],
  )
  return result.affectedRows
}

/**
 * @param {{wallet: string, networkId: number, title: string}} stream
 * @returns {Promise<{id: number, key: string}>}
 */
export const openStream = async ({ wallet, networkId, title }) => {
  await endOpenStreams(wallet)
  const { key, hash } = mintStreamKey()
  const [result] = await pool.execute(`INSERT INTO ${TABLE} (wallet, network_id, title, key_hash) VALUES (?, ?, ?, ?)`, [
    wallet,
    networkId,
    title,
    hash,
  ])
  return { id: Number(result.insertId), key }
}

/** A moderator's cut-off. Returns the row as it was, or null when there was nothing to cut. */
export const killStream = async (id, moderator) => {
  const [[row]] = await pool.execute(`SELECT id, wallet, status FROM ${TABLE} WHERE id = ? LIMIT 1`, [id])
  if (!row || (row.status !== 'pending' && row.status !== 'live')) return null
  await pool.execute(
    `UPDATE ${TABLE} SET status = 'killed', ended_at = NOW(3), viewers = 0, killed_by = ? WHERE id = ? AND status IN ('pending', 'live')`,
    [moderator, id],
  )
  return row
}
