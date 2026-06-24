import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function POST(request, { params }) {
  try {
    const { networkId, postId } = await params
    const { reporter_address, category_id, reason } = await request.json()

    if (!networkId || !postId || !reporter_address || !category_id) {
      return NextResponse.json(
        { success: false, error: 'reporter_address and category_id are required.' },
        { status: 400 }
      )
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(reporter_address)) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet address format.' },
        { status: 400 }
      )
    }

    const [existing] = await pool.execute(
      `SELECT id FROM user_reports WHERE reporter_address = ? AND post_id = ? AND network_id = ? LIMIT 1`,
      [reporter_address, postId, networkId]
    )

    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: 'You have already reported this post.' },
        { status: 409 }
      )
    }

    await pool.execute(
      `INSERT INTO user_reports (reporter_address, post_id, network_id, category_id, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [reporter_address, postId, networkId, category_id, reason?.trim() || null]
    )

    return NextResponse.json({ success: true, message: 'Report submitted.' })
  } catch (error) {
    console.error('[POST_REPORT_ERROR]:', error.message)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to submit report.',
        details: process.env.NODE_ENV === 'production' ? undefined : error.message,
      },
      { status: 500 }
    )
  }
}

export async function GET(request, { params }) {
  try {
    const { networkId, postId } = await params
    const { searchParams } = new URL(request.url)
    const reporter_address = searchParams.get('reporter_address')

    if (!reporter_address) {
      return NextResponse.json({ success: false, error: 'reporter_address is required.' }, { status: 400 })
    }

    const [rows] = await pool.execute(
      `SELECT id FROM user_reports WHERE reporter_address = ? AND post_id = ? AND network_id = ? LIMIT 1`,
      [reporter_address, postId, networkId]
    )

    return NextResponse.json({ success: true, has_reported: rows.length > 0 })
  } catch (error) {
    console.error('[POST_REPORT_CHECK_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to check report status.' }, { status: 500 })
  }
}
