import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const [rows] = await pool.execute(
      `SELECT id, category_name, description FROM report_categories WHERE is_active = 1 ORDER BY id ASC`
    )
    return NextResponse.json({ success: true, data: rows })
  } catch (error) {
    console.error('[REPORT_CATEGORIES_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch categories.' }, { status: 500 })
  }
}
