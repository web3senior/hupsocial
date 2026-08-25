/**
 * @file api/nft/image/route.js
 * @description Serves artwork for fully onchain collections as a cacheable HTTP resource.
 *
 * Collections that render onchain hand back their art as a `data:` URI (Burnt Pix ships the
 * whole SVG as `data:image/svg+xml;base64,…` inside its tokenURI JSON). Inlining that into
 * `<img src>` means the browser can never HTTP-cache it, the base64 sits in the DOM at full
 * size, and every visitor re-pays for it. Behind this route the same artwork becomes a stable
 * keyed URL: browser-cacheable, CDN-cacheable, and rasterized to WebP.
 *
 * Rasterizing is also what keeps it safe. Contract-authored SVG is attacker-controlled markup;
 * it is decoded into pixels here and never echoed back as markup, so there is no script to run.
 *
 * Tokens whose artwork lives in real storage redirect to the existing IPFS/0G proxies rather
 * than being re-encoded here twice.
 */

import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { webpAnimationOptions } from '@/lib/webpAnimation'
import { getNftMetadata } from '@/lib/nftMetadataCache'
import { isInlineDataUri } from '@/lib/nftMetadata'
import { resolveStorageImageUrl } from '@/lib/storageHelper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Onchain art can change (Burnt Pix evolves as it is refined), so this is deliberately not
// the `immutable` the IPFS proxy uses — a CID's bytes can never change, a contract's can.
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

// A data URI this large is a broken or hostile contract, not artwork worth decoding.
const MAX_DATA_URI_CHARS = 12 * 1024 * 1024

function intParam(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

/**
 * Splits a data: URI into its mime type and decoded bytes. Handles both `;base64` payloads
 * and plain (usually percent-encoded) ones — contracts emit both.
 */
function parseDataUri(uri) {
  const comma = uri.indexOf(',')
  if (comma === -1) return null

  const header = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  const mime = header.slice('data:'.length).split(';')[0] || 'application/octet-stream'

  if (header.includes(';base64')) {
    return { mime, buffer: Buffer.from(payload, 'base64') }
  }

  // Percent-decoding is best effort — a body containing a bare `%` is not valid
  // percent-encoding but is still a perfectly renderable SVG.
  let text = payload
  try {
    text = decodeURIComponent(payload)
  } catch {
    text = payload
  }
  return { mime, buffer: Buffer.from(text, 'utf8') }
}

/**
 * Rasterizes decoded artwork bytes to WebP at the requested width.
 *
 * SVG needs different handling from raster input: libvips renders it at its intrinsic size
 * first, so a 32x32 `viewBox` upscaled to 512 would be a blurry 32px bitmap. Raising the
 * render density instead makes the vector rasterize at the target size natively.
 */
async function encodeToWebp(buffer, { width, quality, stillOnly }) {
  const probe = await sharp(buffer).metadata()

  if (probe.format === 'svg') {
    const intrinsicWidth = probe.width || 0
    // 72 is libvips' base DPI for SVG; scaling it scales the rasterized output 1:1.
    const density = width && intrinsicWidth > 0 ? Math.min(Math.max((72 * width) / intrinsicWidth, 72), 2400) : 72

    let pipeline = sharp(buffer, { density })
    if (width) pipeline = pipeline.resize({ width })
    return pipeline.webp({ quality }).toBuffer()
  }

  /* still=1 decodes/encodes only the first frame — skips the expensive per-frame
     resize+encode animated GIFs/WEBPs otherwise need, for thumbnail contexts that
     don't render motion anyway (grid cards, compact previews) */
  const metadata = await sharp(buffer, { animated: !stillOnly }).metadata()
  const isAnimated = !stillOnly && (metadata.pages ?? 1) > 1

  let pipeline = sharp(buffer, { animated: !stillOnly, autoOrient: true })

  if (width) {
    pipeline = pipeline.resize({
      width,
      withoutEnlargement: true,
    })
  }

  return pipeline
    .webp({
      quality,
      ...(isAnimated ? webpAnimationOptions(metadata) : {}),
    })
    .toBuffer()
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)

  const chainId = searchParams.get('chainId')
  const collection = searchParams.get('collection')
  const tokenId = searchParams.get('tokenId')
  const isLsp8 = searchParams.get('isLsp8') === '1'

  const width = intParam(searchParams.get('w'), null, 1, 4096)
  const quality = intParam(searchParams.get('q'), 80, 1, 100)
  const stillOnly = searchParams.get('still') === '1'

  if (!chainId || !collection || !tokenId) {
    return NextResponse.json({ error: 'chainId, collection and tokenId are required' }, { status: 400 })
  }

  try {
    // Stale artwork beats a blocked render: the row only has to tell us where the image is,
    // and the metadata route refreshes it on its own TTL.
    const result = await getNftMetadata({ chainId, collection, tokenId, isLsp8, baseUrl: origin, allowStale: true })
    const image = result?.metadata?.image

    if (!image) {
      return NextResponse.json({ error: 'No artwork for this token' }, { status: 404 })
    }

    /* Stored artwork already has a compression proxy — send it there instead of
       decoding the same bytes a second time here */
    if (!isInlineDataUri(image)) {
      const resolved = resolveStorageImageUrl(image, { width, quality, still: stillOnly })
      if (!resolved) return NextResponse.json({ error: 'Unresolvable artwork reference' }, { status: 404 })
      return NextResponse.redirect(new URL(resolved, origin), 302)
    }

    if (image.length > MAX_DATA_URI_CHARS) {
      return NextResponse.json({ error: 'Inline artwork exceeds the size limit' }, { status: 413 })
    }

    const parsed = parseDataUri(image)
    if (!parsed || parsed.buffer.length === 0) {
      return NextResponse.json({ error: 'Malformed inline artwork' }, { status: 422 })
    }

    const optimizedBuffer = await encodeToWebp(parsed.buffer, { width, quality, stillOnly })

    return new Response(optimizedBuffer, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': CACHE_CONTROL,
      },
    })
  } catch (error) {
    console.error('NFT_IMAGE_ROUTE_ERROR:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
