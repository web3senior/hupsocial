/**
 * @file api/v1/nfts/collections/[networkId]/[address]/audit/route.js
 * @description The permanence audit for one collection, read from nft_collection_audits —
 * the table cidex's audit loop fills. GET answers with the latest report and where the row is
 * in the queue; POST asks for a (re-)audit by moving the row's requested_at forward, which is
 * all the app ever writes here. The probing itself runs in cidex.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { appChains } from '@/config/contracts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A settled report is a day's fact and may sit at the edge briefly; a row that is queued or
// being probed changes every few seconds and the client polls it, so the browser must never
// answer those polls from its own cache
const SETTLED_CACHE_CONTROL = 'public, max-age=15, s-maxage=30, stale-while-revalidate=60'
const cacheControlFor = (status) => (status === 'done' || status === 'failed' ? SETTLED_CACHE_CONTROL : 'no-store')

// A second request within this window is answered with the row it would have produced anyway
const REQUEST_COOLDOWN_MS = 10 * 60 * 1000

const isValidKey = (networkId, address) => /^\d+$/.test(String(networkId)) && /^0x[0-9a-fA-F]{40}$/.test(String(address))

const parseJson = (raw, fallback) => {
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/**
 * Where the row is in its life: nothing yet, waiting, being probed, refreshing behind a
 * report it already has, failed with nothing to show, or done.
 */
const statusOf = (row) => {
  if (!row) return 'none'
  const audited = row.audited_at ? new Date(row.audited_at).getTime() : 0
  const requested = row.requested_at ? new Date(row.requested_at).getTime() : 0
  const running = Boolean(row.audit_started_at)
  if (!audited) return running ? 'running' : 'pending'
  if (requested > audited) return row.score === null ? (running ? 'running' : 'pending') : 'refreshing'
  if (row.score === null) return 'failed'
  return 'done'
}

const rowToAudit = (row, { summary }) => ({
  networkId: Number(row.network_id),
  collection: row.collection,
  kind: row.kind || null,
  name: row.name || null,
  score: row.score === null ? null : Number(row.score),
  grade: row.grade || null,
  categories:
    row.score === null
      ? null
      : {
          storage: Number(row.storage_score),
          availability: Number(row.availability_score),
          integrity: Number(row.integrity_score),
          contract: Number(row.contract_score),
        },
  badges: parseJson(row.badges, []),
  report: summary ? undefined : parseJson(row.report, null),
  history: summary ? undefined : parseJson(row.history, []),
  error: row.error || null,
  // Live queue state: the engine's current stage while running, and how many waiting rows
  // are ahead while pending
  progress: row.progress || null,
  startedAt: row.audit_started_at || null,
  queueAhead: row.queue_ahead === undefined || row.queue_ahead === null ? null : Number(row.queue_ahead),
  requestedAt: row.requested_at,
  auditedAt: row.audited_at,
  auditCount: Number(row.audit_count) || 0,
  explorerUrl: row.explorer_url || null,
})

// How many due rows a worker will take before this one: the queue serves the newest request
// first, so it is the count of waiting rows asked for later
const QUEUE_AHEAD =
  '(SELECT COUNT(*) FROM nft_collection_audits q WHERE q.audit_started_at IS NULL AND (q.audited_at IS NULL OR q.requested_at > q.audited_at) AND q.requested_at > a.requested_at) AS queue_ahead'

const readRow = async (networkId, collection, { summary }) => {
  const columns = summary
    ? `a.network_id, a.collection, a.kind, a.name, a.score, a.grade, a.storage_score, a.availability_score, a.integrity_score, a.contract_score, a.badges, a.error, a.progress, a.requested_at, a.audit_started_at, a.audited_at, a.audit_count, n.explorer_url, ${QUEUE_AHEAD}`
    : `a.*, n.explorer_url, ${QUEUE_AHEAD}`
  const [rows] = await pool.execute(
    `SELECT ${columns}
       FROM nft_collection_audits a
       LEFT JOIN networks n ON n.id = a.network_id
      WHERE a.network_id = ? AND a.collection = ?
      LIMIT 1`,
    [networkId, collection],
  )
  return rows[0] || null
}

export async function GET(request, { params }) {
  try {
    const { networkId, address } = await params
    if (!isValidKey(networkId, address)) {
      return NextResponse.json({ success: false, error: 'A numeric networkId and a collection address are required' }, { status: 400 })
    }
    const { searchParams } = new URL(request.url)
    const summary = searchParams.get('summary') === '1'

    const row = await readRow(Number(networkId), String(address).toLowerCase(), { summary })
    const status = statusOf(row)

    return NextResponse.json({ success: true, status, data: row ? rowToAudit(row, { summary }) : null }, { headers: { 'Cache-Control': cacheControlFor(status) } })
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_AUDIT_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/**
 * Asks cidex to audit this collection: a row that does not exist is created due, one that
 * does gets requested_at moved past its audited_at. Nothing is probed here.
 */
export async function POST(request, { params }) {
  try {
    const { networkId, address } = await params
    if (!isValidKey(networkId, address)) {
      return NextResponse.json({ success: false, error: 'A numeric networkId and a collection address are required' }, { status: 400 })
    }
    const chainId = Number(networkId)
    if (!appChains.some((chain) => chain.id === chainId)) {
      return NextResponse.json({ success: false, error: 'That network is not supported' }, { status: 400 })
    }
    const collection = String(address).toLowerCase()

    const existing = await readRow(chainId, collection, { summary: true })
    const existingStatus = statusOf(existing)

    if (existing && existingStatus === 'done') {
      const age = Date.now() - new Date(existing.audited_at).getTime()
      if (age < REQUEST_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil((REQUEST_COOLDOWN_MS - age) / 1000)
        return NextResponse.json(
          { success: false, throttled: true, status: existingStatus, data: rowToAudit(existing, { summary: true }), error: `Audited ${Math.round(age / 60000)} min ago — try again in ${Math.ceil(retryAfterSeconds / 60)} min` },
          { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
        )
      }
    }

    // Whoever is looking at a collection goes first: a waiting row moves to the front of the
    // queue, a settled one back into it. A row already being probed is left alone.
    if (!existing || existingStatus !== 'running') {
      await pool.execute(
        `INSERT INTO nft_collection_audits (network_id, collection, requested_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE requested_at = NOW()`,
        [chainId, collection],
      )
    }

    const row = await readRow(chainId, collection, { summary: true })
    return NextResponse.json({ success: true, status: statusOf(row), data: row ? rowToAudit(row, { summary: true }) : null })
  } catch (error) {
    console.error('[POST_NFT_COLLECTION_AUDIT_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
