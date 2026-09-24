// app/api/ipfs/presign/route.js
//
// Hands the browser a URL it can upload straight to, bypassing the 4.5 MB Vercel function
// payload limit that caps /api/ipfs/file. Video is the reason this exists — a phone clip
// clears that limit within a couple of seconds of footage.
//
// Filebase is the pinner for small uploads too, so CIDs come from the same place either way.
// It speaks S3 rather than a bespoke signed-upload API, which means the CID is not known at
// signing time — the client uploads to a key we choose, then resolves that key to a CID via
// /api/ipfs/cid.

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { shortUploadError } from '@/lib/uploadErrors'
import { FREE_VIDEO_MB, PREMIUM_VIDEO_MB } from '@/lib/premium'
import { readPremium } from '@/lib/premiumServer'

export const dynamic = 'force-dynamic'

/* This route is unauthenticated, so the ceiling is enforced here rather than trusted from the
   client. Kept in step with MAX_VIDEO_SIZE_MB in NewPost.jsx, plus headroom for the container
   overhead a re-muxed upload can carry. */
const MAX_UPLOAD_BYTES = (FREE_VIDEO_MB + 5) * 1024 * 1024

/* What a premium subscriber may upload instead. The claim is a plain `address` in the body and
   this route has no session to check it against, so a caller who names someone else's premium
   wallet gets the larger ceiling too — premium addresses are public. That is a soft gate on
   purpose: it bounds the abuse to one oversized file rather than pretending to be auth. Making
   it binding needs the signed-nonce flow /api/v1/auth/nonce already implements for push
   notifications, which is a separate change. */
const MAX_PREMIUM_UPLOAD_BYTES = (PREMIUM_VIDEO_MB + 5) * 1024 * 1024

const SIGNED_URL_TTL_SECONDS = 600

const filebaseConfigured = () =>
  Boolean(process.env.FILEBASE_S3_KEY && process.env.FILEBASE_S3_SECRET && process.env.FILEBASE_S3_BUCKET)

/* Filebase exposes an S3-compatible endpoint; path-style addressing keeps the bucket out of the
   hostname so a bucket name with dots can't break TLS validation. */
const s3 = () =>
  new S3Client({
    region: 'auto',
    endpoint: 'https://s3.filebase.io',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.FILEBASE_S3_KEY,
      secretAccessKey: process.env.FILEBASE_S3_SECRET,
    },
  })

/* Only the extension survives from the client-supplied name — the key itself is a UUID, so a
   crafted filename can't traverse the bucket or collide with an existing object. */
function safeKey(name) {
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(name || '')?.[1]?.toLowerCase()
  return `uploads/${randomUUID()}${extension ? `.${extension}` : ''}`
}

async function filebasePresign({ name, mimeType, size }) {
  const key = safeKey(name)

  const command = new PutObjectCommand({
    Bucket: process.env.FILEBASE_S3_BUCKET,
    Key: key,
    ContentType: mimeType || 'application/octet-stream',
    ContentLength: size,
  })

  /* Signing content-length as well as content-type is what makes MAX_UPLOAD_BYTES binding:
     the upload is rejected at the edge unless the body is exactly the size that was declared
     here, so an oversized file can't ride in on a URL signed for a small one. */
  const url = await getSignedUrl(s3(), command, {
    expiresIn: SIGNED_URL_TTL_SECONDS,
    signableHeaders: new Set(['content-length', 'content-type']),
  })

  return { provider: 'filebase', url, key, method: 'PUT' }
}

export async function POST(request) {
  try {
    const { name, mimeType, size, address } = await request.json()

    const declaredSize = Number(size)
    if (!Number.isInteger(declaredSize) || declaredSize <= 0) {
      return NextResponse.json({ error: 'A positive integer size is required' }, { status: 400 })
    }

    /* Only asked when the file actually needs the larger ceiling, so an ordinary upload still
       costs zero database work. */
    let ceiling = MAX_UPLOAD_BYTES
    if (declaredSize > MAX_UPLOAD_BYTES && address) {
      const status = await readPremium(address).catch(() => null)
      if (status?.premium) ceiling = MAX_PREMIUM_UPLOAD_BYTES
    }

    if (declaredSize > ceiling) {
      return NextResponse.json({ error: `File exceeds the ${Math.floor(ceiling / (1024 * 1024))}MB upload limit` }, { status: 413 })
    }

    if (!filebaseConfigured()) {
      return NextResponse.json({ error: 'Large uploads are not configured on this deployment' }, { status: 503 })
    }

    return NextResponse.json(await filebasePresign({ name, mimeType, size: declaredSize }))
  } catch (e) {
    console.error('Presign error:', e)
    return NextResponse.json({ error: shortUploadError(e, 'Could not create an upload URL') }, { status: 502 })
  }
}
