// app/api/ipfs/hash/route.js
//
// keccak256 of the exact bytes a gateway serves for a CID — the digest LSP2/LSP4 verification
// data carries (`verification: { method: 'keccak256(bytes)', data }`, and the hash inside a
// VerifiableURI). Hashing the *served* bytes rather than the bytes we uploaded is deliberate:
// /api/ipfs/file transcodes HEIC before pinning and /api/ipfs/object re-serializes the JSON, so
// only what the gateway returns is guaranteed to be what a verifier will fetch.
//
// Runs server-side so no public gateway's CORS policy can break metadata publishing.

import { NextResponse } from 'next/server'
import { keccak256 } from 'viem'
import { fetchIPFS } from '@/lib/ipfsGateways'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const FETCH_TIMEOUT_MS = 10000

// A CID pinned a moment ago can 404 on the first read while the gateway catches up
const ATTEMPTS = 3
const RETRY_DELAY_MS = 700

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const cid = (searchParams.get('cid') || '').replace(/^ipfs:\/\//, '').trim()

  // The gateway origin comes from env and never from the caller; the CID is restricted to the
  // path segment shape so a crafted value can't climb out of it
  if (!cid || cid.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(cid)) {
    return NextResponse.json({ error: 'Invalid CID' }, { status: 400 })
  }

  let lastError = 'Gateway did not answer'

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS)

    try {
      // Every gateway in the list gets a turn per attempt: the bytes are content-addressed, so
      // whichever host answers first hashes to the same digest a verifier will compute
      const upstream = await fetchIPFS(cid, { timeoutMs: FETCH_TIMEOUT_MS })

      const bytes = new Uint8Array(await upstream.arrayBuffer())
      // A zero-byte answer is a gateway hiccup, not content worth hashing
      if (bytes.length === 0) {
        lastError = 'Gateway returned an empty body'
        continue
      }

      return NextResponse.json({ cid, hash: keccak256(bytes), size: bytes.length }, { status: 200 })
    } catch (error) {
      lastError = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'IPFS gateway timed out' : error.message || 'Hashing failed'
    }
  }

  console.warn(`[ipfs/hash] could not hash ${cid}: ${lastError}`)
  return NextResponse.json({ error: lastError }, { status: 502 })
}
