/**
 * @file app/api/v1/posts/scheduled/[id]/route.js
 * @description One scheduled post after it exists: moving it to a new time (including "Post now"),
 * or cancelling it.
 *
 * The time is part of what the author signed, so moving it means a new signature. That signature
 * must reuse the row's nonce: whichever of the old and new requests executes first spends it, so a
 * post can never go out twice even if the old signature surfaced somewhere.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { hasTable } from '@/lib/schema'
import { scheduleAddressFromRequest } from '@/lib/scheduleSession'
import { checkScheduledRequest, serializeScheduledRow, validateScheduledAt } from '@/lib/scheduledDelivery'

export const runtime = 'nodejs'

const NOT_MIGRATED = { success: false, error: 'Scheduling is not available yet' }

const bad = (error, status = 400) => NextResponse.json({ success: false, error }, { status })

const ownedRow = async (id, address) => {
  if (!Number.isInteger(id) || id <= 0) return null
  const [[row]] = await pool.execute('SELECT * FROM scheduled_posts WHERE id = ? AND wallet_address = ? LIMIT 1', [id, address])
  return row ?? null
}

export async function PATCH(request, { params }) {
  try {
    const address = scheduleAddressFromRequest(request)
    if (!address) return bad('Sign in to manage your scheduled posts', 401)
    if (!(await hasTable('scheduled_posts'))) return NextResponse.json(NOT_MIGRATED, { status: 503 })

    const { id: rawId } = await params
    const id = Number(rawId)
    const row = await ownedRow(id, address)
    if (!row) return bad('Scheduled post not found', 404)

    const body = await request.json().catch(() => ({}))
    if (body?.action !== 'reschedule') return bad('Unknown action')

    // A failed post can be sent again for as long as its nonce is unspent, which the check reads
    if (!['scheduled', 'failed'].includes(row.status)) return bad('This post can no longer be moved', 409)

    const when = validateScheduledAt(body.scheduledAt, { allowNow: body.now === true })
    if (!when.ok) return bad(when.error)

    const check = await checkScheduledRequest({
      author: row.wallet_address,
      networkId: Number(row.network_id),
      metadata: row.metadata,
      allowComments: Boolean(Number(row.allow_comments)),
      scheduledAt: when.value,
      forwardRequest: body.forwardRequest,
      signature: body.signature,
      expectNonce: row.forward_nonce,
    })
    if (!check.ok) return bad(check.error, check.status ?? 400)

    const [update] = await pool.execute(
      `UPDATE scheduled_posts
          SET scheduled_at = ?, time_zone = ?, forward_request = ?, signature = ?, status = 'scheduled',
              attempts = 0, retry_at = NULL, last_error = NULL, tx_hash = NULL
        WHERE id = ? AND status IN ('scheduled', 'failed')`,
      [
        when.value,
        typeof body.timeZone === 'string' ? body.timeZone.slice(0, 64) : row.time_zone,
        JSON.stringify(check.request),
        body.signature,
        id,
      ],
    )
    if (update.affectedRows !== 1) return bad('This post is being published right now', 409)

    const [[updated]] = await pool.execute('SELECT * FROM scheduled_posts WHERE id = ? LIMIT 1', [id])
    return NextResponse.json({ success: true, data: serializeScheduledRow(updated) })
  } catch (error) {
    console.error('[SCHEDULED_UPDATE_ERROR]:', error)
    return bad('Could not update the scheduled post', 500)
  }
}

/** Cancels a pending post, or with ?purge=1 removes a settled one from the history. */
export async function DELETE(request, { params }) {
  try {
    const address = scheduleAddressFromRequest(request)
    if (!address) return bad('Sign in to manage your scheduled posts', 401)
    if (!(await hasTable('scheduled_posts'))) return NextResponse.json(NOT_MIGRATED, { status: 503 })

    const { id: rawId } = await params
    const id = Number(rawId)
    const row = await ownedRow(id, address)
    if (!row) return bad('Scheduled post not found', 404)

    if (row.status === 'sending') return bad('This post is being published right now', 409)

    if (row.status === 'scheduled') {
      // Dropping the signature is what cancels it: the relayer is the only thing holding a copy
      const [cancel] = await pool.execute(
        `UPDATE scheduled_posts SET status = 'cancelled', forward_request = NULL, signature = NULL WHERE id = ? AND status = 'scheduled'`,
        [id],
      )
      if (cancel.affectedRows !== 1) return bad('This post is being published right now', 409)
      return NextResponse.json({ success: true, data: { id, status: 'cancelled' } })
    }

    if (new URL(request.url).searchParams.get('purge') === '1') {
      await pool.execute('DELETE FROM scheduled_posts WHERE id = ?', [id])
      return NextResponse.json({ success: true, data: { id, status: 'deleted' } })
    }

    return bad('This post has already been settled', 409)
  } catch (error) {
    console.error('[SCHEDULED_DELETE_ERROR]:', error)
    return bad('Could not cancel the scheduled post', 500)
  }
}
