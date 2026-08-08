/**
 * Post → embeddable HTML.
 *
 * Two consumers share these builders: the post menu, which composes the snippet a user pastes
 * into their own page (browser, from the post already in memory), and the embed route at
 * `/networks/{networkId}/{postId}/embed`, which renders the document that snippet frames (Node,
 * from a freshly fetched row). Isomorphic and dependency-light for the same reason
 * postMarkdown.js is — nothing here may touch `window` or `process`.
 *
 * The document is deliberately inert: inline styles, no app shell, no wallet, no auth, and
 * nothing clickable but its own outbound links. That is what makes this one path safe to hand
 * `frame-ancestors *` in next.config.mjs, where the rest of the app refuses to be framed.
 */
import { resolveStorageUrl, resolveStorageImageUrl } from './storageHelper'
import { getPostPermalink } from './postMarkdown'

// Mirrors the placeholder the card and the markdown route render for sealed community content —
// an embed pasted on a third-party page must never leak an envelope object or its ciphertext.
const ENCRYPTED_PLACEHOLDER = '🔒 Encrypted community content — only members can view'
const FALLBACK_AVATAR = '/default-pfp.svg'

// Beyond four the frame stops being a preview and starts being a gallery; the "view on Hup"
// link is right there for the rest.
const MEDIA_LIMIT = 4

export const EMBED_THEMES = ['auto', 'light', 'dark']
export const EMBED_LOADER_PATH = '/embed.js'

/** Escapes for both text nodes and quoted attribute values. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function trimOrigin(origin) {
  return String(origin || '').replace(/\/+$/, '')
}

/**
 * Media CIDs resolve to relative proxy paths (`/api/ipfs/file`, `/api/0g/file`). An embed is
 * always read from another origin, so every asset URL has to carry one.
 */
function absolutize(url, origin) {
  if (!url || typeof url !== 'string') return null
  if (!url.startsWith('/')) return url
  return `${trimOrigin(origin)}${url}`
}

/** Unknown values fall back to `auto` rather than reaching a query string or a data attribute. */
export function normalizeEmbedTheme(theme) {
  const value = String(theme || '').toLowerCase()
  return EMBED_THEMES.includes(value) ? value : 'auto'
}

function getAuthorName(item) {
  if (item?.display_name) return item.display_name
  const wallet = item?.wallet_address
  return wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Unknown author'
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
  if (item?.content?.encrypted) return []

  const elements = item?.content?.elements
  if (!Array.isArray(elements)) return []

  const items = elements.find((element) => element?.type === 'media')?.data?.items
  return Array.isArray(items) ? items : []
}

// An embed outlives the session that produced it — it sits on someone else's page for years —
// so the stamp is absolute and pinned to UTC. A relative "2h ago" would be a lie by morning.
function formatEmbedDate(value) {
  if (!value) return { label: '', iso: '' }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return { label: '', iso: '' }

  return {
    label: new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date),
    iso: date.toISOString(),
  }
}

function formatCount(value) {
  const count = Number(value || 0)
  if (!Number.isFinite(count) || count <= 0) return '0'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(count)
}

/**
 * Body text renders as escaped plain text, never as parsed markdown: `renderMarkdown` sanitizes
 * through DOMPurify, which silently passes input straight through when there is no DOM — and
 * this document is built on the server. Escape-then-linkify has no such failure mode.
 */
function renderBody(text) {
  const escaped = escapeHtml(text)

  const linked = escaped.replace(/https?:\/\/[^\s<]+/g, (match) => {
    // Trailing punctuation belongs to the sentence, not to the URL.
    const trimmed = match.replace(/[.,;:!?)\]]+$/, '')
    const tail = match.slice(trimmed.length)
    return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer nofollow">${trimmed}</a>${tail}`
  })

  return linked.replace(/\r?\n/g, '<br />')
}

function renderMedia(item, origin) {
  const items = getMediaItems(item)
  if (!items.length) return ''

  const tiles = items
    .slice(0, MEDIA_LIMIT)
    .map((mediaItem, index) => {
      const alt = escapeHtml((mediaItem?.alt || '').replace(/[\r\n]+/g, ' ').trim() || `Attachment ${index + 1}`)

      // Video and audio keep native gateway streaming; only images go through the resize proxy.
      if (mediaItem?.type === 'video' || mediaItem?.type === 'audio') {
        const src = absolutize(resolveStorageUrl(mediaItem?.cid), origin)
        if (!src) return null
        const tag = mediaItem.type === 'video' ? 'video' : 'audio'
        return `<${tag} class="hup-embed__media-item" src="${escapeHtml(src)}" controls preload="metadata"></${tag}>`
      }

      const src = absolutize(resolveStorageImageUrl(mediaItem?.cid, { width: 1000 }), origin)
      if (!src) return null
      return `<img class="hup-embed__media-item" src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />`
    })
    .filter(Boolean)

  if (!tiles.length) return ''

  const remaining = items.length - tiles.length
  const more = remaining > 0 ? `<p class="hup-embed__more">+${remaining} more on Hup</p>` : ''

  return `<div class="hup-embed__media" data-count="${tiles.length}">${tiles.join('')}</div>${more}`
}

/** Canonical URL of a post's embed document. */
export function getPostEmbedUrl(item, origin = '', { theme = 'auto' } = {}) {
  const url = `${getPostPermalink(item, origin)}/embed`
  const normalized = normalizeEmbedTheme(theme)
  return normalized === 'auto' ? url : `${url}?theme=${normalized}`
}

/** URL of the loader script the snippet pulls in. */
export function getEmbedLoaderUrl(origin = '') {
  return `${trimOrigin(origin)}${EMBED_LOADER_PATH}`
}

/** Human title for the frame and for the snippet's no-JS fallback link. */
export function getPostEmbedTitle(item) {
  return `Post by ${getAuthorName(item)} on Hup`
}

/**
 * The snippet a user pastes into their own page. Shaped like every other social embed for a
 * reason: the blockquote is a working permalink on its own, so a page with the script blocked,
 * an RSS reader, or a plain-text mail client still shows a link to the post rather than nothing.
 * @param {Object} item Post row.
 * @param {Object} [options]
 * @param {string} [options.origin] Absolute origin of this deployment.
 * @param {'auto'|'light'|'dark'} [options.theme] Colour scheme the host page wants.
 */
export function buildPostEmbedSnippet(item, { origin = '', theme = 'auto' } = {}) {
  const attrs = [
    'class="hup-post"',
    `data-hup-network="${escapeHtml(item?.network_id)}"`,
    `data-hup-post="${escapeHtml(item?.id)}"`,
    `data-hup-theme="${escapeHtml(normalizeEmbedTheme(theme))}"`,
  ].join(' ')

  return [
    `<blockquote ${attrs}>`,
    `  <a href="${escapeHtml(getPostPermalink(item, origin))}">${escapeHtml(getPostEmbedTitle(item))}</a>`,
    '</blockquote>',
    `<script async src="${escapeHtml(getEmbedLoaderUrl(origin))}" charset="utf-8"></script>`,
  ].join('\n')
}

// Light and dark mirror src/app/Globals.scss so an embed reads as Hup wherever it lands. `auto`
// resolves against the *host's* OS preference — prefers-color-scheme is not inherited from the
// framing page, which is the closest a cross-origin frame can get to matching its surroundings.
const THEME_TOKENS = {
  light: {
    'color-scheme': 'light',
    '--hup-bg': '#ffffff',
    '--hup-surface': '#f7f7f8',
    '--hup-text': '#171717',
    '--hup-muted': '#666666',
    '--hup-border': '#e5e7eb',
    '--hup-link': '#1a8cd8',
  },
  dark: {
    'color-scheme': 'dark',
    '--hup-bg': '#0a0a0a',
    '--hup-surface': '#181a1f',
    '--hup-text': '#ededed',
    '--hup-muted': '#a1a1aa',
    '--hup-border': '#2a2d34',
    '--hup-link': '#1d9bf0',
  },
}

function themeBlock(theme) {
  const declare = (tokens) =>
    Object.entries(tokens)
      .map(([key, value]) => `${key}:${value};`)
      .join('')

  if (theme === 'dark') return `:root{${declare(THEME_TOKENS.dark)}}`
  if (theme === 'light') return `:root{${declare(THEME_TOKENS.light)}}`

  return [
    `:root{${declare(THEME_TOKENS.light)}}`,
    `@media (prefers-color-scheme: dark){:root{${declare(THEME_TOKENS.dark)}}}`,
  ].join('')
}

const DOCUMENT_STYLES = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:var(--hup-text);-webkit-font-smoothing:antialiased}
a{color:var(--hup-link);text-decoration:none}
a:hover{text-decoration:underline}
.hup-embed{display:flex;flex-direction:column;gap:.75rem;padding:1rem;border:1px solid var(--hup-border);border-radius:16px;background:var(--hup-bg)}
.hup-embed__repost{display:block;margin:0;font-size:.8125rem;color:var(--hup-muted)}
.hup-embed__header{display:flex;align-items:center;gap:.625rem}
.hup-embed__avatar{width:40px;height:40px;border-radius:999px;object-fit:cover;background:var(--hup-surface);flex-shrink:0}
.hup-embed__identity{display:flex;flex-direction:column;min-width:0}
.hup-embed__name{font-weight:600;font-size:.9375rem;color:var(--hup-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hup-embed__meta{font-size:.8125rem;color:var(--hup-muted)}
.hup-embed__body{margin:0;font-size:.9375rem;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere;white-space:normal}
.hup-embed__media{display:grid;gap:.375rem;grid-template-columns:1fr}
.hup-embed__media[data-count="2"],.hup-embed__media[data-count="3"],.hup-embed__media[data-count="4"]{grid-template-columns:1fr 1fr}
.hup-embed__media-item{display:block;width:100%;max-height:420px;object-fit:cover;border:1px solid var(--hup-border);border-radius:12px;background:var(--hup-surface)}
.hup-embed__media[data-count="1"] .hup-embed__media-item{max-height:520px;object-fit:contain}
.hup-embed__more,.hup-embed__note{margin:0;font-size:.8125rem;color:var(--hup-muted)}
.hup-embed__footer{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding-top:.75rem;border-top:1px solid var(--hup-border)}
.hup-embed__stats{display:flex;gap:.875rem;margin:0;padding:0;list-style:none;font-size:.8125rem;color:var(--hup-muted)}
.hup-embed__stats strong{color:var(--hup-text);font-weight:600}
.hup-embed__cta{font-size:.8125rem;font-weight:600;white-space:nowrap}
.hup-embed--fallback{align-items:flex-start;gap:.5rem}
@media (max-width:360px){.hup-embed__media{grid-template-columns:1fr!important}}
`.trim()

// Reports its own height to the loader, which cannot measure across origins. ResizeObserver
// covers the cases a load handler misses: images arriving late, a font swap, a rotated phone.
const RESIZE_SCRIPT = `
(function(){
  var last=0;
  function send(){
    var height=Math.ceil(document.documentElement.getBoundingClientRect().height);
    if(!height||height===last)return;
    last=height;
    parent.postMessage({type:'hup:embed:size',height:height},'*');
  }
  if(window.ResizeObserver)new ResizeObserver(send).observe(document.documentElement);
  window.addEventListener('load',send);
  window.addEventListener('resize',send);
  send();
})();
`.trim()

function documentShell({ title, theme, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<style>${themeBlock(theme)}${DOCUMENT_STYLES}</style>
</head>
<body>
${body}
<script>${RESIZE_SCRIPT}</script>
</body>
</html>
`
}

/**
 * The document the snippet frames.
 * @param {Object} item Post row as returned by the posts API (content already parsed).
 * @param {Object} [options]
 * @param {string} [options.origin] Absolute origin used for links and assets.
 * @param {'auto'|'light'|'dark'} [options.theme] Resolved colour scheme.
 * @param {string} [options.repostedBy] Display name or wallet of the reposter, when the embedded
 *   row was a repost and this document renders the original it points at.
 * @returns {string} A complete HTML document.
 */
export function renderPostEmbedDocument(item, { origin = '', theme = 'auto', repostedBy = null } = {}) {
  const resolvedTheme = normalizeEmbedTheme(theme)
  const permalink = getPostPermalink(item, origin)
  const author = getAuthorName(item)
  const posted = formatEmbedDate(item?.created_at)
  const avatar = absolutize(resolveStorageImageUrl(item?.profile_image, { width: 96 }), origin) || `${trimOrigin(origin)}${FALLBACK_AVATAR}`

  const body = getBodyText(item).trim()
  const media = renderMedia(item, origin)

  const metaParts = []
  if (posted.label) metaParts.push(`<time datetime="${escapeHtml(posted.iso)}">${escapeHtml(posted.label)}</time>`)
  if (item?.community_name) metaParts.push(escapeHtml(item.community_name))
  else if (item?.network_name) metaParts.push(escapeHtml(item.network_name))

  const stats = [
    { label: 'likes', value: item?.total_likes },
    { label: 'comments', value: item?.total_comments },
    { label: 'reposts', value: item?.total_reposts },
  ]
    .map(({ label, value }) => `<li><strong>${escapeHtml(formatCount(value))}</strong> ${label}</li>`)
    .join('')

  const article = [
    repostedBy ? `<small class="hup-embed__repost">Reposted by ${escapeHtml(repostedBy)}</small>` : '',
    '<header class="hup-embed__header">',
    `<img class="hup-embed__avatar" src="${escapeHtml(avatar)}" alt="" width="40" height="40" loading="lazy" />`,
    '<span class="hup-embed__identity">',
    `<span class="hup-embed__name">${escapeHtml(author)}</span>`,
    metaParts.length ? `<span class="hup-embed__meta">${metaParts.join(' · ')}</span>` : '',
    '</span>',
    '</header>',
    body ? `<p class="hup-embed__body">${renderBody(body)}</p>` : '',
    media,
    '<footer class="hup-embed__footer">',
    `<ul class="hup-embed__stats">${stats}</ul>`,
    `<a class="hup-embed__cta" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">View on Hup ↗</a>`,
    '</footer>',
  ]
    .filter(Boolean)
    .join('\n')

  return documentShell({
    title: getPostEmbedTitle(item),
    theme: resolvedTheme,
    body: `<article class="hup-embed">\n${article}\n</article>`,
  })
}

/**
 * Stand-in document for a post that cannot be shown — deleted, moderated, or never existed.
 * Embeds outlive the content they point at, so this is a normal state, not an error page: the
 * frame keeps its shape and says plainly that the post is gone.
 */
export function renderPostEmbedFallback({ origin = '', theme = 'auto', message = 'This post is no longer available on Hup.' } = {}) {
  const home = trimOrigin(origin) || 'https://hup.social'

  return documentShell({
    title: 'Post unavailable on Hup',
    theme: normalizeEmbedTheme(theme),
    body: [
      '<article class="hup-embed hup-embed--fallback">',
      `<p class="hup-embed__note">${escapeHtml(message)}</p>`,
      `<a class="hup-embed__cta" href="${escapeHtml(home)}" target="_blank" rel="noopener noreferrer">Open Hup ↗</a>`,
      '</article>',
    ].join('\n'),
  })
}
