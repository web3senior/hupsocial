/**
 * @file lib/nftMarketRows.js
 * @description The rows a market view shows, as one derived table: live listings and sales.
 *
 * A sold listing is not the whole sale history. cidex mirrors one-of-one offer settlements into
 * nft_trades with listing_id = 0 and no listing row at all, so a view built on nft_listings
 * alone silently drops every accepted offer — while the collection header, which counts
 * nft_trades, includes them. Sales therefore come from nft_trades (one row per sale, priced at
 * what was paid), and only live inventory comes from nft_listings.
 *
 * Both halves share the listing row's column names, plus `trade_id` and `sold_at` (NULL on a
 * live listing), so a caller aliases the table as `l` and filters it like it filtered
 * nft_listings before. A single half is a plain derived table MariaDB merges into the outer
 * query; both halves are a UNION ALL, which still receives the outer conditions by pushdown.
 */
import { BACKED_LISTINGS_SQL } from '@/lib/nftListingBacking'

// IHupTrade.ListingStatus
export const LISTING_STATUS_ACTIVE = 1
export const LISTING_STATUS_SOLD = 2

const LIVE_LISTINGS_SQL = `SELECT NULL AS trade_id, l.network_id, l.listing_id, l.seller, l.collection, l.token_id,
         l.is_lsp8, l.payment_token, l.is_lsp7, l.price, l.referral_bps, l.status, l.backed,
         l.listed_at, NULL AS sold_at
    FROM nft_listings l
   WHERE l.status = ${LISTING_STATUS_ACTIVE} AND ${BACKED_LISTINGS_SQL}`

// A sale through a listing keeps that listing's referral share and listing time; an accepted
// offer had neither
const SALES_SQL = `SELECT t.id AS trade_id, t.network_id, t.listing_id, t.seller, t.collection, t.token_id,
         t.is_lsp8, t.payment_token, t.is_lsp7, t.price, COALESCE(nl.referral_bps, 0) AS referral_bps,
         ${LISTING_STATUS_SOLD} AS status, 1 AS backed, nl.listed_at, t.sold_at
    FROM nft_trades t
    LEFT JOIN nft_listings nl ON nl.network_id = t.network_id AND nl.listing_id = t.listing_id`

/**
 * The market rows for a set of listing statuses, as a parenthesised derived table — append an
 * alias. Only Active (1) and Sold (2) are recognised; cancelled listings are never market rows.
 * @param {number[]} statuses
 * @returns {string}
 */
export function marketRowsSql(statuses) {
  const halves = []
  if (statuses.includes(LISTING_STATUS_ACTIVE)) halves.push(LIVE_LISTINGS_SQL)
  if (statuses.includes(LISTING_STATUS_SOLD)) halves.push(SALES_SQL)
  return `(${halves.join(' UNION ALL ')})`
}
