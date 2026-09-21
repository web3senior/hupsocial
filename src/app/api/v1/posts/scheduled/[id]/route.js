/**
 * @file app/api/v1/posts/scheduled/[id]/route.js
 * @description Everything that happens to one scheduled post after it exists: the author attaches
 * (or drops) the signed forward request the relayer will deliver, moves the time, hands the row
 * to their own browser to publish, records the transaction that published it, or cancels it.
 *
 * The one check that matters most is on `sign`: the calldata inside a stored request is decoded
 * and has to be `create` for this exact row — this author, a plain post, this metadata. A
 * signature the relayer will execute unattended must never be able to say anything else.
 */

import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import hupAbi from '@/abi/post.json'
import { CONTRACTS } from '@/config/contracts'
import { isEvmAddress, sameAddress } from '@/lib/address'
import { hasTable } from '@/lib/schema'
import { scheduleAddressFromRequest } from '@/lib/scheduleSession'
import { serializeScheduledRow, validateScheduledAt } from '@/lib/scheduledDelivery'

export const runtime = 'nodejs'

const NOT_MIGRATED = { success: false, error: 'Scheduling is not available yet' }
const CONTENT_TYPE_POST = 0

const hupInterface = new ethers.Interface(hupAbi)

const nowSeconds = () => Math.floor(Date.now() / 1000)

const ownedRow = async (id, address) => {
  if (!Number.isInteger(id) || id <= 0) return null
  const [[row]] = await pool.execute('SELECT * FROM scheduled_posts WHERE id = ? AND wallet_address = ? LIMIT 1', [id, address])
  return row ?? null
}

const reply = async (id) => {
  const [[row]] = await pool.execute('SELECT * FROM scheduled_posts WHERE id = ? LIMIT 1', [id])
  return NextResponse.json({ success: true, data: serializeScheduledRow(row) })
}

const bad = (error, status = 400) => NextResponse.json({ success: false, error }, { status })

/**
 * Whether a forward request is the one this row is allowed to hold. Returns the reason it is
 * not, or null when it is.
 */
const requestMismatch = (row, forwardRequest) => {
  const hup = CONTRACTS[`chain${Number(row.network_id)}`]?.hup
  if (!hup || !sameAddress(forwardRequest?.to, hup)) return 'The request does not target the Hup contract on this network'
  if (BigInt(forwardRequest?.value ?? 0) !== 0n) return 'A scheduled post cannot carry value'
  if (!isEvmAddress(forwardRequest?.from)) return 'The request has no signer'

  let decoded
  try {
    decoded = hupInterface.decodeFunctionData('create', forwardRequest.data)
  } catch {
    return 'The request is not a create call'
  }

  const [owner, contentType, metadata, parentId] = decoded
  if (!sameAddress(owner, row.wallet_address)) return 'The request is signed for a different author'
  if (Number(contentType) !== CONTENT_TYPE_POST) return 'Only plain posts can be scheduled'
  if (metadata !== row.metadata) return 'The request does not carry this post'
  if (BigInt(parentId) !== 0n) return 'A scheduled post cannot be a reply'

  const deadline = Number(forwardRequest.deadline)
  if (!Number.isInteger(deadline) || deadline < Number(row.scheduled_at)) return 'The request expires before the post is due'

  return null
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

    switch (body?.action) {
      case 'sign': {
        if (row.status !== 'scheduled') return bad('Only a pending post can be signed', 409)

        const forwardRequest = body.forwardRequest
        const mismatch = requestMismatch(row, forwardRequest)
        if (mismatch) return bad(mismatch)
        if (typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(body.signature) || body.signature.length > 200) return bad('A signature is required')
        if (!isEvmAddress(body.forwarderAddress)) return bad('A forwarder address is required')

        const stored = {
          from: forwardRequest.from,
          to: forwardRequest.to,
          value: String(forwardRequest.value ?? '0'),
          gas: String(forwardRequest.gas),
          nonce: String(forwardRequest.nonce),
          deadline: Number(forwardRequest.deadline),
          data: forwardRequest.data,
        }

        await pool.execute(
          `UPDATE scheduled_posts
              SET forward_from = ?, forward_request = ?, forward_nonce = ?, forwarder_address = ?, forwarder_name = ?,
                  signature = ?, signature_stale = 0, attempts = 0, last_error = NULL
            WHERE id = ?`,
          [
            forwardRequest.from.toLowerCase(),
            JSON.stringify(stored),
            String(forwardRequest.nonce),
            body.forwarderAddress,
            typeof body.forwarderName === 'string' ? body.forwarderName.slice(0, 64) : null,
            body.signature,
            id,
          ],
        )
        return reply(id)
      }

      case 'unsign': {
        if (row.status !== 'scheduled') return bad('Only a pending post can be changed', 409)
        await pool.execute(
          `UPDATE scheduled_posts
              SET forward_from = NULL, forward_request = NULL, forward_nonce = NULL, forwarder_address = NULL, forwarder_name = NULL,
                  signature = NULL, signature_stale = 0, last_error = NULL
            WHERE id = ?`,
          [id],
        )
        return reply(id)
      }

      case 'reschedule': {
        if (row.status !== 'scheduled') return bad('Only a pending post can be moved', 409)
        const when = validateScheduledAt(body.scheduledAt)
        if (!when.ok) return bad(when.error)

        // A signed request expires at a fixed deadline; moving the post past it leaves the
        // relayer nothing it can send, so the row is flagged for the author to re-sign
        let stale = Number(row.signature_stale) ? 1 : 0
        if (row.signature && row.forward_request) {
          try {
            const { deadline } = JSON.parse(row.forward_request)
            if (Number(deadline) < when.value) stale = 1
          } catch {
            stale = 1
          }
        }

        await pool.execute(
          `UPDATE scheduled_posts SET scheduled_at = ?, time_zone = ?, signature_stale = ? WHERE id = ?`,
          [when.value, typeof body.timeZone === 'string' ? body.timeZone.slice(0, 64) : row.time_zone, stale, id],
        )
        return reply(id)
      }

      // "Post now": pulled to the present, so the runner the page pokes (or the cron) takes it
      // on its next look. A signed request's deadline sits past the old time, so it still holds.
      case 'now': {
        if (row.status !== 'scheduled') return bad('Only a pending post can be moved', 409)
        await pool.execute(`UPDATE scheduled_posts SET scheduled_at = ? WHERE id = ?`, [nowSeconds(), id])
        return reply(id)
      }

      // The author's browser is about to publish this row itself. Claiming it keeps the cron
      // from relaying the same post a moment later.
      case 'claim': {
        const [claim] = await pool.execute(`UPDATE scheduled_posts SET status = 'sending' WHERE id = ? AND status = 'scheduled'`, [id])
        if (claim.affectedRows !== 1) return bad('This post is already being published', 409)
        return reply(id)
      }

      case 'release': {
        await pool.execute(`UPDATE scheduled_posts SET status = 'scheduled' WHERE id = ? AND status = 'sending'`, [id])
        return reply(id)
      }

      case 'sent': {
        if (!['scheduled', 'sending'].includes(row.status)) return bad('This post has already been settled', 409)
        const txHash = typeof body.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(body.txHash) ? body.txHash : null
        if (!txHash) return bad('A transaction hash is required')

        await pool.execute(
          `UPDATE scheduled_posts SET status = 'sent', tx_hash = ?, sent_at = ?, last_error = NULL WHERE id = ?`,
          [txHash, nowSeconds(), id],
        )
        return reply(id)
      }

      default:
        return bad('Unknown action')
    }
  } catch (error) {
    console.error('[SCHEDULED_UPDATE_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Could not update the scheduled post' }, { status: 500 })
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

    const purge = new URL(request.url).searchParams.get('purge') === '1'

    if (['scheduled', 'sending'].includes(row.status)) {
      await pool.execute(`UPDATE scheduled_posts SET status = 'cancelled', forward_request = NULL, signature = NULL WHERE id = ?`, [id])
      return NextResponse.json({ success: true, data: { id, status: 'cancelled' } })
    }

    if (purge) {
      await pool.execute('DELETE FROM scheduled_posts WHERE id = ?', [id])
      return NextResponse.json({ success: true, data: { id, status: 'deleted' } })
    }

    return bad('This post has already been settled', 409)
  } catch (error) {
    console.error('[SCHEDULED_DELETE_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Could not cancel the scheduled post' }, { status: 500 })
  }
}
