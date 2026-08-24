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
import { shortUploadError } from '@/lib/uploadErrors'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/* Pinning is not instant: a HEAD issued the moment the PUT returns usually has no cid yet.
   These bounds cover the couple of seconds a large video takes without holding the request
   open long enough to hit a platform function timeout. */
const ATTEMPTS = 8
const RETRY_DELAY_MS = 750

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* HEAD responses carry no body, so the SDK has nothing better than "UnknownError" to say — the
   status code is the whole story. The client only asks here after its PUT succeeded, so a 403
   means the keys this server holds are not the ones that signed the upload: stale env. */
function describeHeadFailure(error, status) {
  if (status === 403) return 'Storage refused to read the upload back — check the Filebase S3 keys'
  if (status) return `Storage answered ${status} while reading the upload back`
  return shortUploadError(error, 'Could not read the upload back')
}

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
    region: 'auto',
    endpoint: 'https://s3.filebase.io',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.FILEBASE_S3_KEY,
      secretAccessKey: process.env.FILEBASE_S3_SECRET,
    },
  })

  let lastError = 'CID was not available'
  /* True when the object is simply not there yet — the one failure the client can fix by asking
     again instead of by uploading the whole file a second time */
  let pending = false

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS)

    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: process.env.FILEBASE_S3_BUCKET, Key: key })
      )

      /* The SDK lower-cases metadata keys, so x-amz-meta-cid arrives as Metadata.cid */
      const cid = head.Metadata?.cid
      if (cid) return NextResponse.json({ cid: `ipfs://${cid}` }, { status: 200 })

      lastError = 'Uploaded, but storage has not finished pinning it yet — try again'
      pending = true
    } catch (error) {
      // A 404 right after the PUT is read-after-write lag, not a missing object — keep retrying
      const status = error?.$metadata?.httpStatusCode
      pending = status === 404
      lastError = pending ? 'Uploaded, but storage has not registered it yet — try again' : describeHeadFailure(error, status)
      if (status && status !== 404 && status !== 403) break
    }
  }

  console.warn(`[ipfs/cid] could not resolve ${key}: ${lastError}`)
  return NextResponse.json({ error: lastError, pending }, { status: 502 })
}
