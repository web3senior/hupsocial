/**
 * @file api/v1/drops/sample/route.js
 * @description Serves a downloadable sample set for a numbered drop — the same thing a creator
 * would hand any launchpad: three numbered images with a traits file beside them, and a README
 * that says what happens on upload. It uploads unchanged, which is the point: the format is
 * learned by trying it, not by reading about it.
 *
 * Built as a store-only zip rather than pulling in a zip dependency: no compression means the
 * format is a handful of fixed-width headers, and PNG bytes are already compressed.
 */

import { deflateSync } from 'node:zlib'
import { DROP_STANDARDS, isLuksoStandard } from '@/lib/drops'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

const crc32 = (bytes) => {
  let c = -1
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** Minimal store-only zip: local headers, then the central directory, then the EOCD record. */
const buildZip = (files) => {
  const encoder = new TextEncoder()
  const locals = []
  const centrals = []
  let offset = 0

  for (const { name, content } of files) {
    const nameBytes = encoder.encode(name)
    // Text is encoded; image bytes go in as they are
    const data = typeof content === 'string' ? encoder.encode(content) : content
    const crc = crc32(data)

    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, 0, true) // stored, no compression
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // central directory header
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // end of central directory
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const total = offset + centralSize + end.length
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

// --- the three example images, drawn here so the sample is a complete set ---

const pngChunk = (type, data) => {
  const typeBytes = new TextEncoder().encode(type)
  const out = new Uint8Array(8 + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  const crcInput = new Uint8Array(typeBytes.length + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, typeBytes.length)
  view.setUint32(8 + data.length, crc32(crcInput))
  return out
}

/** A square RGB PNG from a pixel function — zlib is all a PNG needs, and Node ships it. */
const encodePng = (size, pixel) => {
  const stride = size * 3 + 1
  const raw = new Uint8Array(stride * size)
  for (let y = 0; y < size; y++) {
    const row = y * stride
    raw[row] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y)
      const i = row + 1 + x * 3
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
  const header = new Uint8Array(13)
  const hv = new DataView(header.buffer)
  hv.setUint32(0, size)
  hv.setUint32(4, size)
  header[8] = 8 // bits per channel
  header[9] = 2 // colour type: RGB

  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', new Uint8Array(deflateSync(raw))),
    pngChunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

const SAMPLE_IMAGE_SIZE = 384
// Deterministic noise, so the same download is byte-identical every time
const noise = (x, y) => {
  let h = (x * 374761393 + y * 668265263) >>> 0
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0
  return (h ^ (h >>> 16)) & 255
}

/**
 * Token `id`'s picture, matching its entry in metadata.json: a hooded figure on the background the
 * traits name — Void, Purple Grid, Static — so the traits and the artwork visibly belong together.
 * The figure's colour is the "Figure" trait: green for 1 and 2, cyan for 3.
 */
const sampleImage = (id) => {
  const size = SAMPLE_IMAGE_SIZE
  const centre = size / 2
  const hood = id === 3 ? [34, 211, 238] : [76, 175, 80]
  return encodePng(size, (x, y) => {
    const dx = x - centre
    const dy = y - centre + 16
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < 110) {
      // Eyes: closed slits for 1 and 3, a glowing pair for 2
      const overEye = Math.abs(dx) > 28 && Math.abs(dx) < 48 && Math.abs(dy + 8) < (id === 2 ? 9 : 4)
      if (overEye) return id === 2 ? [255, 240, 120] : [20, 20, 30]
      return hood
    }
    if (id === 1) {
      const glow = Math.max(0, 1 - d / 240)
      return [Math.round(18 + glow * 16), Math.round(18 + glow * 54), Math.round(28 + glow * 26)]
    }
    if (id === 2) {
      const onLine = x % 32 < 2 || y % 32 < 2
      return onLine ? [160, 120, 255] : [88, 60, 190]
    }
    const grain = 90 + (noise(x >> 2, y >> 2) >> 1)
    return [grain, grain, grain]
  })
}

/** The traits behind the three pictures, matching what `sampleImage` draws. */
const SAMPLE_TRAITS = [
  { Background: 'Void', Figure: 'Green', Rarity: 'Common' },
  { Background: 'Purple Grid', Figure: 'Green', Rarity: 'Rare' },
  { Background: 'Static', Figure: 'Cyan', Rarity: 'Legendary' },
]

/**
 * The trait table: one entry per token, named after the collection, with its traits in the
 * attribute shape the standard's own metadata uses — `{key, value, type}` for LSP4, `{trait_type,
 * value}` for the OpenSea convention — so what a creator copies from here is what the final file
 * will carry.
 */
const traitsJson = ({ lukso, name }) =>
  JSON.stringify(
    SAMPLE_TRAITS.map((traits, index) => ({
      tokenId: index + 1,
      name: `${name} #${index + 1}`,
      description: '',
      attributes: Object.entries(traits).map(([key, value]) => (lukso ? { key, value, type: 'string' } : { trait_type: key, value })),
    })),
    null,
    2,
  )

const FORMAT_INTRO = `This zip is a complete, working example. Upload it as it is to see how the
upload works, then replace the files with your own.

    1.png, 2.png, 3.png   your artwork — one image per token, numbered
    metadata.json         optional — one entry per token: its name and traits

That is the whole format, the same one other launchpads take. Numbering starts
at 1. Folders are fine ("images/1.png" works); only the number in the filename
matters, so 001.png and art_1.png both mean token 1. A set with no traits
file is valid too — every token is then its artwork and its number.

What happens when you upload: your images are pinned, then one metadata file
per token is written and pinned pointing at its own image:
`

const readme = ({ lukso, name }) =>
  lukso
    ? `Hup Drops — sample set (LSP8, LUKSO)
===================================

${FORMAT_INTRO}
    LSP4Metadata, carrying a keccak256 of the image so the artwork is verifiable

You never write those files yourself. The Studio fills in the folder link; you
press Save.

Already have finished metadata files? Upload them instead of images, named

    1, 2, 3 with no ".json", because LSP8 appends the bare number

and they are pinned exactly as they are. Each one is an LSP4Metadata document,
for example token 1:

    {
      "LSP4Metadata": {
        "name": "${name} #1",
        "description": "",
        "links": [],
        "icon": [],
        "images": [[{
          "width": ${SAMPLE_IMAGE_SIZE}, "height": ${SAMPLE_IMAGE_SIZE},
          "url": "ipfs://<folder cid>/1.png",
          "verification": { "method": "keccak256(bytes)", "data": "0x<keccak256 of the image bytes>" }
        }]],
        "assets": [],
        "attributes": [
          { "key": "Background", "value": "Void", "type": "string" },
          { "key": "Figure", "value": "Green", "type": "string" },
          { "key": "Rarity", "value": "Common", "type": "string" }
        ]
      }
    }
`
    : `Hup Drops — sample set (ERC721)
==============================

${FORMAT_INTRO}
    OpenSea-style JSON, which every EVM marketplace reads

You never write those files yourself. The Studio fills in the folder link; you
press Save.

Already have finished metadata files? Upload them instead of images, named

    1.json, 2.json, 3.json, because ERC721 appends the number and the ending

and they are pinned exactly as they are. For example token 1:

    {
      "name": "${name} #1",
      "description": "",
      "image": "ipfs://<folder cid>/1.png",
      "attributes": [
        { "trait_type": "Background", "value": "Void" },
        { "trait_type": "Figure", "value": "Green" },
        { "trait_type": "Rarity", "value": "Common" }
      ]
    }
`

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const standardId = Number(searchParams.get('standard') ?? DROP_STANDARDS.LSP8)
  const lukso = isLuksoStandard(standardId)
  // The collection's own name, so the sample reads as the creator's drop rather than someone else's
  const name = (searchParams.get('name') ?? '').trim().slice(0, 40) || 'Sample Drop'

  // Exactly what a creator would hand any launchpad, nothing else: the numbered images and the
  // traits beside them. Uploading this zip unchanged works.
  const files = [
    { name: 'README.txt', content: readme({ lukso, name }) },
    { name: '1.png', content: sampleImage(1) },
    { name: '2.png', content: sampleImage(2) },
    { name: '3.png', content: sampleImage(3) },
    { name: 'metadata.json', content: traitsJson({ lukso, name }) },
  ]

  const zip = buildZip(files)
  const filename = lukso ? 'hup-drop-sample-lsp8.zip' : 'hup-drop-sample-erc721.zip'

  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zip.length),
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
