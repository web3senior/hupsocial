/**
 * @file networks/[networkId]/[postId]/markdown/route.js
 * @description Serves a post as a self-contained markdown document. Sits beside the post page
 * so the "View as markdown" entry and the assistant deep links can point at a stable, public
 * plain-text rendition of the same content the card shows.
 */
import { getPostById } from '@/lib/api'
import { postToMarkdown } from '@/lib/postMarkdown'

export const runtime = 'nodejs'

// text/plain, not text/markdown: browsers download an unknown markdown type instead of
// showing it, and "View as markdown" has to render in the tab it opens.
const TEXT_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'inline' }

const PUBLIC_ORIGIN = 'https://hup.social'
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i

// The address readers reached us on, not the one the app server was reached on. Behind the
// production proxy request.url is the internal https://localhost:3000, and unlike the embed
// route this document is read outside the app, so its links cannot fall back to relative.
function getPublicOrigin(request) {
  const headers = request.headers
  const firstValue = (name) => headers.get(name)?.split(',')[0].trim() || ''
  const requestUrl = new URL(request.url)

  const host = firstValue('x-forwarded-host') || firstValue('host') || requestUrl.host
  const proto = firstValue('x-forwarded-proto') || requestUrl.protocol.replace(/:$/, '')

  if (LOOPBACK_HOST.test(host) && process.env.NODE_ENV === 'production') return PUBLIC_ORIGIN
  return `${proto}://${host}`
}

export async function GET(request, { params }) {
  const { networkId, postId } = await params
  const origin = getPublicOrigin(request)

  try {
    const post = await getPostById(networkId, postId, null)
    const item = post?.data

    if (!item) {
      return new Response('Post not found\n', { status: 404, headers: TEXT_HEADERS })
    }

    return new Response(postToMarkdown(item, { origin }), {
      headers: { ...TEXT_HEADERS, 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch (error) {
    console.error('[GET_POST_MARKDOWN_ERROR]:', error.message)
    return new Response('Post not found\n', { status: 404, headers: TEXT_HEADERS })
  }
}
