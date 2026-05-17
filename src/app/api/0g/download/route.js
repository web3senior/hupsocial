import { Indexer } from "@0gfoundation/0g-ts-sdk"
import { NextResponse } from "next/server"

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const rootHash = searchParams.get('hash')

  if (!rootHash) {
    return NextResponse.json({ error: 'Root Hash is required' }, { status: 400 })
  }

  try {
    // Initialize Indexer using the Turbo mode testnet endpoint
    const INDEXER_RPC = process.env.INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai'
    const indexer = new Indexer(INDEXER_RPC)

    // Execute download from the 0G network into an in-memory blob structure
    const [blob, dlErr] = await indexer.downloadToBlob(rootHash)

    if (dlErr !== null) {
      throw new Error(`0G Indexer Download Error: ${dlErr}`)
    }

    // Extract array buffer from the returned blob payload
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Stream the binary asset payload back with aggressive edge caching headers
    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })

  } catch (error) {
    console.error('0G_API_ROUTE_ERROR:', error)
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' }, 
      { status: 500 }
    )
  }
}