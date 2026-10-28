/**
 * @file lib/hupBridge/metadata.js
 * @description The LSP4Metadata a bridge mirror carries, so a Universal Profile and the LUKSO
 * explorer show the token with its icon. Written by the first claim of each token (the user's own
 * transaction), so the bridge never pays to set it.
 *
 * The icon is the source token's own logo (GeckoTerminal, then TrustWallet), or the chain's icon for
 * a native coin. Both the icon and the JSON are pinned to IPFS and hashed over the exact bytes
 * pinned, so the VerifiableURI checks out wherever it is resolved.
 */

import { keccak256, stringToBytes } from 'viem'
import { CHAIN_ICONS } from '@/config/chainIcons'
import { NATIVE_TOKEN } from '@/config/hupBridge'
import { encodeVerifiableURI } from '@/lib/drops'
import { addToFilebase } from '@/lib/filebase'
import { fetchTokenLogos, logoKeyFor } from '@/lib/tokenLogos'
import { tokenIconUrl } from '@/lib/tokenIcons'

const FETCH_TIMEOUT_MS = 10_000
const APP_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://hup.social'

// One build per token per server instance: the bytes, and so the CID, never change.
const cache = new Map()

/** Width and height from an SVG, PNG, GIF, WebP or JPEG header; null for anything else. */
function imageSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length))
  const head = new TextDecoder().decode(bytes.slice(0, 1024))
  if (head.includes('<svg')) {
    const attr = (name) => Number(head.match(new RegExp(`${name}\\s*=\\s*"(\\d+(?:\\.\\d+)?)`))?.[1])
    const box = head.match(/viewBox\s*=\s*"[\d.\s-]*?([\d.]+)[\s,]+([\d.]+)\s*"/)
    const width = attr('width') || Number(box?.[1])
    const height = attr('height') || Number(box?.[2])
    return width && height ? { width: Math.round(width), height: Math.round(height) } : null
  }
  if (bytes.length > 24 && ascii(1, 3) === 'PNG') return { width: view.getUint32(16), height: view.getUint32(20) }
  if (bytes.length > 10 && ascii(0, 3) === 'GIF') return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  if (bytes.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4)
    if (chunk === 'VP8X') return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(27, true) & 0xffffff) }
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
      offset += 2 + view.getUint16(offset + 2)
    }
  }
  return null
}

async function fetchImage(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    const type = response.headers.get('content-type') || ''
    if (!response.ok || !type.startsWith('image/')) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.length ? { bytes, type } : null
  } catch {
    return null
  }
}

/** The source token's artwork, or null when no source has one. */
async function iconFor(chain, token) {
  if (token === NATIVE_TOKEN) return CHAIN_ICONS[chain.id] ? { bytes: stringToBytes(CHAIN_ICONS[chain.id]), type: 'image/svg+xml' } : null
  const logos = await fetchTokenLogos([{ chainId: chain.id, address: token }]).catch(() => new Map())
  for (const url of [logos.get(logoKeyFor(chain.id, token)), tokenIconUrl(chain.id, token)].filter(Boolean)) {
    const image = await fetchImage(url)
    if (image) return image
  }
  return null
}

const pin = (bytes, type, filename) => addToFilebase(() => {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), filename)
  return form
})

/**
 * The encoded LSP4Metadata value (an LSP2 VerifiableURI) for a source token's mirror.
 * @returns {Promise<`0x${string}`>}
 */
export async function buildMirrorMetadata({ chain, token, name, symbol }) {
  const key = `${chain.id}:${token.toLowerCase()}`
  if (cache.has(key)) return cache.get(key)

  const icon = []
  const image = await iconFor(chain, token)
  if (image) {
    const extension = image.type.includes('svg') ? 'svg' : image.type.split('/')[1] || 'png'
    const cid = await pin(image.bytes, image.type, `icon.${extension}`)
    const size = imageSize(image.bytes) ?? { width: 256, height: 256 }
    icon.push({ ...size, url: `ipfs://${cid}`, verification: { method: 'keccak256(bytes)', data: keccak256(image.bytes) } })
  }

  const native = token === NATIVE_TOKEN
  const sourceUrl = native ? chain.blockExplorers?.default.url : `${chain.blockExplorers?.default.url}/token/${token}`
  const document = {
    LSP4Metadata: {
      name,
      description: `${name} (${symbol}) from ${chain.name}, bridged to LUKSO by Hup. Every unit is backed 1:1 by ${symbol} locked in the Hup bridge vault on ${chain.name}.`,
      links: [
        { title: 'Bridge on Hup', url: `${APP_URL}/bridge` },
        ...(sourceUrl ? [{ title: `${symbol} on ${chain.name}`, url: sourceUrl }] : []),
      ],
      icon,
      images: icon.length ? [icon] : [],
      assets: [],
      attributes: [
        { key: 'Source chain', value: chain.name, type: 'string' },
        { key: 'Source token', value: native ? 'native' : token, type: 'string' },
      ],
    },
  }

  const json = JSON.stringify(document)
  const cid = await pin(stringToBytes(json), 'application/json', 'metadata.json')
  const value = encodeVerifiableURI(`ipfs://${cid}`, json)
  cache.set(key, value)
  return value
}
