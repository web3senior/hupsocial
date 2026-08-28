// app/api/ipfs/object/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
import { addToFilebase } from '@/lib/filebase'
import { bothProvidersFailed, shortUploadError } from '@/lib/uploadErrors'
import { gatewayUrl } from '@/lib/ipfsGateways'

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
