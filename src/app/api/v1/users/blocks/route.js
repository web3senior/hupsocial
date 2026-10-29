import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { isSolanaAddress, isWalletAddress, normalizeAddress } from '@/lib/address'
import { BlockError, readUserBlocks, saveUserBlock } from '@/lib/blockUsers'
import { verifySolanaBlockSignature } from '@/lib/blockSolanaSignature'
import { verifyWalletSignature } from '@/lib/walletSignature'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request) {
  const address = normalizeAddress(new URL(request.url).searchParams.get('address'))
  if (!isWalletAddress(address)) return NextResponse.json({ success: false, error: 'A valid wallet address is required' }, { status: 400, headers })
  try {
    return NextResponse.json({ success: true, data: await readUserBlocks(pool, address) }, { headers })
  } catch (error) {
    console.error('[USER_BLOCKS_READ_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Could not load blocked users' }, { status: 500, headers })
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const claim = await saveUserBlock(pool, body, (address, message, signature, options) =>
      isSolanaAddress(address)
        ? verifySolanaBlockSignature(address, message, signature)
        : verifyWalletSignature(address, message, signature, options)
    )
    return NextResponse.json({ success: true, target: claim.target, blocked: claim.blocked }, { headers })
  } catch (error) {
    if (!(error instanceof BlockError)) console.error('[USER_BLOCKS_WRITE_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: error instanceof BlockError ? error.message : 'Could not save blocked users' }, { status: error instanceof BlockError ? error.status : 500, headers })
  }
}
