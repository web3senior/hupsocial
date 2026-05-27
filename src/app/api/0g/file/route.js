import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk'
import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import sharp from "sharp"

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req) {
  try {
    // Extract file from FormData
    const formData = await req.formData()
    const file = formData.get('file')

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Convert File object to Buffer for the SDK
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Initialize 0G SDK components
    // Ensure these are defined in your .env.local
    const RPC_URL = process.env.RPC_URL
    const INDEXER_RPC = process.env.INDEXER_RPC
    const PRIVATE_KEY = process.env.PRIVATE_KEY

    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const signer = new ethers.Wallet(PRIVATE_KEY, provider)
    const indexer = new Indexer(INDEXER_RPC)

    // Use MemData for in-memory file handling
    const zgFile = new MemData(buffer)

    // Populate Merkle Tree state
    const [tree, treeErr] = await zgFile.merkleTree()
    if (treeErr !== null) {
      throw new Error(`Merkle tree error: ${treeErr}`)
    }

    // Upload to 0G Storage
    const [tx, uploadErr] = await indexer.upload(zgFile, RPC_URL, signer)
    if (uploadErr !== null) {
      throw new Error(`Upload error: ${uploadErr}`)
    }

    // Format response
    const result =
      'rootHash' in tx
        ? {
            rootHash: tx.rootHash,
            cid: `0g://${tx.rootHash}`,
            txHash: tx.txHash,
            url: `${process.env.INDEXER_RPC}${tx.rootHash}`,
          }
        : { rootHashes: tx.rootHashes, txHashes: tx.txHashes }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Upload failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

function intParam(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const rootHash = searchParams.get("hash")

  const width = intParam(searchParams.get("w"), null, 1, 4096)
  const quality = intParam(searchParams.get("q"), 80, 1, 100)

  if (!rootHash) {
    return NextResponse.json({ error: "Root Hash is required" }, { status: 400 })
  }

  try {
    const INDEXER_RPC =
      process.env.INDEXER_RPC || "https://indexer-storage-testnet-turbo.0g.ai"

    const indexer = new Indexer(INDEXER_RPC)
    const [blob, dlErr] = await indexer.downloadToBlob(rootHash)

    if (dlErr !== null) {
      throw new Error(`0G Indexer Download Error: ${dlErr}`)
    }

    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const metadata = await sharp(buffer, { animated: true }).metadata()
    const isAnimated = (metadata.pages ?? 1) > 1

    let pipeline = sharp(buffer, { animated: true })

    if (width) {
      pipeline = pipeline.resize({
        width,
        withoutEnlargement: true,
      })
    }

    const optimizedBuffer = await pipeline
      .webp({
        quality,
        ...(isAnimated
          ? {
              loop: metadata.loop ?? 0,
              ...(metadata.delay ? { delay: metadata.delay } : {}),
            }
          : {}),
      })
      .toBuffer()

    return new Response(optimizedBuffer, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (error) {
    console.error("0G_API_ROUTE_ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    )
  }
}