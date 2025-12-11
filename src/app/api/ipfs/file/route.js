// app/api/ipfs/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'
// --- Configuration ---

// Initialize Pinata SDK using the JWT stored in environment variables
const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT, // process.env is automatically available in Next.js server environment
})

// Next.js configuration to tell the framework NOT to parse the request body as JSON/text.
// This is CRITICAL for handling file uploads (FormData).
// Example for file uploads (what you are likely trying to achieve)
// export const config = {
//   api: {
//     bodyParser: false, // This is deprecated for App Router, you should use the Request object
//   }
// }
// For App Router, you would typically use this:
export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Note: When handling FormData/file uploads, Next.js handles the request body parsing automatically.
// The issue here is likely an old config structure being used.
// ---------------------

export async function POST(request) {
  // User's wallet address
  // const address = request.nextUrl.searchParams.get('address')

  try {
    // 1. Get the FormData object sent from the client
    const data = await request.formData()
    // 'file' is the key used in the client-side FormData.set() call
    const file = data.get('file')

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // 2. Pin the file to IPFS using the Pinata SDK
    console.log(`Attempting to upload file: ${file.name}`)

    const { cid } = await pinata.upload.public.file(file, {
      pinataMetadata: { name: `${file.name}` },
    })

    const url = `${process.env.NEXT_PUBLIC_GATEWAY_URL}${cid}`
    console.log(`File uploaded successfully. CID: ${cid}`)
    return NextResponse.json({ url, cid }, { status: 200 })
  } catch (e) {
    console.error('Pinata upload error:', e)
    return NextResponse.json({ error: 'Internal Server Error during upload' }, { status: 500 })
  }
}
