// app/api/ipfs/file/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
})

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function uploadToFilebase(file) {
  const form = new FormData()
  form.append('file', file, file.name)

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

async function uploadToPinata(file) {
  const result = await pinata.upload.public.file(file, {
    pinataMetadata: { name: file.name },
  })
  console.log('[pinata] uploaded, CID:', result.cid)
  return result.cid
}

export async function POST(request) {
  try {
    const data = await request.formData()
    const file = data.get('file')

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    console.log(`Uploading file: ${file.name}`)

    let rawCID
    try {
      rawCID = await uploadToFilebase(file)
    } catch (e) {
      console.warn('[filebase] upload failed, falling back to Pinata:', e.message)
      rawCID = await uploadToPinata(file)
    }

    const cid = `ipfs://${rawCID}`
    const url = `${process.env.NEXT_PUBLIC_GATEWAY_URL}${rawCID}`
    console.log('Upload complete. CID:', cid)
    return NextResponse.json({ url, cid }, { status: 200 })
  } catch (e) {
    console.error('File upload error:', e)
    return NextResponse.json({ error: 'Internal Server Error during upload' }, { status: 500 })
  }
}
