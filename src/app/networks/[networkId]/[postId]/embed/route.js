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
import { getPostById, getPostThread, getProfile } from '@/lib/api'
import { previewableLink } from '@/lib/linkPreview'
import { resolveLinkPreview } from '@/lib/linkPreviewServer'
import { isVeiledByReports } from '@/lib/reports'
import {
  getEmbedBodyText,
  getEmbedMediaItems,
  renderPostEmbedDocument,
  renderPostEmbedFallback,
  normalizeEmbedTheme,
} from '@/lib/postEmbed'

export const runtime = 'nodejs'

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' }

// Matches the veil the card applies (Post.jsx) — an embed must not become the way to read
// content Hup itself hides behind a warning.
function isWithheld(row) {
  return (
    Number(row?.is_deleted || 0) === 1 ||
    isVeiledByReports(row?.actioned_reports) ||
    Number(row?.moderation_flagged || 0) === 1
  )
}

// The card the feed shows under the text (LinkPreview.jsx): the first link that earns one,
// skipped when the post carries its own gallery. Best-effort — a slow or dead X endpoint must
// never turn the embed into the fallback card.
async function loadLinkPreview(row) {
  if (row?.content?.encrypted || getEmbedMediaItems(row).length > 0) return null
  const link = previewableLink(getEmbedBodyText(row))
  if (!link) return null
  try {
    return await resolveLinkPreview(link.url)
  } catch (error) {
    console.warn('[GET_POST_EMBED_PREVIEW]:', link.url, error?.message)
    return null
  }
}

// The quoted original, when the row is a quote post. A missing or withheld original still
// yields an object so the document can say "unavailable" rather than drop the quote silently.
async function loadQuoted(networkId, row) {
  const quoteId = row?.content?.quoteOf
  if (!quoteId) return null
  try {
    const quoted = (await getPostById(networkId, quoteId, null))?.data
    return { item: quoted && !isWithheld(quoted) ? quoted : null }
  } catch (error) {
    console.warn('[GET_POST_EMBED_QUOTE]:', networkId, quoteId, error?.message)
    return { item: null }
  }
}

// Parts 2…N when the row is the first part of a thread, so the embed reads as the whole thread
// the way the post page draws it. A withheld part ends the thread there, as a deleted one does
// in the thread route; a failed fetch leaves the first part standing alone.
async function loadThreadParts(networkId, row) {
  const marker = row?.content?.thread
  if (Number(marker?.part) !== 1 || !(Number(marker?.of) > 1)) return []
  try {
    const parts = await getPostThread(networkId, row.id)
    const withheld = parts.findIndex(isWithheld)
    return withheld === -1 ? parts : parts.slice(0, withheld)
  } catch (error) {
    console.warn('[GET_POST_EMBED_THREAD]:', networkId, row.id, error?.message)
    return []
  }
}

// The author the way the card's Profile component shows them: the same profile API useProfile
// reads (Universal Profile first, then the users table), so the embed cannot paint a picture or
// name the app has since replaced. The row's own columns stay as the fallback when it fails.
async function withAuthorProfile(row) {
  if (!row?.wallet_address) return row
  try {
    const profile = (await getProfile(row.wallet_address))?.data
    if (!profile) return row
    return {
      ...row,
      display_name: profile.name || row.display_name,
      profile_image: profile.profileImage || row.profile_image,
    }
  } catch (error) {
    console.warn('[GET_POST_EMBED_PROFILE]:', row.wallet_address, error?.message)
    return row
  }
}

export async function GET(request, { params }) {
  const { networkId, postId } = await params
  const { searchParams } = new URL(request.url)
  // Left empty so links and assets stay relative to the framed document's own public URL.
  // request.url is the address the app server was reached on, which behind the production
  // proxy is its internal one (https://localhost:3000) — absolute URLs built from it broke
  // every image for readers.
  const origin = ''
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

    const [linkPreview, quoted, author, threadParts] = await Promise.all([
      loadLinkPreview(target),
      loadQuoted(networkId, target),
      withAuthorProfile(target),
      loadThreadParts(networkId, target),
    ])
    if (quoted?.item) quoted.item = await withAuthorProfile(quoted.item)

    const document = renderPostEmbedDocument(author, {
      origin,
      theme,
      repostedBy: isRepost ? row.display_name || row.wallet_address : null,
      linkPreview,
      quoted,
      // Every part is the author's own, so each carries the profile the first part resolved
      threadParts: threadParts.map((part) => ({ ...part, display_name: author.display_name, profile_image: author.profile_image })),
    })

    return new Response(document, {
      headers: { ...HTML_HEADERS, 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch (error) {
    console.error('[GET_POST_EMBED_ERROR]:', error.message)
    return unavailable('This post could not be loaded from Hup.')
  }
}
