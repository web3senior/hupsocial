/**
 * @file api/v1/admin/reports/route.js
 * @description Posts people have reported, newest first, with the category, the reporter's note
 * and the start of the post itself. Reporters are not public, so this answers only to a live
 * admin pass.
 *
 * POST accepts or dismisses every report on one post. A write, so the pass is not enough: it takes
 * a signature from the admin wallet over reportDecisionMessage plus a fresh nonce, burned before
 * anything is written.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { hasAdminPass } from '@/lib/adminPassServer'
import { isReportDecision, REPORT_DECISIONS, reportDecisionMessage } from '@/lib/reports'
import { verifyWalletSignature } from '@/lib/walletSignature'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()

const PAGE_SIZE = 25
const STATUSES = ['pending', 'reviewed', 'dismissed', 'actioned']
const EXCERPT_LENGTH = 280

export async function GET(request) {
  if (!(await hasAdminPass(request))) {
    return NextResponse.json({ success: false, error: 'Sign in as the admin to read reports.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status = STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : 'all'
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  try {
    const where = status === 'all' ? '' : 'WHERE r.status = ?'
    const params = status === 'all' ? [] : [status]

    // One row past the page says whether another page exists
    const [rows] = await pool.execute(
      `SELECT r.id, r.reporter_address, r.post_id, r.network_id, r.reason, r.status, r.created_at,
              c.category_name,
              p.wallet_address AS author_address,
              LEFT(p.content, ${EXCERPT_LENGTH}) AS excerpt,
              p.is_deleted,
              (SELECT COUNT(*) FROM user_reports o WHERE o.post_id = r.post_id AND o.network_id = r.network_id) AS post_reports
       FROM user_reports r
       LEFT JOIN report_categories c ON c.id = r.category_id
       LEFT JOIN posts p ON p.id = r.post_id AND p.network_id = r.network_id
       ${where}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
      params,
    )

    const [counts] = await pool.execute('SELECT status, COUNT(*) AS total FROM user_reports GROUP BY status')
    const byStatus = Object.fromEntries(STATUSES.map((name) => [name, 0]))
    counts.forEach((row) => {
      byStatus[row.status] = Number(row.total)
    })

    return NextResponse.json({
      success: true,
      data: {
        reports: rows.slice(0, PAGE_SIZE).map((row) => ({
          ...row,
          post_reports: Number(row.post_reports),
          is_deleted: Number(row.is_deleted) === 1,
        })),
        nextPage: rows.length > PAGE_SIZE ? page + 1 : null,
        counts: byStatus,
      },
    })
  } catch (error) {
    console.error('ADMIN_REPORTS_READ_ERROR:', error.message)
    return NextResponse.json({ success: false, error: 'Could not read reports.' }, { status: 500 })
  }
}

export async function POST(request) {
  if (!ADMIN_WALLET) {
    return NextResponse.json({ success: false, error: 'Admin is not configured.' }, { status: 503 })
  }

  try {
    const { decision, networkId, postId, signature, nonce, chainId } = await request.json()
    const network = Number(networkId)
    const post = Number(postId)

    if (!isReportDecision(decision) || !Number.isInteger(network) || !Number.isInteger(post) || !signature || !nonce) {
      return NextResponse.json({ success: false, error: 'decision, networkId, postId, signature and nonce are required.' }, { status: 400 })
    }

    const message = reportDecisionMessage({ decision, networkId: network, postId: post, nonce })
    if (!(await verifyWalletSignature(ADMIN_WALLET, message, signature, { chainId }))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const [burn] = await pool.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [nonce, ADMIN_WALLET])
    if (burn.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Invalid or expired nonce' }, { status: 401 })
    }

    // The decision is on the post, so it lands on every report it has; later reports arrive pending
    const status = REPORT_DECISIONS[decision]
    const [result] = await pool.execute('UPDATE user_reports SET status = ? WHERE post_id = ? AND network_id = ?', [status, post, network])

    return NextResponse.json({ success: true, data: { networkId: network, postId: post, status, updated: result.affectedRows } })
  } catch (error) {
    console.error('ADMIN_REPORTS_WRITE_ERROR:', error.message)
    return NextResponse.json({ success: false, error: 'Could not update the reports.' }, { status: 500 })
  }
}
