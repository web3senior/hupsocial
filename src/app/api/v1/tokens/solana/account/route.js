/**
 * @file api/v1/tokens/solana/account/route.js
 * @description The three reads the in-post trade widget needs off a Solana cluster: a mint's
 * decimals and symbol, the viewer's SOL balance, and the viewer's balance of that mint.
 *
 * This exists because the browser cannot do it. The public cluster endpoints answer a browser
 * request with `403` and `access-control-allow-origin: backend_traffic` — they serve server
 * callers only. Jupiter, by contrast, does send CORS headers, so quotes go straight from the
 * browser (see lib/solanaSwap.js) and only these reads are relayed.
 *
 * Purpose-built rather than a general RPC proxy: a proxy that forwards any method is an open
 * relay against whatever endpoint it is pointed at.
 */

import { NextResponse } from 'next/server'
import { Connection, PublicKey } from '@solana/web3.js'
import { canTradeOnSolana, solanaChainFor } from '@/config/solana'

export const runtime = 'nodejs'

// Balances move with every trade, so this is barely cacheable — but a feed holding several
// cards of the same token would otherwise ask once per card on every poll
const CACHE_CONTROL = 'private, max-age=5'

const connections = new Map()
const connectionFor = (chain) => {
  if (!connections.has(chain.id)) connections.set(chain.id, new Connection(chain.rpcUrl, { commitment: 'confirmed' }))
  return connections.get(chain.id)
}

/** Parses a base58 key, or null — an invalid one is a bad request, never a thrown 500. */
const asKey = (value) => {
  try {
    return value ? new PublicKey(value) : null
  } catch {
    return null
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = Number(searchParams.get('networkId'))
    const mint = asKey(searchParams.get('mint'))
    const owner = asKey(searchParams.get('owner'))

    if (!canTradeOnSolana(networkId)) {
      return NextResponse.json({ success: false, error: 'Not a tradeable Solana cluster' }, { status: 400 })
    }
    if (!mint) {
      return NextResponse.json({ success: false, error: 'mint is required' }, { status: 400 })
    }

    const connection = connectionFor(solanaChainFor(networkId))

    // The mint account carries its own decimals; nothing the post claims is trusted for it,
    // exactly as the EVM side re-reads decimals() rather than believing the payload
    const mintInfo = await connection.getParsedAccountInfo(mint)
    const decimals = mintInfo?.value?.data?.parsed?.info?.decimals
    if (!Number.isFinite(decimals)) {
      return NextResponse.json({ success: false, error: 'No SPL mint at that address' }, { status: 404 })
    }

    let sol = null
    let balance = null
    if (owner) {
      // Both token programs: plenty of newer mints are Token-2022, and a widget that reported
      // "you hold none" for those would hide the Sell tab from people who do
      const [lamports, classic, token2022] = await Promise.all([
        connection.getBalance(owner),
        connection.getParsedTokenAccountsByOwner(owner, { mint }).catch(() => ({ value: [] })),
        connection
          .getParsedTokenAccountsByOwner(owner, { mint, programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') })
          .catch(() => ({ value: [] })),
      ])

      sol = String(lamports ?? 0)
      const accounts = [...(classic?.value ?? []), ...(token2022?.value ?? [])]
      const total = accounts.reduce(
        (sum, entry) => sum + BigInt(entry?.account?.data?.parsed?.info?.tokenAmount?.amount ?? '0'),
        0n,
      )
      balance = total.toString()
    }

    return NextResponse.json(
      { success: true, data: { decimals: Number(decimals), sol, balance } },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('Solana account read failed:', error)
    return NextResponse.json({ success: false, error: 'Could not read that account' }, { status: 502 })
  }
}
