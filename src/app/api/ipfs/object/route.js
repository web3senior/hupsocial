// app/api/ipfs/object/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
import { addToFilebase } from '@/lib/filebase'
import { bothProvidersFailed, shortUploadError } from '@/lib/uploadErrors'
import { gatewayUrl, raceIPFS } from '@/lib/ipfsGateways'

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
})

export const dynamic = 'force-dynamic'
export const revalidate = 0
/* This route now retries Filebase before falling back to Pinata, and an article body is the
   largest thing it pins. Left on the platform default (10–15s without Fluid Compute) the last
   retry would be killed mid-flight — the failure the retry exists to prevent. Same figure the
   media route uses. */
export const maxDuration = 60

async function uploadToFilebase(json) {
  const body = JSON.stringify(json)

  /* Rebuilt per attempt: the Blob inside is consumed by the request that sends it */
  return addToFilebase(() => {
    const form = new FormData()
    form.append('file', new Blob([body], { type: 'application/json' }), 'metadata.json')
    return form
  })
}

async function uploadToPinata(json) {
  const result = await pinata.upload.public.json(json, {
    pinataMetadata: { name: 'metadata' },
  })
  console.log('[pinata] uploaded, CID:', result.cid)
  return result.cid
}

export async function POST(request) {
  try {
    const json = await request.json()

    if (!json) {
      return NextResponse.json({ error: 'No JSON data provided' }, { status: 400 })
    }

    let rawCID
    try {
      rawCID = await uploadToFilebase(json)
    } catch (filebaseError) {
      console.warn('[filebase] upload failed, falling back to Pinata:', filebaseError.message)
      try {
        rawCID = await uploadToPinata(json)
      } catch (pinataError) {
        console.error('[pinata] fallback upload failed:', pinataError.message)
        return NextResponse.json({ error: bothProvidersFailed(filebaseError, pinataError) }, { status: 502 })
      }
    }

    const cid = `ipfs://${rawCID}`
    const url = gatewayUrl(rawCID)
    console.log('Upload complete. CID:', cid)
    return NextResponse.json({ url, cid }, { status: 200 })
  } catch (e) {
    console.error('JSON upload error:', e)
    return NextResponse.json({ error: shortUploadError(e, 'Upload failed on the server') }, { status: 500 })
  }
}

// Reading a document back, for the browser.
//
// A gateway that is rate-limiting or erroring answers without an Access-Control-Allow-Origin
// header, so a client-side read of ipfs.io does not fall through to the next host — it dies as a
// CORS failure the fetch cannot even see the status of. That is not something a gateway order in
// the bundle can fix: falling through only works where there is no CORS to negotiate. So the
// browser asks here, this races the same list (Filebase first) server-side, and the answer comes
// back same-origin.

// Metadata documents. Anything larger is media, and media has /api/ipfs/file.
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
const DEFAULT_READ_TIMEOUT_MS = 10000
const MAX_READ_TIMEOUT_MS = 20000

// A gateway that looked for the document and is answering about the document, not about itself.
const DEFINITIVE_STATUSES = new Set([400, 404, 410, 451])

// The bytes at a CID can never change.
const IMMUTABLE_CACHE = 'public, max-age=31536000, s-maxage=31536000, immutable'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const cid = (searchParams.get('cid') || '').replace(/^ipfs:\/\//, '').trim()

  // The gateway origins come from env and never from the caller; the CID is held to the shape of
  // a path segment so a crafted value cannot climb out of it
  if (!cid || cid.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(cid)) {
    return NextResponse.json({ error: 'Invalid CID' }, { status: 400 })
  }

  const requested = Number(searchParams.get('t'))
  const timeoutMs = Math.min(Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_READ_TIMEOUT_MS, MAX_READ_TIMEOUT_MS)

  let upstream
  try {
    upstream = await raceIPFS(cid, { timeoutMs })
  } catch (error) {
    const statuses = error.statuses || []
    // Every gateway looked and every one of them said the same thing: that is an answer about the
    // document. Anything else is an answer about the hosts, and the caller treats it differently.
    const answered = !error.timedOut && statuses.length === error.attempted && statuses.every((status) => DEFINITIVE_STATUSES.has(status))
    return NextResponse.json(
      { error: error.message || 'No IPFS gateway could serve this document', attempted: error.attempted ?? 0, statuses, timedOut: Boolean(error.timedOut) },
      { status: answered ? 404 : 502 }
    )
  }

  const bytes = Buffer.from(await upstream.arrayBuffer())
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ error: 'Document is too large to proxy' }, { status: 413 })
  }

  // The bytes are author-controlled and this route serves them from our own origin, so the type
  // they go out under is decided here and never taken from the gateway: JSON when the body really
  // is JSON, opaque bytes otherwise. Nothing can leave as markup a browser would run.
  const text = bytes.toString('utf8')
  let isJson = true
  try {
    JSON.parse(text)
  } catch {
    isJson = false
  }

  return new NextResponse(isJson ? text : bytes, {
    status: 200,
    headers: {
      'Content-Type': isJson ? 'application/json; charset=utf-8' : 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': IMMUTABLE_CACHE,
    },
  })
}
