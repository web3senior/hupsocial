/**
 * @file api/v1/tokens/solana/status/route.js
 * @description Whether a Solana signature has landed, and whether it failed.
 *
 * Same reason the account route exists: the public clusters refuse browser callers, so the
 * widget cannot poll its own transaction. The wallet broadcasts through its own RPC and hands
 * back a signature; this is how the card learns what became of it.
 */

import { NextResponse } from 'next/server'
import { Connection } from '@solana/web3.js'
import { canTradeOnSolana, solanaChainFor } from '@/config/solana'

export const runtime = 'nodejs'

// base58, and long enough that nothing else is shaped like it
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/

const connections = new Map()
const connectionFor = (chain) => {
  if (!connections.has(chain.id)) connections.set(chain.id, new Connection(chain.rpcUrl, { commitment: 'confirmed' }))
  return connections.get(chain.id)
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = Number(searchParams.get('networkId'))
    const signature = searchParams.get('signature') || ''

    if (!canTradeOnSolana(networkId)) {
      return NextResponse.json({ success: false, error: 'Not a tradeable Solana cluster' }, { status: 400 })
    }
    if (!SIGNATURE_PATTERN.test(signature)) {
      return NextResponse.json({ success: false, error: 'signature is required' }, { status: 400 })
    }

    const { value } = await connectionFor(solanaChainFor(networkId)).getSignatureStatuses([signature])
    const status = value?.[0] ?? null

    return NextResponse.json({
      success: true,
      data: {
        // Null means the cluster has not seen it yet, which is not the same as failed — the
        // caller keeps polling rather than reporting a loss
        found: Boolean(status),
        confirmed: status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized',
        failed: Boolean(status?.err),
      },
    })
  } catch (error) {
    console.error('Solana status read failed:', error)
    return NextResponse.json({ success: false, error: 'Could not read that signature' }, { status: 502 })
  }
}
