/**
 * @file api/v1/nfts/collections/[networkId]/[address]/tokens/[tokenId]/route.js
 * @description Everything the market knows about one token — the record behind the token
 * detail panel's action card, Activity tab and Price History tab.
 *
 * The collection-scoped siblings answer their questions for a whole collection because a grid
 * asks them once per page. This one is the opposite shape: a reader has opened a single token,
 * and asking four routes (its listing, its best offer, its sales, its listing history) would be
 * four round trips to fill one panel. So it is one query per source, run together, merged here.
 *
 * `activity` is that merge: sales, listings, cancellations and offers on one timeline, newest
 * first. Every row carries the currency it was quoted in — a token can be listed in ETH and bid
 * on in USDC, and a timeline that dropped the symbol would read as though those numbers could be
 * compared.
 *
 * A cancelled listing has no cancellation timestamp of its own: cidex replays the row in place
 * and only `updated_at` moves. That is when the app learned, not when it happened, and the row
 * says so through `at_source` rather than passing an indexing time off as an onchain one.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'

export const runtime = 'nodejs'

// store_tokens has no row for the native coin; both the price helper and the client key it
// by the zero address
const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

// IHupTrade.ListingStatus / IHupOffers.OfferStatus, as cidex writes them
const LISTING_STATUS_ACTIVE = 1
const LISTING_STATUS_CANCELLED = 3
const OFFER_STATUS_ACTIVE = 1

// A token's history is short — a handful of listings and sales over its life. This only bounds
// a pathological id that has been listed and pulled a thousand times.
const ROW_LIMIT = 60

// Offers expire by the minute and a sale can land at any block, so this is a short-lived
// answer — the panel is a live trading surface, not a history page
const CACHE_CONTROL = 'public, max-age=15, s-maxage=60, stale-while-revalidate=300'

/**
 * Both id dialects, so a token can be asked for by either the form cidex stores or the plain
 * number a collection prints on its artwork.
 *
 * Writers store the bytes32 form for LSP8 and the decimal form for ERC721, but the panel opens
 * from places holding one or the other, and a URL is not where a caller should have to convert.
 * Matching both costs one extra value in an IN() against an indexed column.
 * @param {string} raw Token id from the URL, already trimmed.
 * @returns {string[]} Distinct forms to match, lowercased.
 */
function tokenIdForms(raw) {
  const value = raw.toLowerCase()
  const forms = new Set([value])

  try {
    if (value.startsWith('0x')) {
      // The number a padded bytes32 packs, for collections whose ids are plain integers
      forms.add(BigInt(value).toString())
    } else if (/^\d+$/.test(value)) {
      forms.add(`0x${BigInt(value).toString(16).padStart(64, '0')}`)
    }
  } catch {
    // An id that is neither — an opaque LSP8 hash, or a string id — matches only itself
  }

  return [...forms]
}

export async function GET(request, { params }) {
  try {
    const { networkId, address, tokenId } = await params

    if (!/^\d+$/.test(String(networkId)) || !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return NextResponse.json({ success: false, error: 'A numeric networkId and a collection address are required' }, { status: 400 })
    }

    const raw = decodeURIComponent(String(tokenId || '')).trim()
    if (!raw || raw.length > 78) {
      return NextResponse.json({ success: false, error: 'A token id is required' }, { status: 400 })
    }

    const chainId = Number(networkId)
    const collection = address.toLowerCase()
    const ids = tokenIdForms(raw)
    const idPlaceholders = ids.map(() => '?').join(',')
    const scope = [chainId, collection, ...ids]

    // Four independent reads of three tables — cheaper together than the four round trips the
    // panel would otherwise make
    const [[listings], [trades], [offers], [[topOffer]]] = await Promise.all([
      // Every listing this token has ever carried. The first backed active one is its live ask;
      // the rest are the Listed/Cancelled entries of the timeline.
      pool.execute(
        `SELECT l.listing_id, l.seller, CAST(l.price AS CHAR) AS price, l.payment_token, l.is_lsp7,
                l.is_lsp8, l.referral_bps, l.status, l.backed, l.listed_at, l.tx_hash,
                UNIX_TIMESTAMP(l.updated_at) AS updated_at,
                st.symbol, st.decimals
           FROM nft_listings l
           LEFT JOIN store_tokens st ON st.network_id = l.network_id AND st.token = l.payment_token
          WHERE l.network_id = ? AND l.collection = ? AND l.token_id IN (${idPlaceholders})
          ORDER BY l.listed_at DESC
          LIMIT ?`,
        [...scope, ROW_LIMIT],
      ),
      pool.execute(
        `SELECT t.listing_id, t.seller, t.buyer, CAST(t.price AS CHAR) AS price, t.payment_token,
                t.sold_at, t.tx_hash, st.symbol, st.decimals
           FROM nft_trades t
           LEFT JOIN store_tokens st ON st.network_id = t.network_id AND st.token = t.payment_token
          WHERE t.network_id = ? AND t.collection = ? AND t.token_id IN (${idPlaceholders})
          ORDER BY t.block_number DESC, t.log_index DESC
          LIMIT ?`,
        [...scope, ROW_LIMIT],
      ),
      pool.execute(
        // Whether an offer can still be filled is settled here rather than in the browser: it
        // turns on a comparison against chain time, and a reader whose clock is off by an hour
        // would otherwise be shown a dead offer as live (or the reverse)
        `SELECT o.offer_id, o.offerer, CAST(o.price AS CHAR) AS price, o.payment_token, o.status,
                o.made_at, o.expires_at, o.tx_hash, st.symbol, st.decimals,
                (o.status = ? AND o.expires_at > UNIX_TIMESTAMP()) AS is_live
           FROM nft_offers o
           LEFT JOIN store_tokens st ON st.network_id = o.network_id AND st.token = o.payment_token
          WHERE o.network_id = ? AND o.collection = ? AND o.token_id IN (${idPlaceholders})
          ORDER BY o.made_at DESC
          LIMIT ?`,
        [OFFER_STATUS_ACTIVE, ...scope, ROW_LIMIT],
      ),
      // The one number the action card prints, so it never has to rank a page of offers itself.
      // Highest escrowed price among the fillable rows; offers on a single token are near-always
      // priced alike, and the row carries its symbol either way.
      pool.execute(
        `SELECT CAST(o.price AS CHAR) AS price, o.payment_token, o.offerer, o.offer_id,
                o.expires_at, st.symbol, st.decimals
           FROM nft_offers o
           LEFT JOIN store_tokens st ON st.network_id = o.network_id AND st.token = o.payment_token
          WHERE o.network_id = ? AND o.collection = ? AND o.token_id IN (${idPlaceholders})
            AND o.status = ? AND o.expires_at > UNIX_TIMESTAMP()
          ORDER BY CAST(o.price AS DECIMAL(65,0)) DESC
          LIMIT 1`,
        [...scope, OFFER_STATUS_ACTIVE],
      ),
    ])

    // Only a backed active row is an ask anyone can fill — an unbacked one is a price with no
    // NFT behind it, exactly as the grid and the collection floor already treat it
    const active = listings.find((row) => Number(row.status) === LISTING_STATUS_ACTIVE && Number(row.backed) === 1) || null

    const priced = (row) => ({
      price: row.price,
      payment_token: row.payment_token,
      // Null for the native coin — store_tokens has no row for it, and the client fills both in
      // from its chain config like every other price in the app
      symbol: row.symbol ?? null,
      decimals: row.decimals === null || row.decimals === undefined ? null : Number(row.decimals),
    })

    const activity = [
      ...trades.map((row) => ({
        type: 'sale',
        at: Number(row.sold_at),
        at_source: 'chain',
        wallet_address: row.buyer,
        counterparty: row.seller,
        listing_id: Number(row.listing_id),
        tx_hash: row.tx_hash,
        ...priced(row),
      })),
      ...listings.map((row) => ({
        // A cancelled row's Listed event still happened; its cancellation is a separate entry
        // below, so a pulled listing shows both halves of what it did
        type: 'listed',
        at: Number(row.listed_at),
        at_source: 'chain',
        wallet_address: row.seller,
        listing_id: Number(row.listing_id),
        tx_hash: row.tx_hash,
        ...priced(row),
      })),
      ...listings
        .filter((row) => Number(row.status) === LISTING_STATUS_CANCELLED)
        .map((row) => ({
          type: 'cancelled',
          // HupTrade's Cancelled event carries no timestamp cidex stores, so this is when the
          // row was replayed. `at_source` is how the client knows not to print it as an
          // onchain moment.
          at: Number(row.updated_at) || Number(row.listed_at),
          at_source: 'indexed',
          wallet_address: row.seller,
          listing_id: Number(row.listing_id),
          tx_hash: null,
          ...priced(row),
        })),
      ...offers.map((row) => ({
        type: 'offer',
        at: Number(row.made_at),
        at_source: 'chain',
        wallet_address: row.offerer,
        offer_id: Number(row.offer_id),
        offer_status: Number(row.status),
        // Fillable right now — active and unexpired against chain time, not the reader's clock
        is_live: Number(row.is_live) === 1,
        expires_at: Number(row.expires_at),
        tx_hash: row.tx_hash,
        ...priced(row),
      })),
    ]
      .filter((entry) => Number.isFinite(entry.at) && entry.at > 0)
      .sort((a, b) => b.at - a.at)
      .slice(0, ROW_LIMIT)

    // Wallets go back as bare addresses: the timeline renders them through the shared Profile
    // component, which already resolves names, avatars and the Universal Profile fallback on the
    // client — the same way the listing page credits a seller and the offer list an offerer.

    // A dollar figure beside every price, because "1.2 LYX" answers a different question than
    // "$3.10" and a reader deciding whether to buy is asking the second one. Sent as a rate per
    // whole token rather than as a converted amount per row: the same rate serves the ask, the
    // top offer and every line of the timeline, and the client already holds the decimals it
    // needs to apply it.
    //
    // Cosmetic throughout. Testnets have no DefiLlama slug and unlisted ERC20s no price, so a
    // missing key is the normal case, not an error — those rows simply render without a dollar
    // figure rather than with a wrong one.
    const usd = {}
    try {
      // `listings` already contains the active ask, so the three tables cover every currency
      // any row on this page is quoted in
      const tokens = new Set(
        [...listings, ...trades, ...offers].map((row) => (row.payment_token || NATIVE_TOKEN).toLowerCase()),
      )
      const keys = new Map([...tokens].map((token) => [token, priceKeyFor(chainId, token)]))
      const prices = await fetchUsdPrices([...keys.values()])

      for (const [token, key] of keys) {
        const price = key ? prices.get(key) : null
        if (price) usd[token] = price
      }
    } catch {
      // Prices are decoration — the panel is fully usable in token terms without them
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          // Rate per whole token, keyed by payment token (the zero address for the native coin).
          // Absent keys mean "no price known", which the client renders as no dollar figure.
          usd,
          // Shaped like a row of GET /api/v1/nfts so TradeCard and NftQuickBuy can take it
          // without the panel reshaping a listing per surface
          listing: active
            ? {
                listing_id: Number(active.listing_id),
                seller: active.seller,
                collection,
                token_id: raw,
                is_lsp8: Number(active.is_lsp8) === 1,
                is_lsp7: Number(active.is_lsp7) === 1,
                referral_bps: Number(active.referral_bps) || 0,
                status: Number(active.status),
                listed_at: Number(active.listed_at),
                tx_hash: active.tx_hash,
                ...priced(active),
              }
            : null,
          topOffer: topOffer
            ? {
                offer_id: Number(topOffer.offer_id),
                offerer: topOffer.offerer,
                expires_at: Number(topOffer.expires_at),
                ...priced(topOffer),
              }
            : null,
          // Newest first, like the timeline; the chart reverses it rather than the server
          // answering the same rows twice in two orders
          sales: trades.map((row) => ({ at: Number(row.sold_at), tx_hash: row.tx_hash, ...priced(row) })),
          activity,
        },
      },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('[GET_NFT_TOKEN_MARKET_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
