/**
 * @file api/v1/nfts/inspect/route.js
 * @description Decodes one token on demand: the pointer chain layer by layer, the outside
 * resources its artwork loads, the contracts that took part in rendering, the standards it
 * speaks and whether any of it can change. Nothing is written anywhere — the answer is kept
 * in memory for a few minutes so a shared link does not re-probe the gateways on every open.
 */

import { NextResponse } from 'next/server'
import { appChains } from '@/config/contracts'
import { inspectToken } from '@/lib/nftInspectServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The gateways and the access-list trace each get seconds, not the platform's default handful
export const maxDuration = 60

const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
const MEMO_TTL_MS = 5 * 60 * 1000
const MEMO_LIMIT = 200

// Survives hot reloads like the public clients do; one map per process
const globalStore = globalThis
const memo = globalStore.__hupTokenInspections ?? new Map()
if (process.env.NODE_ENV !== 'production') globalStore.__hupTokenInspections = memo

const remember = (key, promise) => {
  memo.set(key, { promise, until: Date.now() + MEMO_TTL_MS })
  if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value)
}

const isTokenId = (value) => /^(\d{1,78}|0x[0-9a-fA-F]{1,64})$/.test(String(value || ''))

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const networkId = Number(searchParams.get('networkId'))
  const address = String(searchParams.get('address') || '').trim()
  const tokenId = String(searchParams.get('tokenId') || '').trim()
  const fresh = searchParams.get('fresh') === '1'

  if (!appChains.some((chain) => chain.id === networkId)) {
    return NextResponse.json({ success: false, error: 'That network is not supported' }, { status: 400 })
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ success: false, error: 'A collection address is required' }, { status: 400 })
  }
  if (!isTokenId(tokenId)) {
    return NextResponse.json({ success: false, error: 'A token id is required — a number, or a bytes32 hex value for LSP8' }, { status: 400 })
  }

  const key = `${networkId}:${address.toLowerCase()}:${tokenId.toLowerCase()}`
  const cached = memo.get(key)
  let promise = !fresh && cached && cached.until > Date.now() ? cached.promise : null
  if (!promise) {
    promise = inspectToken({ chainId: networkId, collection: address, tokenId })
    remember(key, promise)
  }

  try {
    const data = await promise
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': fresh ? 'no-store' : CACHE_CONTROL } })
  } catch (error) {
    // A failed inspection is not worth remembering: the next reader may find the RPC back
    if (memo.get(key)?.promise === promise) memo.delete(key)
    const status = Number(error?.status) || 500
    if (status >= 500) console.error('[GET_NFT_INSPECT_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: status >= 500 && !error?.status ? 'Server error' : error.message }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
