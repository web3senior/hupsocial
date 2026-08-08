/**
 * @file networks/[networkId]/[postId]/embed/route.js
 * @description Serves the standalone document a post embed frames. Sits beside the markdown
 * route for the same reason it does: both are public, cacheable renditions of one post row.
 *
 * A route handler rather than a page — `src/app/layout.jsx` wraps every page in the app shell
 * (providers, header, wallet), none of which belongs in a 40KB card on someone else's blog.
 *
 * This is the only path in the app that answers to `frame-ancestors *` (see next.config.mjs), so
 * what it will and will not render is a security boundary: deleted and moderated posts get the
 * fallback card, and sealed community content renders the same lock placeholder the feed shows.
 */
import { getPostById } from '@/lib/api'
import { renderPostEmbedDocument, renderPostEmbedFallback, normalizeEmbedTheme } from '@/lib/postEmbed'

export const runtime = 'nodejs'

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' }

// Matches the veil the card applies (Post.jsx) — an embed must not become the way to read
// content Hup itself hides behind a warning.
function isWithheld(row) {
  return (
    Number(row?.is_deleted || 0) === 1 ||
    Number(row?.actioned_reports || 0) >= 3 ||
    Number(row?.moderation_flagged || 0) === 1
  )
}

export async function GET(request, { params }) {
  const { networkId, postId } = await params
  const { origin, searchParams } = new URL(request.url)
  const theme = normalizeEmbedTheme(searchParams.get('theme'))

  const unavailable = (message) =>
    new Response(renderPostEmbedFallback({ origin, theme, message }), { status: 404, headers: HTML_HEADERS })

  try {
    const post = await getPostById(networkId, postId, null)
    const row = post?.data

    if (!row) return unavailable('This post could not be found on Hup.')

    // A repost row carries no content of its own — embedding one shows the original, credited,
    // the way the card does.
    const isRepost = Number(row.is_repost || 0) > 0
    const target = isRepost ? (await getPostById(networkId, row.is_repost, null))?.data : row

    if (!target) return unavailable('The original post is no longer available on Hup.')
    if (isWithheld(row) || isWithheld(target)) return unavailable('This post is no longer available on Hup.')

    const document = renderPostEmbedDocument(target, {
      origin,
      theme,
      repostedBy: isRepost ? row.display_name || row.wallet_address : null,
    })

    return new Response(document, {
      headers: { ...HTML_HEADERS, 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch (error) {
    console.error('[GET_POST_EMBED_ERROR]:', error.message)
    return unavailable('This post could not be loaded from Hup.')
  }
}
