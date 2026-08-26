import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { resolveIPFSImageUrl } from '@/lib/storageHelper'

function escapeAttr(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

// A cashtag must start with a letter — `$0.025` and `$25` are prices, not tickers.
// Exported so the cashtag cards detect exactly what the renderer turns blue — two regexes
// would drift, and a card for a token the text never linked reads as a bug.
export const CASHTAG_PATTERN = /(^|[^A-Za-z0-9_$])\$([A-Za-z][A-Za-z0-9]{0,9})\b/g

// Hosts that count as "inside Hup" no matter which deployment renders the post.
const HUP_HOSTS = ['hup.social']

function getSelfHost() {
  if (typeof window !== 'undefined') return window.location.host.toLowerCase()

  try {
    return new URL(process.env.NEXT_PUBLIC_BASE_URL).host.toLowerCase()
  } catch {
    return ''
  }
}

// Links that stay in the app open in the same window; only offsite links get a new tab.
function isInternalHref(href) {
  const value = String(href || '').trim()
  if (!value) return true

  // Relative paths, in-page anchors and query-only links never leave the deployment.
  if (value.startsWith('#') || value.startsWith('?')) return true
  if (value.startsWith('/') && !value.startsWith('//')) return true

  const base = typeof window !== 'undefined' ? window.location.href : process.env.NEXT_PUBLIC_BASE_URL || 'https://hup.social'

  let parsed
  try {
    parsed = new URL(value, base)
  } catch {
    return false
  }

  // mailto:, tel:, ipfs: and friends are handed to the OS — a target would do nothing useful.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true

  const selfHost = getSelfHost()
  const hosts = selfHost ? [...HUP_HOSTS, selfHost] : HUP_HOSTS
  const host = parsed.host.toLowerCase()
  const hostname = parsed.hostname.toLowerCase()

  return hosts.some((candidate) => host === candidate || hostname === candidate || hostname.endsWith(`.${candidate}`))
}

export function renderMarkdown(markdown) {
  const content = typeof markdown === 'string' ? markdown.trim() : ''

  const renderer = new marked.Renderer()

  renderer.text = (token) => {
    const rawText = typeof token === 'string' ? token : token?.text || ''

    return rawText.replace(CASHTAG_PATTERN, (match, prefix, symbol) => {
      return `${prefix}<span class="ticker-trigger" data-symbol="${symbol.toUpperCase()}">$${symbol}</span>`
    })
  }

  renderer.link = (token) => {
    const href = escapeAttr(token?.href)
    const title = token?.title ? ` title="${escapeAttr(token.title)}"` : ''
    const text = token?.text || ''
    const target = isInternalHref(token?.href) ? '' : ' rel="noopener noreferrer" target="_blank"'

    return `<a href="${href}"${title}${target}>${text}</a>`
  }

  const dirtyHtml = marked.parse(content, {
    renderer,
    gfm: true,
    breaks: true,
  })

  return DOMPurify.sanitize(dirtyHtml, {
    ADD_TAGS: ['span'],
    ADD_ATTR: ['target', 'rel', 'data-symbol', 'data-chain', 'data-address'],
  }).trim()
}
/* ─── Articles ─────────────────────────────────────────────────────────────────────────────
   renderMarkdown above leans on DOMPurify, which is a browser library: without a window its
   default export has no `sanitize` at all, so calling it during a server render throws. Article
   bodies have to render on the server — an article a crawler cannot read is the one thing a
   long-form feature cannot afford — so they take a renderer that is safe by construction rather
   than safe by post-processing.

   Three rules make it safe without a DOM, each covering a hole the others leave:
     1. Raw HTML never reaches the output — marked routes both block and inline html through
        renderer.html, so returning '' there drops `<script>` and `<img onerror=…>` alike.
     2. Text is escaped on the way out, so a `<` an author typed in prose stays prose.
     3. Every URL passes a protocol allowlist. Escaping an href stops attribute-breakout but not
        `javascript:` — marked emits that href untouched, and DOMPurify was the only thing
        catching it on the client path.                                                         */

/* Anything not on this list is dropped rather than rendered. Relative paths, fragments and
   query-only links are handled separately (they carry no protocol at all). */
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'ipfs:'])

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * A link target that is safe to put in an href, or null when it is not.
 * @param {string} href
 * @returns {string|null}
 */
function safeUrl(href) {
  const value = String(href || '').trim()
  if (!value) return null

  /* No protocol to check — these cannot execute anything */
  if (value.startsWith('#') || value.startsWith('?') || (value.startsWith('/') && !value.startsWith('//'))) {
    return value
  }

  try {
    const parsed = new URL(value, process.env.NEXT_PUBLIC_BASE_URL || 'https://hup.social')
    return SAFE_URL_PROTOCOLS.has(parsed.protocol) ? value : null
  } catch {
    return null
  }
}

/**
 * Render an article body to HTML that is safe to inject without DOMPurify.
 *
 * Used by the reader (a server component) and by the editor's preview, so what an author proofs
 * is exactly what a reader gets — a preview rendered through a more permissive path would show
 * markup the published article strips.
 *
 * @param {string} markdown
 * @returns {string} Sanitized HTML.
 */
export function renderArticleMarkdown(markdown) {
  const source = typeof markdown === 'string' ? markdown.trim() : ''
  if (!source) return ''

  const renderer = new marked.Renderer()

  /* A `text` token in a list item or heading is a CONTAINER: its own `.text` is the raw source
     ("**No feed cost.** A card…") and the formatting lives in `.tokens`. Reading `.text` on one of
     those and escaping it prints the asterisks instead of bolding the words, so containers are
     handed back to the parser and only leaf text is escaped here.
     A regular function, not an arrow: marked binds the renderer as `this` and that is where
     `parser` lives. Cashtags still resolve — the leaves come back through this same method. */
  renderer.text = function (token) {
    if (token?.tokens?.length) return this.parser.parseInline(token.tokens)

    const rawText = typeof token === 'string' ? token : token?.text || ''

    /* Escaped rather than trusted, because the cashtag pass injects real markup and everything
       around it has to be inert. */
    return escapeHtml(rawText).replace(CASHTAG_PATTERN, (match, prefix, symbol) => {
      return `${prefix}<span class="ticker-trigger" data-symbol="${symbol.toUpperCase()}">$${symbol}</span>`
    })
  }

  renderer.link = (token) => {
    const href = safeUrl(token?.href)
    const text = token?.text || ''
    /* A link that fails the allowlist keeps its words and loses its destination */
    if (!href) return text

    const title = token?.title ? ` title="${escapeAttr(token.title)}"` : ''
    const target = isInternalHref(href) ? '' : ' rel="noopener noreferrer" target="_blank"'

    return `<a href="${escapeAttr(href)}"${title}${target}>${text}</a>`
  }

  renderer.image = (token) => {
    const src = safeUrl(token?.href)
    if (!src) return ''

    /* Body images are usually the author's own ipfs:// uploads; routing them through the proxy
       gets the gateway fallback chain and a sane width instead of a raw gateway hotlink. */
    const resolved = src.startsWith('ipfs://') ? resolveIPFSImageUrl(src, { width: 1200 }) : src
    const alt = escapeAttr(token?.text || '')
    const title = token?.title ? ` title="${escapeAttr(token.title)}"` : ''

    return `<img src="${escapeAttr(resolved)}" alt="${alt}"${title} loading="lazy" />`
  }

  /* Raw HTML, block and inline alike, is dropped rather than escaped: an article that renders
     someone's markup is an article that can run their script, and no author needs it here. */
  renderer.html = () => ''

  /* breaks:false, unlike the post renderer above — in a post a single newline is a deliberate
     line break, but in an article it is just a wrapped line in the author's editor, and turning
     each one into a <br> would shred every paragraph. */
  return marked.parse(source, { renderer, gfm: true, breaks: false }).trim()
}
