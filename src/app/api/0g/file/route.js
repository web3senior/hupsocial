import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk'
import { ethers } from 'ethers'
import { NextResponse } from 'next/server'

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
