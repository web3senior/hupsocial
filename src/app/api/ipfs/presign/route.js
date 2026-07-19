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
      /* Unauthenticated route — cap the signed upload at the client-side media limit */
      maxFileSize: 6 * 1024 * 1024,
      ...(mimeType ? { mimeTypes: [mimeType] } : {}),
    })

    return NextResponse.json({ url })
  } catch (e) {
    console.error('Presign error:', e)
    const overLimit = typeof e?.message === 'string' && e.message.includes('plan limits')
    return NextResponse.json(
      { error: overLimit ? 'Storage provider is over its plan limits' : 'Could not create signed URL' },
      { status: 502 }
    )
  }
}
