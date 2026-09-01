/**
 * @file api/v1/drops/sample/route.js
 * @description Serves a downloadable sample of the metadata folder a creator pins to IPFS when
 * every token in a drop carries its own artwork. The collections resolve per-token metadata from
 * a base URI plus the token's number, so the folder's file NAMES are the contract, and they
 * differ per standard — which is exactly the thing a creator gets wrong without an example.
 *
 * Built as a store-only zip rather than pulling in a zip dependency: no compression means the
 * format is a handful of fixed-width headers, and a few kilobytes of JSON gains nothing from
 * deflating anyway.
 */

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
    const data = encoder.encode(content)
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

/** LSP4Metadata — what LUKSO wallets and explorers read for an LSP8 token. */
const lsp4Token = (id) => ({
  LSP4Metadata: {
    name: `Sample #${id}`,
    description: `Token number ${id}. Replace this file with the metadata for your own token ${id}.`,
    links: [],
    icon: [],
    images: [[{ width: 1000, height: 1000, url: `ipfs://REPLACE_WITH_YOUR_IMAGE_CID/${id}.png`, verification: { method: 'keccak256(bytes)', data: '0x' } }]],
    assets: [],
    attributes: [
      { key: 'Number', value: String(id), type: 'number' },
      { key: 'Rarity', value: 'Common', type: 'string' },
    ],
  },
})

/** The ERC721 metadata shape marketplaces expect elsewhere. */
const erc721Token = (id) => ({
  name: `Sample #${id}`,
  description: `Token number ${id}. Replace this file with the metadata for your own token ${id}.`,
  image: `ipfs://REPLACE_WITH_YOUR_IMAGE_CID/${id}.png`,
  attributes: [
    { trait_type: 'Number', value: id },
    { trait_type: 'Rarity', value: 'Common' },
  ],
})

/**
 * The trait table, as a spreadsheet. This is the format most artists can actually produce — the
 * header row names the traits, one row per token — and it is why the sample leads with it rather
 * than with JSON.
 */
const TRAITS_CSV = `tokenId,name,Background,Hood,Eyes,Rarity
1,Hoodless #1,Void,Green,Closed,Common
2,Hoodless #2,Purple Grid,Green,Glowing,Rare
3,Hoodless #3,Static,Cyan,Closed,Legendary
`

/** The same three tokens as JSON, for anyone whose tool exports that instead. */
const TRAITS_JSON = JSON.stringify(
  [
    { tokenId: 1, name: 'Hoodless #1', attributes: [{ trait_type: 'Background', value: 'Void' }, { trait_type: 'Hood', value: 'Green' }, { trait_type: 'Rarity', value: 'Common' }] },
    { tokenId: 2, name: 'Hoodless #2', attributes: [{ trait_type: 'Background', value: 'Purple Grid' }, { trait_type: 'Hood', value: 'Green' }, { trait_type: 'Rarity', value: 'Rare' }] },
    { tokenId: 3, name: 'Hoodless #3', attributes: [{ trait_type: 'Background', value: 'Static' }, { trait_type: 'Hood', value: 'Cyan' }, { trait_type: 'Rarity', value: 'Legendary' }] },
  ],
  null,
  2,
)

const READMES = {
  lsp8: `Hup Drops — sample files (LSP8, LUKSO)
==========================================

There are two ways to give your collection per-token artwork. This zip has an
example of each.


A) UPLOAD A ZIP (the easy way)
------------------------------
Put your artwork in a zip and drop it on the upload box. That is all that is
required — traits are optional.

    1.png, 2.png, 3.png ... one per token

Folders are fine and ignored; "images/1.png" works the same as "1.png". The
NUMBER in each filename is what matters, because it decides which token the
artwork belongs to. 001.png, hoodless_1.png and "HOODLESS #1.png" all read as
token 1. Numbering starts at 1, not 0.

To give tokens traits, add ONE of these beside the art:

    traits.csv        <- see the example in this zip, easiest to make
    metadata.json     <- the metadata.json in this zip, if your tool exports JSON
    metadata/1.json   <- or one file per token, named by number

Traits are what make a collection rare: "Background: Void", "Rarity: Legendary".
Collectors filter and price on them. A collection with no traits is perfectly
valid — every token is then just its artwork and its number.

We read your traits, then WRITE the real metadata ourselves: your images are
pinned first, and each token's metadata file is generated pointing at its own
image, carrying a keccak256 of that image's bytes so the artwork is verifiable.
That hash is the part nobody makes by hand, and it is why we generate rather
than pin your JSON as-is.


B) PIN THE FOLDER YOURSELF (the manual way)
-------------------------------------------
If you would rather pin your own directory and paste the CID, the files must
look like the ones in "generated/" below.

Hup Drops — per-token metadata folder (LSP8, LUKSO)
===================================================

Your collection resolves a token's metadata as:

    LSP8TokenMetadataBaseURI  +  the token's number

Note what is NOT in that formula: a file extension. LSP8 appends the number and
nothing else, which is why the files in this folder are named "1", "2", "3" with
no ".json" on the end. Naming them 1.json here is the single most common way to
end up with a collection whose metadata resolves to nothing.

Steps
-----
1. Replace every file with your own, one per token, named for its number:
   1, 2, 3 ... up to your supply. Token ids start at 1, not 0.
2. Point each file's images[].url at your artwork. Pin the images as their own
   folder first so you have that CID.
3. Pin THIS folder. You get one CID for the directory.
4. In the drop's manage panel, set Base URI to:
       ipfs://YOUR_FOLDER_CID/
   The trailing slash matters — without it token 1 resolves to
   "ipfs://YOUR_FOLDER_CIDb1" rather than a file inside the folder.
5. Leave Suffix empty for LSP8.

Until you do this, every token shares the collection's single artwork, which is
the default and is fine for a one-artwork drop.

Metadata shape: LSP4Metadata. Keep the outer "LSP4Metadata" wrapper — LUKSO
tools read that key, not the object directly.
`,
  erc721: `Hup Drops — sample files (ERC721)
=======================================

There are two ways to give your collection per-token artwork. This zip has an
example of each.


A) UPLOAD A ZIP (the easy way)
------------------------------
Put your artwork in a zip and drop it on the upload box. Traits are optional.

    1.png, 2.png, 3.png ... one per token

Folders are fine and ignored; "images/1.png" works the same as "1.png". The
NUMBER in the filename decides which token the artwork belongs to, and numbering
starts at 1, not 0.

To give tokens traits, add ONE of these beside the art:

    traits.csv        <- see the example in this zip, easiest to make
    metadata.json     <- the metadata.json in this zip, if your tool exports JSON
    metadata/1.json   <- or one file per token, named by number

Traits are what make a collection rare: "Background: Void", "Rarity: Legendary".
Collectors filter and price on them.

We read your traits, then WRITE the real metadata ourselves — your images are
pinned first, and each token's JSON is generated pointing at its own pinned
image. That is why your own JSON is never pinned as-is: its "image" field has to
name a CID that does not exist until we pin the artwork.


B) PIN THE FOLDER YOURSELF (the manual way)
-------------------------------------------
If you would rather pin your own directory and paste the CID, the files must
look like the ones in "generated/" below.

Hup Drops — per-token metadata folder (ERC721)
=============================================

Your collection resolves a token's metadata as:

    Base URI  +  the token's number  +  Suffix

so with Base URI "ipfs://YOUR_FOLDER_CID/" and Suffix ".json", token 1 resolves
to "ipfs://YOUR_FOLDER_CID/1.json" — which is how the files here are named.

Steps
-----
1. Replace every file with your own, one per token: 1.json, 2.json, 3.json ...
   up to your supply. Token ids start at 1, not 0.
2. Point each file's "image" at your artwork. Pin the images as their own folder
   first so you have that CID.
3. Pin THIS folder. You get one CID for the directory.
4. In the drop's manage panel set Base URI to "ipfs://YOUR_FOLDER_CID/" (the
   trailing slash matters) and Suffix to ".json".

Metadata shape: the OpenSea convention, which every EVM marketplace reads.
`,
}

export async function GET(request) {
  const standardId = Number(new URL(request.url).searchParams.get('standard') ?? DROP_STANDARDS.LSP8)
  const lukso = isLuksoStandard(standardId)

  // The file NAMES are the part that differs, and the part worth demonstrating: LSP8 appends
  // the bare number, ERC721 appends number + suffix.
  const files = [
    { name: 'README.txt', content: lukso ? READMES.lsp8 : READMES.erc721 },
    // What a creator provides — the whole point of the sample, so it sits at the top level
    { name: 'traits.csv', content: TRAITS_CSV },
    { name: 'metadata.json', content: TRAITS_JSON },
  ]

  // What we generate from it, kept in a subfolder so nobody mistakes it for something to fill in
  for (const id of [1, 2, 3]) {
    files.push(
      lukso
        ? { name: `generated/${id}`, content: JSON.stringify(lsp4Token(id), null, 2) }
        : { name: `generated/${id}.json`, content: JSON.stringify(erc721Token(id), null, 2) },
    )
  }

  const zip = buildZip(files)
  const filename = lukso ? 'hup-drop-metadata-sample-lsp8.zip' : 'hup-drop-metadata-sample-erc721.zip'

  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zip.length),
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
