/**
 * @file lib/scheduledDelivery.js
 * @description Server side of scheduled posts: the row shape the API returns, and the sweep that
 * hands due, pre-signed posts to the relayer.
 *
 * A scheduled post is published by whichever of two hands reaches it first. While the author is
 * away, the cron calls deliverDueScheduledPosts() and the relayer executes the ForwardRequest they
 * signed when they scheduled it. The relay route is invoked in-process — the same checks, the same
 * throttle, the same send queue as a live post — so this file never touches the relayer key or an
 * RPC itself. When that request can no longer execute (the forwarder nonce moved on, the session
 * key expired, the deadline passed) the row is marked stale and left for the author's own browser
 * (components/ScheduledPostsRunner) to publish or re-sign.
 */

import pool from '@/lib/db'
import { POST as relayPost } from '@/app/api/v1/relay/route'
import { SCHEDULE_MAX_AHEAD_S, SCHEDULE_MIN_LEAD_S } from '@/lib/scheduleSignature'

/**
 * A schedule time the API will accept: whole unix seconds, at least the minimum lead away and
 * no further out than the ceiling.
 * @param {unknown} value
 * @returns {{ok: true, value: number}|{ok: false, error: string}}
 */
export const validateScheduledAt = (value) => {
  const seconds = Number(value)
  if (!Number.isInteger(seconds) || seconds <= 0) return { ok: false, error: 'A schedule time is required' }

  const now = Math.floor(Date.now() / 1000)
  if (seconds < now + SCHEDULE_MIN_LEAD_S) return { ok: false, error: 'Pick a time at least a minute from now' }
  if (seconds > now + SCHEDULE_MAX_AHEAD_S) return { ok: false, error: 'Posts can be scheduled up to a year ahead' }

  return { ok: true, value: seconds }
}

// Transport failures are retried once a minute by the cron; past this many the author is asked
// to take over rather than the relayer beating on a chain that is down for them
export const MAX_DELIVERY_ATTEMPTS = 10

// A row left in `sending` this long belongs to a delivery that crashed mid-way (a serverless
// instance killed between the claim and the update), not to one still in flight
const STUCK_SENDING_MINUTES = 10

const parseJson = (text, fallback) => {
  if (text === null || text === undefined) return fallback
  if (typeof text === 'object') return text
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/**
 * The public shape of a row. Stored signatures and requests never leave the server — the client
 * only needs to know whether one exists and whether it still works.
 * @param {object} row A scheduled_posts row.
 */
export const serializeScheduledRow = (row) => {
  const request = parseJson(row.forward_request, null)

  return {
    id: Number(row.id),
    walletAddress: row.wallet_address,
    networkId: Number(row.network_id),
    metadata: row.metadata,
    content: parseJson(row.content, null),
    allowComments: Boolean(Number(row.allow_comments)),
    quoteOf: row.quote_of ?? null,
    scheduledAt: Number(row.scheduled_at),
    timeZone: row.time_zone ?? null,
    status: row.status,
    signed: Boolean(row.signature),
    signatureStale: Boolean(Number(row.signature_stale)),
    forwardFrom: row.forward_from ?? null,
    forwardNonce: row.forward_nonce === null || row.forward_nonce === undefined ? null : String(row.forward_nonce),
    forwardDeadline: request?.deadline ? Number(request.deadline) : null,
    forwarderAddress: row.forwarder_address ?? null,
    attempts: Number(row.attempts) || 0,
    lastError: row.last_error ?? null,
    txHash: row.tx_hash ?? null,
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : Number(row.sent_at),
    createdAt: row.created_at,
  }
}

const markStale = async (id, reason) => {
  await pool.execute(
    `UPDATE scheduled_posts SET status = 'scheduled', signature_stale = 1, last_error = ? WHERE id = ?`,
    [String(reason ?? '').slice(0, 255), id],
  )
  return { id, outcome: 'stale', reason }
}

const markRetry = async (row, reason) => {
  const attempts = (Number(row.attempts) || 0) + 1
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return markStale(row.id, reason)

  await pool.execute(
    `UPDATE scheduled_posts SET status = 'scheduled', attempts = ?, last_error = ? WHERE id = ?`,
    [attempts, String(reason ?? '').slice(0, 255), row.id],
  )
  return { id: row.id, outcome: 'retry', reason }
}

const markSent = async (id, txHash) => {
  await pool.execute(
    `UPDATE scheduled_posts SET status = 'sent', tx_hash = ?, sent_at = ?, last_error = NULL WHERE id = ?`,
    [txHash, nowSeconds(), id],
  )
  return { id, outcome: 'sent', txHash }
}

/** Hands one claimed row to the relay route and records what it said. */
const deliverRow = async (row) => {
  const request = parseJson(row.forward_request, null)
  if (!request || !row.signature) return markStale(row.id, 'The stored request is unreadable')
  if (Number(request.deadline) <= nowSeconds()) return markStale(row.id, 'The signed request expired before it could be sent')

  const body = {
    request,
    signature: row.signature,
    forwarderAddress: row.forwarder_address,
    forwarderName: row.forwarder_name,
    chainId: Number(row.network_id),
  }

  let response
  try {
    response = await relayPost(
      new Request('http://hup.internal/api/v1/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  } catch (error) {
    return markRetry(row, error.message)
  }

  const payload = await response.json().catch(() => ({}))

  if (response.ok && payload?.success && payload.txHash) return markSent(row.id, payload.txHash)

  // The relayer's own throttle: not a verdict on the request, just not this minute
  if (response.status === 429) {
    await pool.execute(`UPDATE scheduled_posts SET status = 'scheduled' WHERE id = ?`, [row.id])
    return { id: row.id, outcome: 'throttled' }
  }

  // The chain or the relayer, not the request — worth another try
  if (response.status >= 500) return markRetry(row, payload?.error || `Relay answered ${response.status}`)

  // Anything else is the request itself: a replayed nonce, a failed simulation, an unknown
  // forwarder. Only the author can fix those, by re-signing or publishing directly.
  return markStale(row.id, payload?.error || `Relay refused the request (${response.status})`)
}

/**
 * Publishes every due, pre-signed post through the relayer.
 *
 * Rows are handled one after another on purpose: a signer's requests carry consecutive nonces,
 * and two in flight at once would race on them.
 *
 * @param {{walletAddress?: string|null, limit?: number}} [options] Narrow to one author (the
 *   runner delivering its own posts) and cap the batch.
 * @returns {Promise<{sent: object[], stale: object[], retry: object[], throttled: object[]}>}
 */
export async function deliverDueScheduledPosts({ walletAddress = null, limit = 25 } = {}) {
  await pool.execute(
    `UPDATE scheduled_posts SET status = 'scheduled' WHERE status = 'sending' AND updated_at < NOW() - INTERVAL ? MINUTE`,
    [STUCK_SENDING_MINUTES],
  )

  const params = [nowSeconds()]
  let where = `status = 'scheduled' AND signature IS NOT NULL AND signature_stale = 0 AND scheduled_at <= ?`
  if (walletAddress) {
    where += ' AND wallet_address = ?'
    params.push(walletAddress)
  }

  const [rows] = await pool.query(
    `SELECT * FROM scheduled_posts WHERE ${where} ORDER BY scheduled_at ASC, id ASC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 25))}`,
    params,
  )

  const result = { sent: [], stale: [], retry: [], throttled: [] }

  for (const row of rows) {
    // The claim is the lock: the cron and a runner delivering the same author's posts can both
    // reach here, and only one of them flips the row
    const [claim] = await pool.execute(`UPDATE scheduled_posts SET status = 'sending' WHERE id = ? AND status = 'scheduled'`, [row.id])
    if (claim.affectedRows !== 1) continue

    let outcome
    try {
      outcome = await deliverRow(row)
    } catch (error) {
      console.error('SCHEDULED_DELIVERY_ERROR:', row.id, error.message)
      outcome = await markRetry(row, error.message)
    }

    result[outcome.outcome]?.push(outcome)
  }

  return result
}
