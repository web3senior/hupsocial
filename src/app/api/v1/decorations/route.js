/**
 * @file api/v1/decorations/route.js
 * @description The admin's settings for the decoration catalog — price, profile-only, in shop —
 * for every surface that draws or sells decorations (hooks/useDecorationCatalog.js). Public and the
 * same for everyone, so the CDN holds it briefly; the artwork and names stay in the bundle.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { readDecorationSettings } from '@/lib/decorationCatalog'

export const runtime = 'nodejs'

const PUBLIC_CACHE_CONTROL = 'public, max-age=0, s-maxage=30, stale-while-revalidate=300'

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: { settings: await readDecorationSettings(pool) } }, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } })
  } catch (error) {
    console.error('[DECORATION_CATALOG_READ_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Could not load decorations' }, { status: 500 })
  }
}
