// app/api/ipfs/cid/route.js
//
// Resolves a Filebase S3 object key to the IPFS CID Filebase pinned it under. A presigned S3
// PUT can't tell the browser what CID it produced — Filebase only attaches the CID as object
// metadata once it has finished pinning — so the client uploads first and asks here after.
//
// Runs server-side because reading that metadata needs the S3 credentials, which never reach
// the browser.

import { NextResponse } from 'next/server'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/* Pinning is not instant: a HEAD issued the moment the PUT returns usually has no cid yet.
   These bounds cover the couple of seconds a large video takes without holding the request
   open long enough to hit a platform function timeout. */
const ATTEMPTS = 8
const RETRY_DELAY_MS = 750

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const key = (searchParams.get('key') || '').trim()

  /* Keys are minted by /api/ipfs/presign as uploads/<uuid>[.ext] — anything else was not
     issued by us and has no business being probed through these credentials. */
  if (!/^uploads\/[0-9a-f-]{36}(\.[A-Za-z0-9]{1,8})?$/.test(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }

  if (!process.env.FILEBASE_S3_KEY || !process.env.FILEBASE_S3_SECRET || !process.env.FILEBASE_S3_BUCKET) {
    return NextResponse.json({ error: 'Filebase storage is not configured' }, { status: 500 })
  }

  const client = new S3Client({
    region: 'us-east-1',
    endpoint: 'https://s3.filebase.com',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.FILEBASE_S3_KEY,
      secretAccessKey: process.env.FILEBASE_S3_SECRET,
    },
  })

  let lastError = 'CID was not available'

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS)

    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: process.env.FILEBASE_S3_BUCKET, Key: key })
      )

      /* The SDK lower-cases metadata keys, so x-amz-meta-cid arrives as Metadata.cid */
      const cid = head.Metadata?.cid
      if (cid) return NextResponse.json({ cid: `ipfs://${cid}` }, { status: 200 })

      lastError = 'Object exists but has not been pinned yet'
    } catch (error) {
      // A 404 right after the PUT is read-after-write lag, not a missing object — keep retrying
      const status = error?.$metadata?.httpStatusCode
      lastError = status === 404 ? 'Object not visible yet' : error.message || 'Head request failed'
      if (status && status !== 404 && status !== 403) break
    }
  }

  console.warn(`[ipfs/cid] could not resolve ${key}: ${lastError}`)
  return NextResponse.json({ error: lastError }, { status: 502 })
}
