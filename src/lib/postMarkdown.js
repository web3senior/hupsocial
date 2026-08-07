/**
 * Post → Markdown serialization.
 *
 * Shared by the post menu ("Copy post", "Summarize with AI") and the plain-text route at
 * `/networks/{networkId}/{postId}/markdown`. Isomorphic and dependency-free on purpose: the
 * route handler serializes on Node from a freshly fetched row, the popover serializes in the
 * browser from the post already in memory — both must produce the same document, so nothing
 * here may touch `window` or `process` outside the guarded helpers.
 */
import { resolveStorageUrl } from './storageHelper'

// Mirrors the placeholder the card itself renders for sealed community content — the markdown
// must never leak an envelope object (or its ciphertext) just because it took a different path.
const ENCRYPTED_PLACEHOLDER = '🔒 Encrypted community content — only members can view'

/**
 * Media CIDs resolve to relative proxy paths (`/api/ipfs/file`, `/api/0g/file`). Markdown is
 * always read outside the app — a clipboard paste, an assistant fetching the document — so
 * every asset link has to carry an origin to stay reachable.
 */
function absolutize(url, origin) {
  if (!url || typeof url !== 'string') return null
  if (!url.startsWith('/')) return url
  return `${String(origin || '').replace(/\/+$/, '')}${url}`
}

function getBodyText(item) {
  const content = item?.content

  if (content?.encrypted) return ENCRYPTED_PLACEHOLDER

  if (Array.isArray(content?.elements)) {
    return content.elements.find((element) => element?.type === 'text')?.data?.text || ''
  }

  return typeof content === 'string' ? content : ''
}

function getMediaItems(item) {
  const elements = item?.content?.elements
  if (!Array.isArray(elements)) return []

  const items = elements.find((element) => element?.type === 'media')?.data?.items
  return Array.isArray(items) ? items : []
}

// A markdown document outlives the session that produced it, so the stamp is absolute and
// pinned to UTC — a locale-relative "2h ago" would be wrong the moment it is pasted, and a
// server-local zone would disagree with the same post copied from the browser.
function formatPostedAt(value) {
  if (!value) return ''

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)

  return `${formatted} UTC`
}

/**
 * Canonical post URL.
 * @param {Object} item Post row.
 * @param {string} [origin] Absolute origin; omit for a relative path.
 */
export function getPostPermalink(item, origin = '') {
  const path = `/networks/${item?.network_id}/${item?.id}`
  return origin ? `${String(origin).replace(/\/+$/, '')}${path}` : path
}

/**
 * URL of the plain-text markdown rendition of a post.
 * @param {Object} item Post row.
 * @param {string} [origin] Absolute origin; omit for a relative path.
 */
export function getPostMarkdownUrl(item, origin = '') {
  return `${getPostPermalink(item, origin)}/markdown`
}

/**
 * Serialize a post to a self-contained markdown document.
 * @param {Object} item Post row as returned by the posts API (content already parsed).
 * @param {Object} [options]
 * @param {string} [options.origin] Absolute origin used for the permalink and media links.
 * @returns {string} Markdown, newline-terminated.
 */
export function postToMarkdown(item, { origin = '' } = {}) {
  if (!item) return ''

  const author = item.display_name || item.wallet_address || 'Unknown author'
  const permalink = getPostPermalink(item, origin)
  const postedAt = formatPostedAt(item.created_at)

  const meta = [`**Author:** ${author}`]
  if (item.display_name && item.wallet_address) meta.push(`**Wallet:** \`${item.wallet_address}\``)
  if (postedAt) meta.push(`**Posted:** ${postedAt}`)
  if (item.network_name) meta.push(`**Network:** ${item.network_name}`)
  if (item.community_name) meta.push(`**Community:** ${item.community_name}`)
  meta.push(`**Permalink:** ${permalink}`)
  if (item.tx_hash && item.explorer_url) meta.push(`**Onchain proof:** ${item.explorer_url}/tx/${item.tx_hash}`)
  if (item.content?.quoteOf) {
    meta.push(`**Quotes:** ${getPostPermalink({ network_id: item.network_id, id: item.content.quoteOf }, origin)}`)
  }

  // Body text is authored as markdown and rendered through `marked`, so it passes through
  // untouched — escaping it here would break every link, list and emphasis the author wrote.
  const body = getBodyText(item).trim()

  const media = getMediaItems(item)
    .map((mediaItem, index) => {
      const url = absolutize(resolveStorageUrl(mediaItem?.cid), origin)
      if (!url) return null

      const alt = (mediaItem?.alt || '').replace(/[\r\n]+/g, ' ').trim()
      if (mediaItem?.type === 'video') return `[Video ${index + 1}](${url})`
      if (mediaItem?.type === 'audio') return `[Audio ${index + 1}](${url})`
      return `![${alt || `Image ${index + 1}`}](${url})`
    })
    .filter(Boolean)

  const sections = [`# Post by ${author}`, meta.map((line) => `- ${line}`).join('\n')]

  // The rule separates metadata from content — a post with neither body nor media (a bare
  // media-less repost, a deleted body) would otherwise end on a dangling divider.
  if (body || media.length) sections.push('---')
  if (body) sections.push(body)
  if (media.length) sections.push(media.join('\n\n'))

  return `${sections.join('\n\n')}\n`
}
