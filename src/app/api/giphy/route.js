// app/api/giphy/route.js
// Proxies Giphy search/trending so GIPHY_API_KEY never reaches the client.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const GIPHY_API_BASE = 'https://api.giphy.com/v1/gifs'
const RESULT_LIMIT = 30
const RATING = 'pg-13'

// Trim Giphy's verbose payload to what the picker needs: a light grid preview
// and the rendition worth pinning to IPFS (downsized stays under ~2MB; original
// is the fallback when Giphy has no downsized rendition)
const toPickerItem = (gif) => {
  const preview = gif.images?.fixed_width
  const full = gif.images?.downsized?.url ? gif.images.downsized : gif.images?.original
  if (!preview?.url || !full?.url) return null
  return {
    id: gif.id,
    title: gif.title || 'GIF',
    preview: {
      url: preview.webp || preview.url,
      width: Number(preview.width) || 0,
      height: Number(preview.height) || 0,
    },
    full: {
      url: full.url,
      width: Number(full.width) || 0,
      height: Number(full.height) || 0,
      size: Number(full.size) || 0,
    },
  }
}

export async function GET(request) {
  const apiKey = process.env.GIPHY_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GIPHY_API_KEY is not configured' }, { status: 500 })
  }

  const q = request.nextUrl.searchParams.get('q')?.trim() || ''
  const endpoint = q ? 'search' : 'trending'
  const params = new URLSearchParams({ api_key: apiKey, limit: String(RESULT_LIMIT), rating: RATING })
  if (q) params.set('q', q)

  try {
    const res = await fetch(`${GIPHY_API_BASE}/${endpoint}?${params}`)
    if (!res.ok) throw new Error(`Giphy ${endpoint} failed with status ${res.status}`)
    const { data } = await res.json()
    const items = (Array.isArray(data) ? data : []).map(toPickerItem).filter(Boolean)
    return NextResponse.json({ items }, { status: 200 })
  } catch (error) {
    console.error('[giphy] proxy error:', error)
    return NextResponse.json({ error: 'Unable to reach Giphy' }, { status: 502 })
  }
}
