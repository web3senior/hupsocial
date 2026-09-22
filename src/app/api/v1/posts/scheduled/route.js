/**
 * @file app/api/v1/posts/scheduled/route.js
 * @description An author's scheduled posts: the list, and the row the composer creates when
 * Schedule is pressed.
 *
 * Creating needs no bearer token: the request the author signed for the forwarder is the proof. It
 * has to be `create` for exactly this post, signed by the wallet it names, and accepted by the
 * forwarder itself (lib/scheduledDelivery.js). Listing does need the token from ./session, because a
 * scheduled post is nobody else's business until it is published.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { normalizeAddress } from '@/lib/address'
import { hasTable } from '@/lib/schema'
import { scheduleAddressFromRequest } from '@/lib/scheduleSession'
import { checkScheduledRequest, scheduleContractsFor, serializeScheduledRow, validateScheduledAt } from '@/lib/scheduledDelivery'

export const runtime = 'nodejs'

/* Production is migrated by hand, so this whole feature can be deployed before its table is
   there. Until it is, the composer hears so instead of the route 500ing. */
const NOT_MIGRATED = { success: false, error: 'Scheduling is not available yet' }

// Enough for a week of hourly posts; past this the queue is a bot, not a person
const MAX_PENDING_PER_WALLET = 50
const MAX_CONTENT_BYTES = 200_000
const PAGE_LIMIT = 100
const DUPLICATE_ENTRY = 'ER_DUP_ENTRY'

const SCOPES = {
  pending: { where: `status IN ('scheduled', 'sending')`, order: 'scheduled_at ASC, id ASC' },
  history: { where: `status IN ('sent', 'failed', 'cancelled')`, order: 'scheduled_at DESC, id DESC' },
  all: { where: '1 = 1', order: 'scheduled_at DESC, id DESC' },
}

const bad = (error, status = 400) => NextResponse.json({ success: false, error }, { status })

/** The author's rows, pending first by default. */
export async function GET(request) {
  try {
    const address = scheduleAddressFromRequest(request)
    if (!address) return bad('Sign in to see your scheduled posts', 401)
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
    return bad('Could not load scheduled posts', 500)
  }
}

/** Records a post and the signature that will publish it. */
export async function POST(request) {
  try {
    if (!(await hasTable('scheduled_posts'))) return NextResponse.json(NOT_MIGRATED, { status: 503 })

    const body = await request.json().catch(() => ({}))
    const author = normalizeAddress(body?.forwardRequest?.from)
    if (!author) return bad('The signed request is missing')

    const networkId = Number(body?.networkId)
    if (!Number.isInteger(networkId) || !scheduleContractsFor(networkId)) return bad('Scheduling is not supported on this network')

    const metadata = typeof body?.metadata === 'string' ? body.metadata.trim() : ''
    if (!metadata.startsWith('ipfs://') || metadata.length > 255) return bad('The post has to be pinned before it can be scheduled')

    const content = body?.content
    if (!content || typeof content !== 'object' || !Array.isArray(content.elements)) return bad('The post content is missing')
    const contentJson = JSON.stringify(content)
    if (contentJson.length > MAX_CONTENT_BYTES) return bad('The post is too large to schedule', 413)

    const when = validateScheduledAt(body?.scheduledAt)
    if (!when.ok) return bad(when.error)

    const quoteOf = body?.quoteOf === undefined || body?.quoteOf === null ? null : String(body.quoteOf)
    if (quoteOf !== null && !/^\d{1,32}$/.test(quoteOf)) return bad('The quoted post reference is invalid')

    const timeZone = typeof body?.timeZone === 'string' && body.timeZone.length <= 64 ? body.timeZone : null
    const allowComments = body?.allowComments !== false

    const [[{ pending }]] = await pool.execute(
      `SELECT COUNT(*) AS pending FROM scheduled_posts WHERE wallet_address = ? AND status IN ('scheduled', 'sending')`,
      [author],
    )
    if (Number(pending) >= MAX_PENDING_PER_WALLET) return bad(`You can have up to ${MAX_PENDING_PER_WALLET} posts scheduled at once`, 429)

    // Last, because it is the one check that costs an RPC round trip
    const check = await checkScheduledRequest({
      author,
      networkId,
      metadata,
      allowComments,
      scheduledAt: when.value,
      forwardRequest: body.forwardRequest,
      signature: body.signature,
    })
    if (!check.ok) return bad(check.error, check.status ?? 400)

    let insert
    try {
      ;[insert] = await pool.execute(
        `INSERT INTO scheduled_posts
           (wallet_address, network_id, metadata, content, allow_comments, quote_of, scheduled_at, time_zone,
            forward_request, forward_nonce, forwarder_address, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          author,
          networkId,
          metadata,
          contentJson,
          allowComments ? 1 : 0,
          quoteOf,
          when.value,
          timeZone,
          JSON.stringify(check.request),
          check.request.nonce,
          check.forwarder,
          body.signature,
        ],
      )
    } catch (error) {
      if (error?.code === DUPLICATE_ENTRY) return bad('This signature is already scheduled', 409)
      throw error
    }

    const [[row]] = await pool.execute('SELECT * FROM scheduled_posts WHERE id = ? LIMIT 1', [insert.insertId])
    return NextResponse.json({ success: true, data: serializeScheduledRow(row) }, { status: 201 })
  } catch (error) {
    console.error('[SCHEDULED_CREATE_ERROR]:', error)
    return bad('Could not schedule the post', 500)
  }
}
