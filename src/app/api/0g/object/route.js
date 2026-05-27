import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk'
import { ethers } from 'ethers'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req) {
  try {
    // Accept JSON only
    const contentType = req.headers.get('content-type') || ''

    if (!contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 400 }
      )
    }

    // Extract JSON body
    const jsonData = await req.json()

    if (!jsonData || typeof jsonData !== 'object') {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    // Convert JSON to Buffer for the SDK
    const jsonString = JSON.stringify(jsonData)
    const buffer = Buffer.from(jsonString, 'utf-8')

    // Initialize 0G SDK components
    const RPC_URL = process.env.RPC_URL
    const INDEXER_RPC = process.env.INDEXER_RPC
    const PRIVATE_KEY = process.env.PRIVATE_KEY

    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const signer = new ethers.Wallet(PRIVATE_KEY, provider)
    const indexer = new Indexer(INDEXER_RPC)

    // Use MemData for in-memory JSON handling
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
        : {
            rootHashes: tx.rootHashes,
            txHashes: tx.txHashes,
          }

    return NextResponse.json(result)
  } catch (error) {
    console.error('JSON upload failed:', error)

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const rootHash = searchParams.get('hash')

  if (!rootHash) {
    return NextResponse.json(
      { error: 'Root Hash is required' },
      { status: 400 }
    )
  }

  try {
    const INDEXER_RPC =
      process.env.INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai'

    const indexer = new Indexer(INDEXER_RPC)

    // Download JSON blob from 0G Storage
    const [blob, dlErr] = await indexer.downloadToBlob(rootHash)

    if (dlErr !== null) {
      throw new Error(`0G Indexer Download Error: ${dlErr}`)
    }

    // Convert blob to text
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const jsonString = buffer.toString('utf-8')

    // Parse JSON
    let data
    try {
      data = JSON.parse(jsonString)
    } catch {
      return NextResponse.json(
        { error: 'Downloaded file is not valid JSON' },
        { status: 422 }
      )
    }

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('0G_JSON_DOWNLOAD_ERROR:', error)

    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}