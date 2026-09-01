/**
 * @file api/v1/nfts/route.js
 * @description Lists HupTrade NFT listings straight from the cidex-indexed nft_listings
 * table for the NFT Market grid — status/network/standard/payment-token/price/seller and
 * sort all resolve here in SQL. The free-text `q` search and the `traits` filter are the
 * two places token metadata enters the query: names and attributes aren't indexed by cidex,
 * but the app's read-through nft_metadata_cache has persisted them for every token that
 * has ever been rendered, so both resolve against that table — see the params below.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { BACKED_LISTINGS_SQL } from '@/lib/nftListingBacking'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

// IHupTrade.ListingStatus. Cancelled (3) is deliberately absent from every key: a seller who
// pulled an NFT back off the market took it off the shelf, and no browse view should be able
// to ask for those rows. The listing page still resolves one by id (see nfts/[id]) so a
// bookmarked link can say the listing was cancelled instead of 404ing, and the floor history
// still reads cancel times to close out an ask — both are history, not inventory.
const STATUS_BY_KEY = { active: [1], sold: [2], active_sold: [1, 2], all: [1, 2] }

// A hand-edited URL shouldn't be able to hand MariaDB a hundred JSON_CONTAINS calls
const MAX_TRAIT_PAIRS = 20

// Longer than any NFT or collection name worth matching; keeps a pasted wall of text from
// becoming a pathological LIKE pattern
const MAX_SEARCH_LENGTH = 100

// A typed "%" or "_" must match itself, not turn into a wildcard
const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&')

/**
 * Parse the `traits` param — a JSON array of {label, value} — into label → values.
 *
 * Grouping is what defines the filter's semantics: values under the same label are ORed
 * (Eyes: Laser *or* Blue), and the groups are ANDed (…*and* Hat: Cap). That's what every
 * NFT marketplace's trait panel does, and the only reading where ticking a second value in
 * a group can widen the result instead of emptying it.
 */
function parseTraitFilters(raw) {
  if (!raw) return []

  let pairs
  try {
    pairs = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(pairs)) return []

  const groups = new Map()
  for (const pair of pairs.slice(0, MAX_TRAIT_PAIRS)) {
    const label = typeof pair?.label === 'string' ? pair.label.trim() : ''
    const value = typeof pair?.value === 'string' ? pair.value.trim() : ''
    if (!label || !value) continue

    const values = groups.get(label)
    if (values) {
      if (!values.includes(value)) values.push(value)
    } else {
      groups.set(label, [value])
    }
  }

  return [...groups.entries()]
}

/**
 * Attach each row's most recent onchain sale, in place.
 *
 * Deliberately a second query over the already-paginated rows rather than a subquery in
 * the main select list: MariaDB evaluates select-list subqueries for every candidate row
 * before ORDER BY/LIMIT, so a per-token lookup there would run across the whole table
 * instead of the 24 rows actually returned.
 */
async function attachLastSales(rows) {
  if (!rows.length) return

  const keys = rows.map((r) => [r.network_id, r.collection, r.token_id])
  const [trades] = await pool.execute(
    `SELECT t.network_id, t.collection, t.token_id, CAST(t.price AS CHAR) AS price, t.sold_at,
            st.symbol, st.decimals
       FROM nft_trades t
       LEFT JOIN store_tokens st ON st.network_id = t.network_id AND st.token = t.payment_token
      WHERE (t.network_id, t.collection, t.token_id) IN (${keys.map(() => '(?,?,?)').join(',')})
      ORDER BY t.sold_at DESC`,
    keys.flat(),
  )

  // Sorted newest first, so the first hit per token is the last sale
  const latest = new Map()
  for (const trade of trades) {
    const key = `${trade.network_id}-${trade.collection}-${trade.token_id}`
    if (!latest.has(key)) latest.set(key, trade)
  }

  for (const row of rows) {
    const trade = latest.get(`${row.network_id}-${row.collection}-${row.token_id}`)
    if (!trade) continue
    row.last_sale_price = trade.price
    row.last_sale_symbol = trade.symbol
    row.last_sale_decimals = trade.decimals
    row.last_sale_at = trade.sold_at
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 24, 60)
    const offset = (page - 1) * limit

    const networkId = searchParams.get('networkId')
    const collection = searchParams.get('collection') // contract address — name isn't indexed, resolved client-side
    const standard = searchParams.get('standard') // 'lsp8' | 'erc721'
    const token = searchParams.get('token') // 'native' | address
    const minPrice = searchParams.get('minPrice') // base units, decimal string
    const maxPrice = searchParams.get('maxPrice')
    const seller = searchParams.get('seller') // address or username fragment
    const q = (searchParams.get('q') || '').trim().slice(0, MAX_SEARCH_LENGTH) // NFT name, collection name, seller name or address fragment
    const referral = searchParams.get('referral') // 'any' (>0) | 'none' (=0) | minimum bps, e.g. '500' for 5%+
    const traits = parseTraitFilters(searchParams.get('traits')) // JSON [{label, value}] — see above
    const sort = searchParams.get('sort') || 'newest' // an ORDER_BY key below
    const statusKey = searchParams.get('status') || 'active'
    // Defaults to what's still buyable; 'active_sold'/'all' widen to the sold rows too. An
    // unknown key (a hand-edited URL, or the retired 'cancelled') degrades to active.
    const statuses = STATUS_BY_KEY[statusKey] || STATUS_BY_KEY.active

    // Status alone would still serve listings whose seller no longer holds the token — see
    // BACKED_LISTINGS_SQL for why that state exists and where the column comes from
    let whereClause = ` WHERE l.status IN (${statuses.map(() => '?').join(',')}) AND ${BACKED_LISTINGS_SQL}`
    const whereParams = [...statuses]

    if (networkId) {
      whereClause += ` AND l.network_id = ?`
      whereParams.push(networkId)
    }

    if (collection) {
      whereClause += ` AND l.collection = ?`
      whereParams.push(collection.toLowerCase())
    }

    if (standard === 'lsp8') {
      whereClause += ` AND l.is_lsp8 = 1`
    } else if (standard === 'erc721') {
      whereClause += ` AND l.is_lsp8 = 0`
    }

    if (token === 'native') {
      whereClause += ` AND (l.payment_token IS NULL OR l.payment_token = '0x0000000000000000000000000000000000000000')`
    } else if (token) {
      whereClause += ` AND l.payment_token = ?`
      whereParams.push(token.toLowerCase())
    }

    // Reposters shop by referral share, so the threshold is a first-class filter
    if (referral === 'none') {
      whereClause += ` AND l.referral_bps = 0`
    } else if (referral === 'any') {
      whereClause += ` AND l.referral_bps > 0`
    } else if (referral) {
      const minReferralBps = parseInt(referral, 10)
      if (Number.isFinite(minReferralBps) && minReferralBps > 0) {
        whereClause += ` AND l.referral_bps >= ?`
        whereParams.push(minReferralBps)
      }
    }

    if (minPrice) {
      whereClause += ` AND CAST(l.price AS DECIMAL(65,0)) >= ?`
      whereParams.push(minPrice)
    }
    if (maxPrice) {
      whereClause += ` AND CAST(l.price AS DECIMAL(65,0)) <= ?`
      whereParams.push(maxPrice)
    }

    if (seller) {
      if (/^0x[0-9a-fA-F]{40}$/.test(seller)) {
        whereClause += ` AND l.seller = ?`
        whereParams.push(seller.toLowerCase())
      } else {
        whereClause += ` AND EXISTS (SELECT 1 FROM users us WHERE us.wallet_address = l.seller AND us.name LIKE ?)`
        whereParams.push(`%${seller}%`)
      }
    }

    // The search box. A token's own name is only known once that token has been rendered
    // somewhere and cached, but a collection's name is shared by every token in it — so a
    // listing whose token was never drawn still matches through any cached sibling's
    // collection_name. That's what lets a search reach a collection four pages deep instead
    // of only the tiles already on screen. The cache's utf8mb4_general_ci collation makes
    // LIKE case-insensitive, so "dale" finds "Dale".
    if (q) {
      const pattern = `%${escapeLike(q)}%`
      whereClause +=
        ` AND (` +
        `EXISTS (SELECT 1 FROM nft_metadata_cache m` +
        ` WHERE m.network_id = l.network_id AND m.collection = l.collection AND m.token_id = l.token_id AND m.name LIKE ?)` +
        ` OR EXISTS (SELECT 1 FROM nft_metadata_cache mc` +
        ` WHERE mc.network_id = l.network_id AND mc.collection = l.collection AND mc.collection_name LIKE ?)` +
        ` OR EXISTS (SELECT 1 FROM users us WHERE us.wallet_address = l.seller AND us.name LIKE ?)` +
        ` OR l.seller LIKE ?` +
        `)`
      whereParams.push(pattern, pattern, pattern, pattern)
    }

    // Traits live in the app's own read-through metadata cache, not in the indexed listing
    // row — an EXISTS keeps that a per-row lookup on nft_metadata_cache's primary key
    // instead of a join that would have to be de-duplicated afterwards. A token nobody has
    // rendered yet has no cached row and therefore no known traits, so it drops out of a
    // trait-filtered view; the collection page's panel reports that coverage.
    if (traits.length > 0) {
      const conditions = []
      for (const [label, values] of traits) {
        conditions.push(`(${values.map(() => 'JSON_CONTAINS(m.attributes, ?)').join(' OR ')})`)
        // Object containment, so key order doesn't matter and a value can't match under
        // another label the way a bare LIKE over the document would allow
        for (const value of values) whereParams.push(JSON.stringify({ label, value }))
      }

      whereClause +=
        ` AND EXISTS (SELECT 1 FROM nft_metadata_cache m` +
        ` WHERE m.network_id = l.network_id AND m.collection = l.collection AND m.token_id = l.token_id` +
        ` AND ${conditions.join(' AND ')})`
    }

    const ORDER_BY = {
      newest: 'l.listed_at DESC',
      oldest: 'l.listed_at ASC',
      price_asc: 'CAST(l.price AS DECIMAL(65,0)) ASC',
      price_desc: 'CAST(l.price AS DECIMAL(65,0)) DESC',
      referral_desc: 'l.referral_bps DESC, l.listed_at DESC',
      recently_sold: 'tr.last_sold_at DESC, l.listed_at DESC',
    }
    const orderBy = ORDER_BY[sort] || ORDER_BY.newest

    // Pre-aggregated join, not a select-list subquery — see attachLastSales for the MariaDB
    // trap. NULL last_sold_at sorts after every sale under DESC, so never-sold rows trail.
    const tradeJoin =
      sort === 'recently_sold'
        ? ` LEFT JOIN (SELECT network_id, listing_id, MAX(sold_at) AS last_sold_at
               FROM nft_trades GROUP BY network_id, listing_id) tr
               ON tr.network_id = l.network_id AND tr.listing_id = l.listing_id`
        : ''

    const [rows] = await pool.execute(
      `SELECT
         l.network_id, l.listing_id, l.seller AS wallet_address, l.collection, l.token_id,
         l.is_lsp8, l.payment_token, l.is_lsp7, CAST(l.price AS CHAR) AS price, l.referral_bps,
         l.status, l.listed_at,
         st.symbol, st.decimals,
         u.name AS display_name, u.profileImage AS profile_image
       FROM nft_listings l
       LEFT JOIN store_tokens st ON st.network_id = l.network_id AND st.token = l.payment_token
       LEFT JOIN users u ON u.wallet_address = l.seller
       ${tradeJoin}
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...whereParams, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    await fulfillUniversalProfiles(data, pool)
    await attachLastSales(data)

    return NextResponse.json({ success: true, data, meta: { page, hasMore } })
  } catch (error) {
    console.error('[GET_NFT_LISTINGS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
