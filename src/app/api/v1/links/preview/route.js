/**
 * @file api/v1/links/preview/route.js
 * @description Everything a link card draws, for one URL. The card is close to immutable, so
 * the shared CDN cache carries a feed; the in-process cache behind resolveLinkPreview only
 * catches repeats within an instance and remembers the links that yield nothing.
 */

import { NextResponse } from 'next/server'
import { resolveLinkPreview } from '@/lib/linkPreviewServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_URL_LENGTH = 2048

const CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
// A link that yields nothing is asked again sooner: the page may simply have been slow
const EMPTY_CACHE_CONTROL = 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const url = (searchParams.get('url') || '').trim()
  if (!url || url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ success: false, error: 'url required' }, { status: 400 })
  }

  try {
    const data = await resolveLinkPreview(url)
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': data ? CACHE_CONTROL : EMPTY_CACHE_CONTROL } })
  } catch (error) {
    console.warn('[links/preview]', url, error?.message)
    return NextResponse.json({ success: false, data: null }, { headers: { 'Cache-Control': EMPTY_CACHE_CONTROL } })
  }
}
