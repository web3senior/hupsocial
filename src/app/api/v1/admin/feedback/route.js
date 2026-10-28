/**
 * @file api/v1/admin/feedback/route.js
 * @description What people sent through /help: feedback, bug reports, app listings and the rest
 * of the support tickets, newest first. Tickets carry emails and private messages, so unlike the
 * other admin reads this one answers only to a live admin pass.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { hasAdminPass } from '@/lib/adminPassServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export async function GET(request) {
  if (!(await hasAdminPass(request))) {
    return NextResponse.json({ success: false, error: 'Sign in as the admin to read feedback.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') || 'all'
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  try {
    const where = category === 'all' ? '' : 'WHERE category = ?'
    const params = category === 'all' ? [] : [category]

    // One row past the page says whether another page exists
    const [rows] = await pool.execute(
      `SELECT id, wallet_address, category, subject, message, email, status, created_at
       FROM support_tickets
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
      params,
    )

    const [categories] = await pool.execute(
      `SELECT category, COUNT(*) AS total, COALESCE(SUM(status = 'open'), 0) AS open
       FROM support_tickets
       GROUP BY category
       ORDER BY total DESC`,
    )

    return NextResponse.json({
      success: true,
      data: {
        tickets: rows.slice(0, PAGE_SIZE).map((row) => ({ ...row, id: String(row.id) })),
        nextPage: rows.length > PAGE_SIZE ? page + 1 : null,
        categories: categories.map((row) => ({ category: row.category, total: Number(row.total), open: Number(row.open) })),
      },
    })
  } catch (error) {
    console.error('ADMIN_FEEDBACK_READ_ERROR:', error.message)
    return NextResponse.json({ success: false, error: 'Could not read feedback.' }, { status: 500 })
  }
}
