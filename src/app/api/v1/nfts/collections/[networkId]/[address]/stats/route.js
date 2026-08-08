/**
 * @file api/v1/nfts/collections/[networkId]/[address]/stats/route.js
 * @description Lifetime market stats for one collection, read off the cidex-indexed
 * nft_trades table — what this collection's NFTs have actually traded for through HupTrade:
 * total volume, the highest single sale, how many sales settled and how many distinct NFTs
 * changed hands. The collection header's stat row reads from here.
 *
 * Currency rule matches the floor everywhere else in the app (collections/route.js,
 * lib/nftFloorHistory): a collection can trade in several tokens, and summing across them
 * would add 1 ETH to 1 USDC — so volume and the high sale are computed per payment token and
 * the token carrying the most sales wins. `currencies` reports how many were left out, so the
 * UI can say the total is quoted in one of them rather than implying it covers all.
 *
 * Sales in the native coin come back with null symbol/decimals — store_tokens has no row for
 * a chain's own currency — and the client fills both in from its chain config, exactly like
 * the floor chart already does.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

// Trades only ever append, so a minute of staleness costs nothing but saves the two
// aggregate scans on every navigation back to the page
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

export async function GET(request, { params }) {
  try {
    const { networkId, address } = await params

    if (!/^\d+$/.test(String(networkId)) || !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return NextResponse.json({ success: false, error: 'A numeric networkId and a collection address are required' }, { status: 400 })
    }

    const chainId = Number(networkId)
    const collection = address.toLowerCase()

    // Split in two on purpose: the totals are per-currency (see the header), while "how many
    // NFTs changed hands" is a fact about tokens and stays currency-blind
    const [[currencies], [totalRows]] = await Promise.all([
      pool.execute(
        `SELECT t.payment_token,
                COUNT(*) AS sale_count,
                CAST(SUM(CAST(t.price AS DECIMAL(65,0))) AS CHAR) AS volume,
                CAST(MAX(CAST(t.price AS DECIMAL(65,0))) AS CHAR) AS highest_sale,
                st.symbol, st.decimals
           FROM nft_trades t
           LEFT JOIN store_tokens st ON st.network_id = t.network_id AND st.token = t.payment_token
          WHERE t.network_id = ? AND t.collection = ?
          GROUP BY t.payment_token, st.symbol, st.decimals
          ORDER BY sale_count DESC`,
        [chainId, collection],
      ),
      pool.execute(
        `SELECT COUNT(*) AS sale_count, COUNT(DISTINCT t.token_id) AS items_sold
           FROM nft_trades t
          WHERE t.network_id = ? AND t.collection = ?`,
        [chainId, collection],
      ),
    ])

    const totals = totalRows[0]
    // Ordered by sale count, so the first group is the collection's dominant currency
    const dominant = currencies[0] || null

    return NextResponse.json(
      {
        success: true,
        data: {
          volume: dominant?.volume || null,
          highest_sale: dominant?.highest_sale || null,
          payment_token: dominant?.payment_token || null,
          symbol: dominant?.symbol ?? null,
          decimals: dominant?.decimals ?? null,
          // Sales quoted in the dominant currency, against every sale in any currency
          quoted_sales: Number(dominant?.sale_count || 0),
          sale_count: Number(totals?.sale_count || 0),
          items_sold: Number(totals?.items_sold || 0),
          currencies: currencies.length,
        },
      },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_STATS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
