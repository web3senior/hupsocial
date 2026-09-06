/**
 * @file api/v1/links/media/route.js
 * @description Streams a link card's video through Hup's own origin.
 *
 * X's video host answers 403 to any request that carries a Referer, and a <video> element has
 * no way to withhold one, so the card cannot point at the mp4 directly. This route fetches it
 * without a Referer and passes the bytes through, Range and all, so the player can seek and
 * the browser can pull the file in the pieces it wants. Only the hosts named in
 * MEDIA_PROXY_HOSTS may be fetched; everything else is hotlinked from the card as usual.
 */

import { MEDIA_PROXY_HOSTS } from '@/lib/linkPreview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Time to first byte from the upstream host; the stream itself runs as long as the file does
const CONNECT_TIMEOUT_MS = 15000

// Upstream serves these immutable for a week; the same holds here
const CACHE_CONTROL = 'public, max-age=604800, immutable'

const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']

function allowedUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && MEDIA_PROXY_HOSTS.has(url.hostname.toLowerCase()) ? url : null
  } catch {
    return null
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const url = allowedUrl(searchParams.get('url') || '')
  if (!url) return new Response('Unsupported media host', { status: 400 })

  const headers = { accept: 'video/*,*/*;q=0.8' }
  const range = request.headers.get('range')
  if (range) headers.range = range

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)

  let upstream
  try {
    upstream = await fetch(url, { headers, cache: 'no-store', signal: controller.signal })
  } catch (error) {
    clearTimeout(timer)
    return new Response(error?.name === 'AbortError' ? 'Media host took too long' : 'Media host could not be reached', { status: 504 })
  }
  clearTimeout(timer)

  const type = upstream.headers.get('content-type') || ''
  if (!upstream.ok || !type.startsWith('video/')) {
    await upstream.body?.cancel().catch(() => {})
    return new Response(`Media host answered ${upstream.status}`, { status: 502 })
  }

  const out = new Headers({ 'cache-control': CACHE_CONTROL, 'accept-ranges': 'bytes' })
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) out.set(name, value)
  }

  return new Response(upstream.body, { status: upstream.status, headers: out })
}
