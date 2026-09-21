/**
 * @file app/api/v1/posts/scheduled/route.js
 * @description An author's scheduled posts: the list, and the row the composer creates when
 * Schedule is pressed. Every call carries the bearer token from ./session — a schedule is a
 * promise to publish under a wallet's name, so nothing here is readable or writable without it.
 *
 * The metadata is already pinned by the time a row lands here; this only records when to write
 * it onchain. The signed forward request, when the author has one, arrives separately through
 * ./[id] once the row exists.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { CONTRACTS } from '@/config/contracts'
import { hasTable } from '@/lib/schema'
import { scheduleAddressFromRequest } from '@/lib/scheduleSession'
import { serializeScheduledRow, validateScheduledAt } from '@/lib/scheduledDelivery'

export const runtime = 'nodejs'

/* Production is migrated by hand, so this whole feature can be deployed before its table is
   there. Until it is, the composer hears so instead of the route 500ing. */
const NOT_MIGRATED = { success: false, error: 'Scheduling is not available yet' }

// Enough for a week of hourly posts; past this the queue is a bot, not a person
const MAX_PENDING_PER_WALLET = 50
const MAX_CONTENT_BYTES = 200_000
const PAGE_LIMIT = 100

const SCOPES = {
  pending: { where: `status IN ('scheduled', 'sending')`, order: 'scheduled_at ASC, id ASC' },
  history: { where: `status IN ('sent', 'failed', 'cancelled')`, order: 'scheduled_at DESC, id DESC' },
  all: { where: '1 = 1', order: 'scheduled_at DESC, id DESC' },
}

/** The author's rows, pending first by default. */
export async function GET(request) {
  try {
    const address = scheduleAddressFromRequest(request)
    if (!address) return NextResponse.json({ success: false, error: 'Sign in to see your scheduled posts' }, { status: 401 })
    if (!(await hasTable('scheduled_posts'))) return NextResponse.json(NOT_MIGRATED, { status: 503 })

    const { searchParams } = new URL(request.url)
    const scope = SCOPES[searchParams.get('scope')] ?? SCOPES.pending

    const [rows] = await pool.execute(
      `SELECT * FROM scheduled_posts WHERE wallet_address = ? AND ${scope.where} ORDER BY ${scope.order} LIMIT ${PAGE_LIMIT}`,
      [address],
    )

    return NextResponse.json({ success: true, data: rows.map(serializeScheduledRow) })
  } catch (error) {
    console.error('[SCHEDULED_LIST_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Could not load scheduled posts' }, { status: 500 })
  }
}

/** Records a post to publish later. */
export async function POST(request) {
  try {
    const address = scheduleAddressFromRequest(request)
    if (!address) return NextResponse.json({ success: false, error: 'Sign in before scheduling a post' }, { status: 401 })
    if (!(await hasTable('scheduled_posts'))) return NextResponse.json(NOT_MIGRATED, { status: 503 })

    const body = await request.json().catch(() => ({}))

    const networkId = Number(body?.networkId)
    if (!Number.isInteger(networkId) || !CONTRACTS[`chain${networkId}`]?.hup) {
      return NextResponse.json({ success: false, error: 'Scheduling is not supported on this network' }, { status: 400 })
    }

    const metadata = typeof body?.metadata === 'string' ? body.metadata.trim() : ''
    if (!metadata.startsWith('ipfs://') || metadata.length > 255) {
      return NextResponse.json({ success: false, error: 'The post has to be pinned before it can be scheduled' }, { status: 400 })
    }

    const content = body?.content
    if (!content || typeof content !== 'object' || !Array.isArray(content.elements)) {
      return NextResponse.json({ success: false, error: 'The post content is missing' }, { status: 400 })
    }
    const contentJson = JSON.stringify(content)
    if (contentJson.length > MAX_CONTENT_BYTES) {
      return NextResponse.json({ success: false, error: 'The post is too large to schedule' }, { status: 413 })
    }

    const when = validateScheduledAt(body?.scheduledAt)
    if (!when.ok) return NextResponse.json({ success: false, error: when.error }, { status: 400 })

    const quoteOf = body?.quoteOf === undefined || body?.quoteOf === null ? null : String(body.quoteOf)
    if (quoteOf !== null && !/^\d{1,32}$/.test(quoteOf)) {
      return NextResponse.json({ success: false, error: 'The quoted post reference is invalid' }, { status: 400 })
    }

    const timeZone = typeof body?.timeZone === 'string' && body.timeZone.length <= 64 ? body.timeZone : null
    const allowComments = body?.allowComments === false ? 0 : 1

    const [[{ pending }]] = await pool.execute(
      `SELECT COUNT(*) AS pending FROM scheduled_posts WHERE wallet_address = ? AND status IN ('scheduled', 'sending')`,
      [address],
    )
    if (Number(pending) >= MAX_PENDING_PER_WALLET) {
      return NextResponse.json({ success: false, error: `You can have up to ${MAX_PENDING_PER_WALLET} posts scheduled at once` }, { status: 429 })
    }

    const [insert] = await pool.execute(
      `INSERT INTO scheduled_posts
         (wallet_address, network_id, metadata, content, allow_comments, quote_of, scheduled_at, time_zone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [address, networkId, metadata, contentJson, allowComments, quoteOf, when.value, timeZone],
    )

    const [[row]] = await pool.execute('SELECT * FROM scheduled_posts WHERE id = ? LIMIT 1', [insert.insertId])
    return NextResponse.json({ success: true, data: serializeScheduledRow(row) }, { status: 201 })
  } catch (error) {
    console.error('[SCHEDULED_CREATE_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Could not schedule the post' }, { status: 500 })
  }
}
