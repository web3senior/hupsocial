/**
 * @file api/v1/launches/[networkId]/[id]/route.js
 * @description Fetches a single indexed Hup Launch, so the launch page and the in-post card show
 * correct data regardless of which chain the viewer's wallet is connected to. Optionally includes
 * the viewer's position (`holder` param). Hidden (moderated) launches are still served here — the
 * pool is permissionless and holders must always be able to reach their position — the directory
 * is where hidden rows are suppressed.
 *
 * The `[id]` segment takes either identity: the token's contract address, which is what the pages
 * are keyed on now, or the sequential launch id, which is what every link shared before that and
 * every in-post card written against the old shape still carries. Both are unique per network.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'
import { attachQuoteAssets } from '@/lib/stockTokens'
import { hasTable } from '@/lib/schema'
import { parseTokenRef } from '@/lib/tokenRef'
import { TOKEN_PAGE_FIELDS, TOKEN_PAGE_TABLE, emptyTokenPage, serializeTokenPage } from '@/lib/tokenPage'

export const runtime = 'nodejs'

// Both identities are unique per network in the schema (uniq_launch, uniq_launch_token), so
// either one selects at most a single row and neither needs a tiebreak
const refColumn = (ref) => (ref.kind === 'address' ? 'l.token' : 'l.launch_id')
const refValue = (ref) => (ref.kind === 'address' ? ref.address : ref.launchId)

export async function GET(request, { params }) {
  try {
    const { networkId: rawNetworkId, id: rawRef } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(rawNetworkId) || null
    const holder = (searchParams.get('holder') || '').toLowerCase() || null
    const ref = parseTokenRef(rawRef)

    if (!networkId || !ref) {
      return NextResponse.json(
        { success: false, error: 'networkId and a token address or launch id are required' },
        { status: 400 },
      )
    }

    // The creator's landing-page copy lives in its own table and may not have been migrated on
    // production yet — a launch without one still has to serve, so the join is conditional
    const pageTableExists = await hasTable(TOKEN_PAGE_TABLE)
    const pageColumns = pageTableExists
      ? `, p.tagline, p.about, p.banner_cid, p.website, p.x_handle, p.telegram, p.discord, p.farcaster,
         p.links, p.updated_at AS page_updated_at`
      : ''
    const pageJoin = pageTableExists
      ? `LEFT JOIN ${TOKEN_PAGE_TABLE} p ON p.network_id = l.network_id AND p.token_address = l.token`
      : ''

    const [rows] = await pool.execute(
      `SELECT
         l.network_id, l.launch_id, l.creator AS wallet_address, l.token, l.quote, l.pool_id, l.position_token_id,
         l.name, l.symbol, l.creator_share_bps,
         CAST(l.opening_price AS CHAR) AS opening_price,
         CAST(l.price AS CHAR) AS price,
         l.metadata_cid, l.description, l.image_cid, l.hidden,
         l.trade_count, CAST(l.volume_native AS CHAR) AS volume_native, l.holder_count,
         l.last_trade_at, l.created_at, l.created_block, l.tx_hash,
         u.name AS display_name, u.profileImage AS profile_image${pageColumns}
       FROM launches l
       LEFT JOIN users u ON u.wallet_address = l.creator
       ${pageJoin}
       WHERE l.network_id = ? AND ${refColumn(ref)} = ?
       LIMIT 1`,
      [networkId, refValue(ref)],
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Launch not found' }, { status: 404 })
    }

    const launch = rows[0]
    await fulfillUniversalProfiles([launch], pool)

    // Lifted into its own object rather than left flat: `about` beside `description` and
    // `updated_at` beside `created_at` are exactly the pairs a caller would confuse
    launch.page = pageTableExists ? serializeTokenPage(launch) : emptyTokenPage()
    for (const field of [...TOKEN_PAGE_FIELDS, 'page_updated_at']) delete launch[field]

    // The card and the holder list both quote in dollars, so the asset the launch is priced in
    // is converted once here rather than per client
    const priceKey = priceKeyFor(networkId, launch.quote)
    const usd = priceKey ? (await fetchUsdPrices([priceKey])).get(priceKey) : null
    launch.quote_usd = usd ?? null

    // Every figure on the page is raw base units of the quote asset, so its ticker and decimals
    // ride along — the client reads decimals onchain before it spends anything, but nothing on
    // screen should wait for that round trip to render at the right scale
    await attachQuoteAssets([launch])

    // Net position from indexed trades. The wallet's live token balance is the authority and the
    // card reads it onchain; this is the cost basis the chain can't tell you, so the card can
    // show what the holder actually paid alongside what it is worth now.
    let position = null
    if (holder) {
      const [positionRows] = await pool.execute(
        `SELECT
           CAST(COALESCE(SUM(CASE WHEN side = 0 THEN token_amount ELSE -token_amount END), 0) AS CHAR) AS net_tokens,
           CAST(COALESCE(SUM(CASE WHEN side = 0 THEN native_amount ELSE 0 END), 0) AS CHAR) AS native_in,
           CAST(COALESCE(SUM(CASE WHEN side = 1 THEN native_amount ELSE 0 END), 0) AS CHAR) AS native_out,
           COUNT(*) AS trade_count
         FROM launch_trades
         WHERE network_id = ? AND launch_id = ? AND trader = ?`,
        [networkId, launch.launch_id, holder],
      )
      position = Number(positionRows[0]?.trade_count) > 0 ? positionRows[0] : null
    }

    return NextResponse.json({ success: true, data: launch, ...(position ? { position } : {}) })
  } catch (error) {
    console.error('[GET_LAUNCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
