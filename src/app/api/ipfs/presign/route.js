import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'

const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_JWT })

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const { name, mimeType } = await request.json()

    const url = await pinata.upload.public.createSignedURL({
      expires: 120,
      name: name ?? 'upload',
      ...(mimeType ? { mimeTypes: [mimeType] } : {}),
    })

    return NextResponse.json({ url })
  } catch (e) {
    console.error('Presign error:', e)
    return NextResponse.json({ error: 'Could not create signed URL' }, { status: 500 })
  }
}
