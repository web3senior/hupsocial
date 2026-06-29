// app/api/ipfs/object/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
})

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function uploadToFilebase(json) {
  const form = new FormData()
  form.append(
    'file',
    new Blob([JSON.stringify(json)], { type: 'application/json' }),
    'metadata.json'
  )

  const res = await fetch('https://rpc.filebase.io/api/v0/add', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FILEBASE_IPFS_RPC_TOKEN}`,
    },
    body: form,
  })

  if (!res.ok) throw new Error(`Filebase RPC ${res.status}: ${await res.text()}`)

  const { Hash } = await res.json()
  console.log('[filebase] uploaded, CID:', Hash)
  return Hash
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
    } catch (e) {
      console.warn('[filebase] upload failed, falling back to Pinata:', e.message)
      rawCID = await uploadToPinata(json)
    }

    const cid = `ipfs://${rawCID}`
    const url = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}${rawCID}`
    console.log('Upload complete. CID:', cid)
    return NextResponse.json({ url, cid }, { status: 200 })
  } catch (e) {
    console.error('JSON upload error:', e)
    return NextResponse.json({ error: 'Internal Server Error during JSON upload' }, { status: 500 })
  }
}
