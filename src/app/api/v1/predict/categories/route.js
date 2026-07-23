/**
 * @file api/v1/predict/categories/route.js
 * @description Lists the active market categories from the market_categories table — the
 * runtime-editable taxonomy (rename labels, add rows, flip is_active in the DB; no code
 * changes). Markets store the slug; labels and emoji resolve from here at read time.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'
export const revalidate = 300

export async function GET() {
  try {
    const [rows] = await pool.execute(
      'SELECT slug, label, emoji FROM market_categories WHERE is_active = 1 ORDER BY sort_order, label',
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (error) {
    console.error('[GET_PREDICT_CATEGORIES_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
