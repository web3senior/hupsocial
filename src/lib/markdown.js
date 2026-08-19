import { marked } from 'marked'
import DOMPurify from 'dompurify'

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