/**
 * @file api/v1/countries/route.js
 * @description Every country the profile picker may offer — and, because the same table is what a
 * profile save validates against, every country it will accept. One source for both halves is the
 * point: a picker fed from anywhere else could offer a country the setter then rejects.
 *
 * The onchain origins listed above these in the picker are NOT here. They are a curated,
 * dependency-free list (config/originOptions.js) rather than data, so they ship with the build
 * and cost no round trip.
 *
 * 249 rows that change roughly never, fetched whenever someone opens the profile editor, so the
 * answer is cached hard and revalidated in the background.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    /* `id` is deliberately not selected: an auto-increment id is local to one copy of this
       database, while iso_code is the stable identity that actually lands on the user row. */
    const [countries] = await pool.execute(
      `SELECT
        name,
        UPPER(iso_code) AS iso_code
      FROM countries
      ORDER BY name ASC`
    )

    /* SUCCESS BRANCH */
    return NextResponse.json(
      {
        success: true,
        data: countries,
        meta: {
          count: countries.length,
          timestamp: new Date().toISOString()
        }
      },
      { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } }
    )

  } catch (error) {
    console.error('[COUNTRIES_API_ERROR]:', error.message)

    /* ERROR BRANCH: Guaranteed response to satisfy Next.js runtime */
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch country list',
        details: error.message
      },
      { status: 500 }
    )
  }
}
