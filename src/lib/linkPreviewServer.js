/**
 * @file lib/linkPreviewServer.js
 * @description Turns a link into the data its preview card draws. Node only; the browser asks
 * /api/v1/links/preview instead.
 *
 * Three sources, one per kind of link:
 *   - X posts come from the syndication endpoint the official embed widget reads, the same one
 *     react-tweet ships on, with fxtwitter as the fallback. Both are public and need no key;
 *     X's own page is a login wall for anything that is not a browser.
 *   - YouTube comes from oEmbed for the title and channel, and from the thumbnail host for the
 *     poster, which is all a player needs before someone presses play.
 *   - Everything else is an Open Graph read of the page itself: a bounded fetch, redirects
 *     followed by hand so every hop is re-checked against the same public-host rule the NFT
 *     artwork proxy applies, and only the head of the document parsed.
 *
 * Answers are kept in the process for an hour. A link's card is close to immutable, so the
 * shared CDN cache the route sets is what carries a feed; this layer catches repeats within an
 * instance and remembers the links that yield nothing, so a page of them is not re-fetched on
 * every render.
 */

import { PREVIEW_KINDS, classifyLink, mediaProxyUrl } from './linkPreview'

const FETCH_TIMEOUT_MS = 8000
const THUMBNAIL_TIMEOUT_MS = 3000
const MAX_HTML_BYTES = 512 * 1024
const MAX_REDIRECTS = 3
const MAX_TWEET_MEDIA = 4
// A feed card does not need the 1280p rendition; X itself streams adaptively
const MAX_VIDEO_BITRATE = 1_500_000

const USER_AGENT = 'Mozilla/5.0 (compatible; Hupbot/1.0; +https://hup.social)'

const CACHE_TTL_MS = 60 * 60 * 1000
const EMPTY_TTL_MS = 10 * 60 * 1000
// A host that timed out may simply have been slow; ask again sooner than for a page with nothing
const ERROR_TTL_MS = 2 * 60 * 1000
const MAX_CACHE_ENTRIES = 500

const cache = new Map()
const inflight = new Map()

/**
 * Only public web hosts may be fetched: the URL is whatever a post's author typed, so loopback,
 * link-local and private ranges stay unreachable from here.
 */
export function isPublicHttpUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false
  }
  return true
}

function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  return fetch(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': USER_AGENT, ...(init.headers || {}) },
  })
}

const discard = (response) => response?.body?.cancel().catch(() => {})

// ─── Text helpers ────────────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase()
    try {
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
      if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)))
    } catch {
      return match
    }
    return NAMED_ENTITIES[lower] ?? match
  })
}

function absoluteUrl(value, base) {
  if (!value) return null
  try {
    const url = new URL(value, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

// ─── X ───────────────────────────────────────────────────────────────────────────────────────

// The syndication endpoint's anti-abuse token, derived from the id the way the embed widget does
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
}

function tweetText(tweet) {
  let text = String(tweet.text || '')
  const [from, to] = Array.isArray(tweet.display_text_range) ? tweet.display_text_range : []
  // The range trims the trailing t.co that stands in for the attached picture or video
  if (Number.isInteger(from) && Number.isInteger(to)) text = Array.from(text).slice(from, to).join('')
  for (const entry of tweet.entities?.urls || []) {
    if (entry?.url && entry.expanded_url) text = text.replaceAll(entry.url, entry.expanded_url)
  }
  return decodeEntities(text).trim()
}

function pickMp4(variants) {
  const mp4s = (variants || [])
    .filter((variant) => variant?.content_type === 'video/mp4' && variant.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  return mp4s.find((variant) => (variant.bitrate || 0) <= MAX_VIDEO_BITRATE) || mp4s[mp4s.length - 1] || null
}

function tweetMedia(tweet) {
  const media = []
  for (const item of Array.isArray(tweet.mediaDetails) ? tweet.mediaDetails : []) {
    if (item.type === 'photo' && item.media_url_https) {
      const size = item.original_info || {}
      media.push({ type: 'photo', url: item.media_url_https, width: size.width || 4, height: size.height || 3, alt: item.ext_alt_text || '' })
    } else if ((item.type === 'video' || item.type === 'animated_gif') && item.video_info) {
      const source = pickMp4(item.video_info.variants)
      if (!source) continue
      const [width, height] = Array.isArray(item.video_info.aspect_ratio) ? item.video_info.aspect_ratio : [16, 9]
      media.push({
        type: item.type === 'animated_gif' ? 'gif' : 'video',
        url: mediaProxyUrl(source.url),
        poster: item.media_url_https || null,
        width,
        height,
        durationMs: item.video_info.duration_millis ?? null,
      })
    }
  }
  if (media.length === 0) {
    for (const photo of Array.isArray(tweet.photos) ? tweet.photos : []) {
      if (photo?.url) media.push({ type: 'photo', url: photo.url, width: photo.width || 4, height: photo.height || 3, alt: photo.accessibilityLabel || '' })
    }
  }
  return media.slice(0, MAX_TWEET_MEDIA)
}

async function resolveTweetViaSyndication({ id }) {
  const params = new URLSearchParams({ id, lang: 'en', token: syndicationToken(id) })
  const response = await fetchWithTimeout(`https://cdn.syndication.twimg.com/tweet-result?${params}`, { headers: { accept: 'application/json' } })
  // A deleted or protected post: nothing to show and nothing to retry
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Syndication answered ${response.status}`)
  const raw = await response.text()
  if (!raw.trim()) return null
  const tweet = JSON.parse(raw)
  if (!tweet?.id_str || tweet.__typename === 'TweetTombstone') return null

  const user = tweet.user || {}
  return {
    kind: PREVIEW_KINDS.X,
    url: `https://x.com/${user.screen_name || 'i'}/status/${tweet.id_str}`,
    author: {
      name: user.name || user.screen_name || 'X',
      handle: user.screen_name || '',
      avatar: user.profile_image_url_https ? user.profile_image_url_https.replace('_normal', '_bigger') : null,
      verified: Boolean(user.is_blue_verified || user.verified),
    },
    text: tweetText(tweet),
    createdAt: tweet.created_at || null,
    sensitive: Boolean(tweet.possibly_sensitive),
    media: tweetMedia(tweet),
    stats: { likes: tweet.favorite_count ?? null, replies: tweet.conversation_count ?? null },
  }
}

async function resolveTweetViaFx({ id }) {
  const response = await fetchWithTimeout(`https://api.fxtwitter.com/status/${id}`, { headers: { accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`fxtwitter answered ${response.status}`)
  const tweet = (await response.json())?.tweet
  if (!tweet?.id) return null

  const media = [
    ...(tweet.media?.photos || []).map((photo) => ({ type: 'photo', url: photo.url, width: photo.width || 4, height: photo.height || 3, alt: photo.altText || '' })),
    ...(tweet.media?.videos || []).map((video) => ({
      type: video.type === 'gif' ? 'gif' : 'video',
      url: mediaProxyUrl(video.url),
      poster: video.thumbnail_url || null,
      width: video.width || 16,
      height: video.height || 9,
      durationMs: video.duration ? Math.round(video.duration * 1000) : null,
    })),
  ].slice(0, MAX_TWEET_MEDIA)

  return {
    kind: PREVIEW_KINDS.X,
    url: tweet.url || `https://x.com/i/status/${id}`,
    author: {
      name: tweet.author?.name || 'X',
      handle: tweet.author?.screen_name || '',
      avatar: tweet.author?.avatar_url || null,
      verified: Boolean(tweet.author?.verification?.verified),
    },
    text: decodeEntities(tweet.text || ''),
    createdAt: tweet.created_timestamp ? new Date(tweet.created_timestamp * 1000).toISOString() : null,
    sensitive: Boolean(tweet.possibly_sensitive),
    media,
    stats: { likes: tweet.likes ?? null, replies: tweet.replies ?? null },
  }
}

async function resolveTweet(link) {
  try {
    return await resolveTweetViaSyndication(link)
  } catch (error) {
    console.warn('[linkPreview] syndication failed, trying fxtwitter:', error?.message)
    return resolveTweetViaFx(link)
  }
}

// ─── YouTube ─────────────────────────────────────────────────────────────────────────────────

async function resolveYouTube({ id, start, url }) {
  const params = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${id}`, format: 'json' })
  const response = await fetchWithTimeout(`https://www.youtube.com/oembed?${params}`, { headers: { accept: 'application/json' } })
  // 401 is a private video and 404 a missing one: no player to offer either way
  if (response.status === 401 || response.status === 403 || response.status === 404) return null
  if (!response.ok) throw new Error(`YouTube oEmbed answered ${response.status}`)
  const oembed = await response.json()

  // Only uploads with an HD frame carry a maxres poster; the HEAD costs less than a broken image
  const maxres = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
  const hasMaxres = await fetchWithTimeout(maxres, { method: 'HEAD' }, THUMBNAIL_TIMEOUT_MS)
    .then((probe) => probe.ok)
    .catch(() => false)

  const embed = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1' })
  if (start) embed.set('start', String(start))

  return {
    kind: PREVIEW_KINDS.YOUTUBE,
    id,
    url,
    start,
    title: oembed.title || 'YouTube video',
    author: oembed.author_name || '',
    authorUrl: oembed.author_url || null,
    thumbnail: hasMaxres ? maxres : oembed.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    // youtube.com rather than the nocookie host: nothing loads until the reader presses play, and
    // a signed-in browser's cookies are what get past YouTube's "confirm you're not a bot" wall
    embedUrl: `https://www.youtube.com/embed/${id}?${embed}`,
  }
}

// ─── Open Graph ──────────────────────────────────────────────────────────────────────────────

async function fetchFollowingRedirects(startUrl) {
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpUrl(current)) throw Object.assign(new Error('Host is not reachable from here'), { status: 422 })
    const response = await fetchWithTimeout(current, {
      redirect: 'manual',
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en' },
    })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await discard(response)
      current = new URL(location, current).toString()
      continue
    }
    return { response, finalUrl: current }
  }
  throw new Error('Too many redirects')
}

async function readHead(response) {
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks = []
  let total = 0
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  reader.cancel().catch(() => {})
  return Buffer.concat(chunks)
}

function decodeHtml(buffer, contentType) {
  const utf8 = buffer.toString('utf8')
  const fromHeader = contentType.match(/charset=["']?([\w-]+)/i)?.[1]
  const fromMeta = utf8.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
  const charset = (fromHeader || fromMeta || 'utf-8').toLowerCase()
  if (charset === 'utf-8' || charset === 'utf8') return utf8
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return utf8
  }
}

const ATTRIBUTE_PATTERN = /([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g

function attributesOf(tag) {
  const attributes = {}
  for (const match of tag.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function parseDocument(html) {
  // Only the head matters, and meta tags found in a body are noise anyway
  const bodyAt = html.search(/<body[\s>]/i)
  const head = bodyAt === -1 ? html : html.slice(0, bodyAt)

  const meta = new Map()
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributesOf(tag)
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase()
    if (key && attrs.content && !meta.has(key)) meta.set(key, attrs.content.trim())
  }

  let icon = null
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributesOf(tag)
    const rel = (attrs.rel || '').toLowerCase().split(/\s+/)
    if (!attrs.href) continue
    if (rel.includes('icon')) {
      icon = attrs.href
      break
    }
    if (rel.includes('apple-touch-icon') && !icon) icon = attrs.href
  }

  const title = decodeEntities(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s+/g, ' ')
    .trim()

  return { meta, icon, title }
}

async function resolveWebPage({ url }) {
  const { response, finalUrl } = await fetchFollowingRedirects(url)
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    await discard(response)
    return null
  }

  const html = decodeHtml(await readHead(response), contentType)
  const { meta, icon, title: documentTitle } = parseDocument(html)
  const pick = (...keys) => keys.map((key) => meta.get(key)).find(Boolean) || ''

  const title = pick('og:title', 'twitter:title') || documentTitle
  // A page with no title has nothing a card could say
  if (!title) return null

  const image = absoluteUrl(pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'), finalUrl)
  const imageWidth = Number(meta.get('og:image:width')) || null
  const imageHeight = Number(meta.get('og:image:height')) || null

  const videoUrl = absoluteUrl(pick('og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream'), finalUrl)
  const videoType = pick('og:video:type', 'twitter:player:stream:content_type')
  const video =
    videoUrl && /^video\/(mp4|webm)$/i.test(videoType)
      ? { type: 'video', url: videoUrl, poster: image, width: Number(meta.get('og:video:width')) || 16, height: Number(meta.get('og:video:height')) || 9 }
      : null

  const site = new URL(finalUrl)
  return {
    kind: PREVIEW_KINDS.WEB,
    url: finalUrl,
    title: title.slice(0, 200),
    description: pick('og:description', 'twitter:description', 'description').slice(0, 300),
    siteName: pick('og:site_name') || site.hostname.replace(/^www\./, ''),
    favicon: absoluteUrl(icon, finalUrl) || `${site.origin}/favicon.ico`,
    image,
    imageWidth,
    imageHeight,
    video,
    // The page's own hint first; otherwise a wide image reads as a hero and a small one as a thumbnail
    large: pick('twitter:card') === 'summary_large_image' || (imageWidth ? imageWidth >= 600 : Boolean(image)),
  }
}

// ─── Entry ───────────────────────────────────────────────────────────────────────────────────

function readCache(key) {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expires <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

function writeCache(key, value, ttlMs = value ? CACHE_TTL_MS : EMPTY_TTL_MS) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  cache.set(key, { value, expires: Date.now() + ttlMs })
}

function resolve(link) {
  if (link.kind === PREVIEW_KINDS.X) return resolveTweet(link)
  if (link.kind === PREVIEW_KINDS.YOUTUBE) return resolveYouTube(link)
  return resolveWebPage(link)
}

/**
 * The preview for a link, or null when it earns none. Throws when the source could not be
 * reached, so the route can tell "nothing there" from "could not look".
 * @param {string} href
 */
export async function resolveLinkPreview(href) {
  const link = classifyLink(href)
  if (!link) return null

  const key = link.kind === PREVIEW_KINDS.WEB ? link.url : `${link.kind}:${link.id}:${link.start || 0}`
  const cached = readCache(key)
  if (cached !== undefined) return cached
  if (inflight.has(key)) return inflight.get(key)

  const pending = resolve(link)
    .then((value) => {
      writeCache(key, value)
      return value
    })
    .catch((error) => {
      writeCache(key, null, ERROR_TTL_MS)
      throw error
    })
    .finally(() => inflight.delete(key))

  inflight.set(key, pending)
  return pending
}
