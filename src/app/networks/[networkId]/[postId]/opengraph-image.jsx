/**
 * @file networks/[networkId]/[postId]/opengraph-image.jsx
 * @description Renders the link-preview card for a single post.
 *
 * Why a generated card instead of pointing og:image at the post's own photo: the previous tag
 * was /api/ipfs/file with FOUR query parameters, and Next escapes those ampersands to &amp; in
 * the attribute. A crawler that hands the URL back without decoding entities turns every
 * parameter after `cid` into `amp;w`, `amp;q`, `amp;fmt` — so the proxy never saw fmt=jpeg and
 * fell through to its WebP default, the one format X drops rather than render, behind a 200 so
 * nothing anywhere looked broken. The profile card is the control: /api/og?wallet=… renders on
 * X today, and it is the one image URL on the site with no ampersand in it.
 *
 * This route's URL carries a single cache-busting parameter Next appends itself
 * (…/opengraph-image?9865e547ac3922d6) and nothing else, so there is no ampersand to escape and
 * no parameter whose loss changes the output format.
 *
 * It also gives the posts that carry no media a card of their own. Two thirds of the feed is
 * text or an NFT listing, and every one of those shared the site logo — which made a shared
 * post look exactly like a shared home page.
 */

import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import pool from '@/lib/db'
import { getPostById } from '@/lib/api'
import { getNftMetadata } from '@/lib/nftMetadataCache'
import { truncate, summarizePostContent } from '@/lib/postSummary'
import { resolveStorageUrl } from '@/lib/storageHelper'

export const runtime = 'nodejs'

/* 1.91:1 — the ratio X, Facebook and LinkedIn all crop a large card to */
export const size = { width: 1200, height: 630 }

export const contentType = 'image/png'

/* `alt` is a static export, so it cannot describe the individual post; the title and
   description tags carry that. This only has to say what the picture is. */
export const alt = 'A post on Hup'

/* The card is a pure function of the post, but counts drift and posts can be edited or
   deleted, so it is a shared-cache TTL rather than the immutable the CID proxy uses. The
   s-maxage is the part that matters: without it every crawler that scraped a link paid the
   full gateway fetch plus a satori render again. */
const CACHE_CONTROL = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'

/* A gateway that never answers must not hold the card open, but the bar has to clear what the
   healthy gateway actually costs: api.universalprofile.cloud answers a cold CID in 3.3-3.6s,
   so a 4s budget dropped artwork at random. The avatar and the artwork are fetched in parallel,
   so this is the wait for both, and only the first crawler pays it — s-maxage serves the rest
   from the CDN. */
const FETCH_TIMEOUT_MS = 6000

/* Artwork past this is a broken or hostile source, not something worth decoding into a card */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

const COLORS = {
  background: '#191B1A',
  border: '#2E322F',
  text: '#F2F5F3',
  muted: '#7E847F',
  accent: '#A4A9A5',
}

const styles = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: COLORS.background,
    color: COLORS.text,
    padding: '56px 60px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
  },
  avatar: {
    width: '88px',
    height: '88px',
    borderRadius: '50%',
    border: `3px solid ${COLORS.border}`,
    objectFit: 'cover',
  },
  avatarFallback: {
    width: '88px',
    height: '88px',
    borderRadius: '50%',
    border: `3px solid ${COLORS.border}`,
    backgroundColor: '#2E322F',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '40px',
    color: COLORS.accent,
  },
  identity: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  displayName: {
    fontSize: '42px',
    color: COLORS.text,
    lineHeight: 1.1,
  },
  handle: {
    fontSize: '26px',
    color: COLORS.muted,
    marginTop: '6px',
  },
  chip: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    fontSize: '24px',
    color: COLORS.accent,
    backgroundColor: '#232624',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '999px',
    padding: '10px 24px',
  },
  body: {
    display: 'flex',
    flex: 1,
    alignItems: 'center',
    gap: '44px',
    marginTop: '40px',
    minHeight: 0,
  },
  text: {
    display: 'flex',
    flex: 1,
    color: COLORS.text,
    lineHeight: 1.35,
  },
  media: {
    width: '380px',
    height: '380px',
    borderRadius: '28px',
    border: `1px solid ${COLORS.border}`,
    objectFit: 'cover',
  },
  /* A wordless post has no text column to sit beside, so the artwork takes the whole band */
  mediaWide: {
    width: '100%',
    height: '100%',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    marginTop: '36px',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '28px',
    color: COLORS.muted,
  },
  stats: {
    marginLeft: 'auto',
    display: 'flex',
    fontSize: '26px',
    color: COLORS.muted,
  },
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text)

/* Long posts step down so the block keeps filling the card instead of overflowing it */
const fontSizeFor = (length) => {
  if (length <= 70) return 54
  if (length <= 150) return 44
  if (length <= 240) return 36
  return 30
}

/**
 * Turns any storage reference into something fetch can reach from the server.
 * @param {string} uri - ipfs:// URI, 0G hash, custom:// URI, data: URI or absolute URL.
 * @param {string} baseUrl - Origin used to absolutize the app-relative storage proxies.
 * @returns {string|null}
 */
const resolveFetchableUrl = (uri, baseUrl) => {
  if (!uri || typeof uri !== 'string') return null
  if (uri.startsWith('data:') || uri.startsWith('http://') || uri.startsWith('https://')) return uri

  /* Some rows carry a bare CID where the schema expects an ipfs:// URI */
  const normalized = /^(Qm|baf)/.test(uri) ? `ipfs://${uri}` : uri

  const resolved = resolveStorageUrl(normalized)
  if (!resolved) return null
  return resolved.startsWith('/') ? `${baseUrl}${resolved}` : resolved
}

/**
 * Fetches an image and re-encodes it as a PNG data URI.
 *
 * Satori will fetch a remote src itself, but it has no decoder for WebP or animated GIF and
 * no timeout, so a gateway stall would hang the whole card. Decoding here means one bounded
 * fetch, one format satori always understands, and a null on any failure.
 *
 * @param {string} url
 * @param {number} boxSize - Longest edge to fit within, in pixels.
 * @returns {Promise<string|null>}
 */
const toPngDataUri = async (url, boxSize) => {
  if (!url) return null

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return null

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) return null

    const png = await sharp(Buffer.from(arrayBuffer), { animated: false, autoOrient: true })
      /* `inside` bounds the pixel count without changing the aspect ratio. Cropping here as
         well as in the layout would crop twice — a wide photo squared off by sharp and then
         cropped again by objectFit keeps only the middle of the middle. */
      .resize({ width: boxSize, height: boxSize, fit: 'inside', withoutEnlargement: true })
      /* PNG has alpha, satori composites it onto the card, and the card is dark — flatten
         so a transparent logo does not disappear into the background */
      .flatten({ background: COLORS.background })
      .png()
      .toBuffer()

    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    /* A card without artwork still reads; one that never arrives does not */
    return null
  }
}

/**
 * The artwork a post should show, in the order a reader would expect to see it.
 * Video posts carry a separately pinned poster frame (see NewPost.jsx) — the previous card
 * only ever looked for `type === 'image'`, so every Shorts share fell back to the site logo.
 *
 * @param {Object} post - The post row from the API.
 * @param {string} baseUrl
 * @returns {Promise<string|null>} A fetchable URL, or null when the post carries no artwork.
 */
const resolvePostArtwork = async (post, baseUrl) => {
  const items = post?.content?.elements?.find((element) => element?.type === 'media')?.data?.items || []

  const image = items.find((item) => item?.type === 'image' && item?.cid)
  if (image) return resolveFetchableUrl(image.cid, baseUrl)

  const video = items.find((item) => item?.type === 'video' && item?.poster)
  if (video) return resolveFetchableUrl(video.poster, baseUrl)

  /* An NFT listing keeps its artwork in token metadata rather than on the post, so it takes
     a listing row plus a metadata lookup. Both are read in-process — two HTTP hops back into
     our own API would serialize into more time than a crawler is willing to wait — and
     allowStale takes whatever the cache already holds rather than paying an RPC round trip
     for a picture. Best-effort throughout: the card is worth more with the piece on it, but
     never worth stalling for. */
  if (post?.nft_listing_id) {
    try {
      const [rows] = await pool.execute(
        `SELECT collection, token_id, is_lsp8 FROM nft_listings WHERE network_id = ? AND listing_id = ? LIMIT 1`,
        [post.network_id, post.nft_listing_id],
      )
      const listing = rows[0]
      if (!listing?.collection) return null

      const result = await getNftMetadata({
        chainId: post.network_id,
        collection: listing.collection,
        tokenId: listing.token_id,
        isLsp8: Boolean(listing.is_lsp8),
        baseUrl,
        allowStale: true,
      })

      return resolveFetchableUrl(result?.metadata?.image, baseUrl)
    } catch (error) {
      console.warn('[post-og] NFT artwork lookup failed:', error.message)
      return null
    }
  }

  return null
}

/* The Hup mark, flattened out of the clipPath the profile card wraps it in — satori's
   clip-path support does not cover a referenced <clipPath>, and the glyph does not need one. */
const Logomark = () => (
  <svg width="34" height="34" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18.6806 3.1875L10.875 6.56655V41.3595L18.6806 44.7498L26.6889 41.3595V35.7277L31.8138 38.0367L37.1077 35.7277V12.2208L31.8138 10.0019L26.6889 12.2208V6.56655L18.6806 3.1875ZM18.9059 40.8526V7.14098L23.2198 8.97693V22.1777H31.8138V12.57L34.8437 13.9329V34.1058L31.8138 35.3898V25.5117H23.2198V39.0166L18.9059 40.8526Z"
      fill={COLORS.muted}
    />
  </svg>
)

/**
 * The branded card shown when a post cannot be resolved at all, so og:image is never a 404.
 */
const FallbackCard = () => (
  <div style={{ ...styles.container, alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
      <Logomark />
      <span style={{ fontSize: '56px', color: COLORS.text }}>Hup</span>
    </div>
    <span style={{ fontSize: '30px', color: COLORS.muted, marginTop: '18px' }}>A decentralized social network</span>
  </div>
)

/**
 * Materializes an ImageResponse into bytes here rather than handing it back to Next.
 *
 * Two reasons. Satori throws on scripts the bundled Geist cannot shape — Persian and Arabic
 * posts fail with "lookupType: 5 - substFormat: 3 is not yet supported" — and because the
 * render is lazy that error would otherwise escape as a 500 from a route with no catch left.
 * Rendering it here means a shaping failure can retry without the post text instead of losing
 * the card. It also lets the response carry its own Cache-Control.
 *
 * @param {Function} build - Receives whether text is allowed, returns the element to render.
 * @returns {Promise<Buffer>}
 */
const render = async (build) => {
  try {
    return Buffer.from(await new ImageResponse(build(true), { ...size }).arrayBuffer())
  } catch (error) {
    console.warn('[post-og] render failed, retrying without post text:', error.message)
    return Buffer.from(await new ImageResponse(build(false), { ...size }).arrayBuffer())
  }
}

export default async function Image({ params }) {
  const { networkId, postId } = await params
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3000'

  try {
    const post = (await getPostById(networkId, postId, null))?.data
    if (!post) {
      return new Response(await render(() => <FallbackCard />), {
        headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL },
      })
    }

    const bodyText = post.content?.elements?.find((element) => element?.type === 'text')?.data?.text || ''
    const [avatar, artwork] = await Promise.all([
      toPngDataUri(resolveFetchableUrl(post.profile_image, baseUrl), 176),
      resolvePostArtwork(post, baseUrl).then((url) => toPngDataUri(url, 760)),
    ])

    /* A post with artwork gets less room for words, so it is cut shorter */
    const text = truncate(bodyText, artwork ? 180 : 300)

    /* A post with neither words nor artwork still has to say something. The header already
       names the author, so the headline carries only what they did — the same phrasing the
       description tag uses, with the name in front of it there instead. */
    const headline = capitalize(summarizePostContent(post))
    const name = post.display_name || shortAddress(post.wallet_address)
    const stats = [
      [post.total_likes, 'like'],
      [post.total_reposts, 'repost'],
      [post.total_comments, 'comment'],
    ]
      .filter(([count]) => Number(count) > 0)
      .map(([count, label]) => `${compact.format(Number(count))} ${label}${Number(count) === 1 ? '' : 's'}`)
      .join('  ·  ')

    const buffer = await render((withText) => (
      <div style={styles.container}>
        <div style={styles.header}>
          {avatar ? <img src={avatar} alt="" style={styles.avatar} /> : <div style={styles.avatarFallback}>{(name[0] || 'H').toUpperCase()}</div>}
          <div style={styles.identity}>
            <span style={styles.displayName}>{name}</span>
            <span style={styles.handle}>{shortAddress(post.wallet_address)}</span>
          </div>
          {post.network_name ? <div style={styles.chip}>{post.network_name}</div> : null}
        </div>

        <div style={styles.body}>
          {withText && text ? (
            <div style={{ ...styles.text, fontSize: `${fontSizeFor(text.length)}px` }}>{text}</div>
          ) : artwork ? null : (
            /* Nothing to letter and nothing to show, so a headline takes the whole card. Text
               that exists but could not be shaped says so rather than claiming the post is
               empty — that is the Persian and Arabic case, where the words are there and only
               the drawing of them failed. */
            <div style={{ ...styles.text, fontSize: '48px', color: COLORS.accent, alignItems: 'center' }}>{text ? 'Read this post on Hup' : headline}</div>
          )}
          {artwork ? <img src={artwork} alt="" style={{ ...styles.media, ...(withText && text ? {} : styles.mediaWide) }} /> : null}
        </div>

        <div style={styles.footer}>
          <div style={styles.brand}>
            <Logomark />
            <span>hup.social</span>
          </div>
          {stats ? <div style={styles.stats}>{stats}</div> : null}
        </div>
      </div>
    ))

    return new Response(buffer, {
      headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL },
    })
  } catch (error) {
    console.error('[post-og] card generation failed:', error.message)
    return new Response(await render(() => <FallbackCard />), {
      headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL },
    })
  }
}
