/**
 * @file lib/linkPreview.js
 * @description Which link in a post earns a preview card, and what kind of card.
 *
 * Isomorphic on purpose: the hook reads the post text in the browser to decide which URL to ask
 * about, and the API route re-runs the same classification on the URL it is handed, so the two
 * can never disagree about what counts as an X link or a YouTube link.
 */

// Anything that starts like a URL and runs to whitespace or a quote; the tail is trimmed below
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi

// Punctuation a sentence hangs on the end of a link without the link owning it
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/

const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'])
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

// A bare file has no page to unfurl
const FILE_PATH = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|m4v|mp3|wav|ogg|pdf|zip)$/i

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

export const PREVIEW_KINDS = Object.freeze({ X: 'x', YOUTUBE: 'youtube', WEB: 'web' })

// Hosts that refuse a browser's Referer and are therefore streamed through /api/v1/links/media
export const MEDIA_PROXY_HOSTS = new Set(['video.twimg.com'])

/** The same-origin URL a card plays a video from, or the original when its host hotlinks fine. */
export function mediaProxyUrl(url) {
  try {
    return MEDIA_PROXY_HOSTS.has(new URL(url).hostname.toLowerCase()) ? `/api/v1/links/media?url=${encodeURIComponent(url)}` : url
  } catch {
    return url
  }
}

/**
 * Every http(s) URL in a body of text, in order, de-duplicated.
 * @param {string} text
 * @returns {string[]}
 */
export function linksIn(text) {
  if (typeof text !== 'string' || !text) return []
  const found = []
  for (const match of text.match(URL_PATTERN) || []) {
    const stripped = match.replace(TRAILING_PUNCTUATION, '')
    // A Wikipedia-style "Foo_(bar)" keeps its closing paren; a "(see https://…)" aside loses it
    const opens = (stripped.match(/\(/g) || []).length
    const closes = (stripped.match(/\)/g) || []).length
    const href = opens > closes && match[stripped.length] === ')' ? `${stripped})` : stripped
    if (href && !found.includes(href)) found.push(href)
  }
  return found
}

function isOwnHost(hostname) {
  if (hostname === 'hup.social' || hostname.endsWith('.hup.social') || hostname === 'localhost') return true
  return typeof window !== 'undefined' && hostname === window.location.hostname.toLowerCase()
}

function youTubeIdFrom(url) {
  const host = url.hostname.toLowerCase()
  let id = null
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0]
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else id = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ?? null
  }
  return id && YOUTUBE_ID.test(id) ? id : null
}

// "?t=90", "?t=90s" and "?t=1h2m3s" all mean the same start
function startSecondsFrom(url) {
  const raw = url.searchParams.get('t') || url.searchParams.get('start') || ''
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Number(raw)
  const parts = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/)
  if (!parts) return 0
  return Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0)
}

/**
 * The card a link maps to, or null when it earns none.
 * @param {string} href
 * @returns {{ kind: string, url: string, id?: string, start?: number } | null}
 */
export function classifyLink(href) {
  let url
  try {
    url = new URL(String(href || '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase()
  if (isOwnHost(host)) return null

  if (X_HOSTS.has(host)) {
    const status = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/)
    const bare = url.pathname.match(/^\/i\/web\/status\/(\d{1,25})/)
    const id = status?.[2] ?? bare?.[1]
    // Profiles, lists and searches sit behind a login wall for anything that is not a browser
    if (!id) return null
    return { kind: PREVIEW_KINDS.X, id, url: `https://x.com/${status?.[1] || 'i'}/status/${id}` }
  }

  if (host === 'youtu.be' || YOUTUBE_HOSTS.has(host)) {
    const id = youTubeIdFrom(url)
    if (!id) return null
    const start = startSecondsFrom(url)
    return {
      kind: PREVIEW_KINDS.YOUTUBE,
      id,
      start,
      url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}` : ''}`,
    }
  }

  if (FILE_PATH.test(url.pathname)) return null
  url.hash = ''
  return { kind: PREVIEW_KINDS.WEB, url: url.toString() }
}

/**
 * The first link in the text that earns a card.
 * @param {string} text
 */
export function previewableLink(text) {
  for (const href of linksIn(text)) {
    const link = classifyLink(href)
    if (link) return link
  }
  return null
}
