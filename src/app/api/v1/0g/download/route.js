import { Indexer } from "@0gfoundation/0g-ts-sdk"
import { NextResponse } from "next/server"

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const rootHash = searchParams.get('hash')

  if (!rootHash) {
    return NextResponse.json({ error: 'Root Hash is required' }, { status: 400 })
  }

  try {
    // 1. Initialize Indexer (Turbo mode recommended per docs)
    const INDEXER_RPC = process.env.INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai'
    const indexer = new Indexer(INDEXER_RPC)

    // 2. Use downloadToBlob (The recommended way for in-memory/web handling)
    // Returns [Blob, Error | null]
    const [blob, dlErr] = await indexer.downloadToBlob(rootHash, {
      //proof: true, // Enables Merkle proof verification
    })

    if (dlErr !== null) {
      throw new Error(`0G Indexer Download Error: ${dlErr}`)
    }

    // 3. Convert SDK Blob to Node.js Buffer for the Response
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 4. Return the file with appropriate headers
    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png', // You can dynamically detect this if needed
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