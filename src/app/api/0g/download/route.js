import { Indexer } from "@0gfoundation/0g-ts-sdk"
import { NextResponse } from "next/server"
import sharp from "sharp"

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const rootHash = searchParams.get('hash')
  
  // Extract custom optimization parameters from the query string
  const width = searchParams.get('w')
  const quality = searchParams.get('q') || '80'

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

    // Instantiate the Sharp transformation pipeline with the raw asset bytes
    let pipeline = sharp(buffer)

    // Execute conditional resizing if a target width parameter is supplied
    if (width) {
      pipeline = pipeline.resize({
        width: parseInt(width, 10),
        withoutEnlargement: true, // Prevents upscaling small avatars layout shifts
      })
    }

    // Force transform format to WebP and apply variable quality compression structural layouts
    const optimizedBuffer = await pipeline
      .webp({ quality: parseInt(quality, 10) })
      .toBuffer()

    // Stream the highly optimized binary layout back to the client browser engine
    return new Response(optimizedBuffer, {
      headers: {
        'Content-Type': 'image/webp', // Explicitly declare updated format type
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