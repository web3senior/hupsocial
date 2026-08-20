/**
 * @file api/v1/communities/categories/route.js
 * @description Every category the community picker may offer — the active rows of
 * `community_categories`, in display order. The same table is what cidex validates a community's
 * metadata slug against before indexing it, so the picker can never offer a category the indexer
 * then drops (the `countries` / profile-origin arrangement, applied to communities).
 *
 * A dozen rows that change roughly never, fetched whenever the communities page mounts, so the
 * answer is cached hard and revalidated in the background.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const [categories] = await pool.execute(
      `SELECT slug, label
       FROM community_categories
       WHERE is_active = 1
       ORDER BY sort_order ASC, label ASC`
    )

    return NextResponse.json(
      {
        success: true,
        data: categories,
        meta: { count: categories.length, timestamp: new Date().toISOString() },
      },
      { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=86400' } }
    )
  } catch (error) {
    console.error('[COMMUNITY_CATEGORIES_API_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch community categories', details: error.message }, { status: 500 })
  }
}
