// app/api/ipfs/route.js

import { NextResponse } from 'next/server'
import { PinataSDK } from 'pinata'

// --- Configuration ---

const pinata = new PinataSDK({
    pinataJwt: process.env.PINATA_JWT,
})

// *** IMPORTANT FIX: REMOVE THE bodyParser: false CONFIGURATION ***
// By removing it, Next.js will automatically parse the JSON body 
// when the client sends Content-Type: application/json.
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
    try {
        // 1. Get the JSON object sent from the client
        // Next.js automatically parses the JSON body here
        const json = await request.json() 

        if (!json) {
            return NextResponse.json({ error: 'No JSON data provided' }, { status: 400 })
        }

        // 2. Pin the JSON object to IPFS using the Pinata SDK
        console.log(`Attempting to upload JSON object...`)

        // Use the Pinata 'json' upload method.
        const { cid } = await pinata.upload.public.json(json, { 
            pinataMetadata: { name: `hup-metadata` },
        })

        const url = `${process.env.NEXT_PUBLIC_GATEWAY_URL}${cid}`
        console.log(`JSON object uploaded successfully. CID: ${cid}`)
        return NextResponse.json({ url, cid }, { status: 200 })
    } catch (e) {
        console.error('Pinata JSON upload error:', e)
        // Provide a clearer error message for debugging
        return NextResponse.json({ error: 'Internal Server Error during JSON upload' }, { status: 500 })
    }
}