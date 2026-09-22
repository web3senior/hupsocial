/**
 * @file api/v1/tasks/route.js
 * @description Directory of indexed Hup Tasks. Filters and sorts inside a derived table first,
 * then joins the post and the poster, so the join only ever runs on one page of rows.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LIMIT = 50
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

const STATUS_WHERE = {
  open: { sql: 't.closed_at = 0 AND t.deadline > ? AND t.paid_slots < t.slots', usesNow: true },
  review: { sql: 't.closed_at = 0 AND t.deadline <= ? AND t.paid_slots < t.slots', usesNow: true },
  done: { sql: '(t.closed_at > 0 OR t.paid_slots >= t.slots)', usesNow: false },
  all: { sql: null, usesNow: false },
}

const SORT_ORDER = {
  recent: 't.block_number DESC, t.log_index DESC',
  deadline: 't.deadline ASC',
  reward: 't.slots - t.paid_slots DESC, t.reward_per_slot DESC',
}

const textOf = (content) => {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content
    return parsed?.elements?.find((element) => element?.type === 'text')?.data?.text ?? ''
  } catch {
    return ''
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(searchParams.get('networkId'), 10) || null
    const status = STATUS_WHERE[searchParams.get('status')] ? searchParams.get('status') : 'open'
    const sort = SORT_ORDER[searchParams.get('sort')] ? searchParams.get('sort') : 'recent'
    const category = (searchParams.get('category') || '').trim().toLowerCase().slice(0, 32) || null
    const poster = (searchParams.get('poster') || '').trim()
    const worker = (searchParams.get('worker') || '').trim()
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit'), 10) || 20))
    const offset = Math.max(0, parseInt(searchParams.get('offset'), 10) || 0)
    const now = Math.floor(Date.now() / 1000)

    const where = ['t.hidden = 0']
    const params = []
    if (STATUS_WHERE[status].sql) {
      where.push(STATUS_WHERE[status].sql)
      if (STATUS_WHERE[status].usesNow) params.push(now)
    }
    if (networkId) {
      where.push('t.network_id = ?')
      params.push(networkId)
    }
    if (category) {
      where.push('t.category = ?')
      params.push(category)
    }
    if (ADDRESS.test(poster)) {
      where.push('t.poster = ?')
      params.push(poster.toLowerCase())
    }
    if (ADDRESS.test(worker)) {
      where.push('EXISTS (SELECT 1 FROM task_payouts w WHERE w.network_id = t.network_id AND w.post_id = t.post_id AND w.worker = ?)')
      params.push(worker.toLowerCase())
    }

    const [rows] = await pool.execute(
      `SELECT page.*, p.content AS post_content, p.comment_count, p.is_deleted AS post_deleted,
              u.name AS display_name, u.profileImage AS profile_image
         FROM (
           SELECT t.network_id, t.contract_address, t.post_id, t.poster AS wallet_address, t.category,
                  t.payment_token, t.is_lsp7, t.token_symbol, t.token_decimals, t.reward_per_slot, t.fee_per_slot,
                  t.slots, t.paid_slots, t.deadline, t.is_sealed, t.closed_reason, t.closed_at, t.refunded,
                  t.posted_at, t.block_number, t.log_index
             FROM task_bounties t
            WHERE ${where.join(' AND ')}
            ORDER BY ${SORT_ORDER[sort]}
            LIMIT ${limit + 1} OFFSET ${offset}
         ) page
         LEFT JOIN posts p ON p.id = page.post_id AND p.network_id = page.network_id
         LEFT JOIN users u ON u.wallet_address = page.wallet_address
        ORDER BY ${SORT_ORDER[sort].replaceAll('t.', 'page.')}`,
      params,
    )

    const hasMore = rows.length > limit
    const data = rows.slice(0, limit).map(({ post_content, ...row }) => ({ ...row, post_text: textOf(post_content).slice(0, 400) }))
    await fulfillUniversalProfiles(data, pool)

    return NextResponse.json({ success: true, data, hasMore })
  } catch (error) {
    console.error('[GET_TASKS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
