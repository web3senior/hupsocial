/**
 * @file api/v1/nfts/offers/route.js
 * @description Offers read model for the NFT market and OTC surfaces — the cidex-indexed
 * nft_offers table (HupOffers contract), never a chain call. Two query shapes:
 *
 *   ?networkId=&collection=&tokenId=  → offers on one asset (listing page / token dialog),
 *                                       best price first
 *   ?networkId=&offerer=              → one wallet's offers (my-offers views), newest first
 *   ?networkId=&standard=4,5          → every open deal of those asset standards, chain-wide
 *                                       (the OTC directory: 4 ERC20, 5 NATIVE)
 *   ?networkId=&counterparty=0x…      → deals locked to one wallet, waiting on them to fill
 *
 * `status=active` (default) returns only fillable rows — Active AND unexpired — because an
 * expired offer stays Active onchain until its escrow is reclaimed; `status=past` is the
 * complement (filled, cancelled, or timed out) and `status=all` drops the filter entirely. Payment-token
 * symbol/decimals ride along from store_tokens (populated by the offers runner), offerer
 * identity from users, with Universal Profile fallback like the other market routes.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

const OFFER_STATUS_ACTIVE = 1
const OFFER_STATUS_FILLED = 2
const OFFER_STATUS_CANCELLED = 3

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = searchParams.get('networkId')
    const collection = (searchParams.get('collection') || '').trim().toLowerCase()
    const tokenId = (searchParams.get('tokenId') || '').trim().toLowerCase()
    const offerer = (searchParams.get('offerer') || '').trim().toLowerCase()
    const counterparty = (searchParams.get('counterparty') || '').trim().toLowerCase()
    const status = searchParams.get('status') || 'active'
    // CSV of IHupOffers.AssetStandard values — the OTC directory asks for the fungible ones
    // (4 ERC20, 5 NATIVE) so token deals never surface in an NFT view or the reverse
    const standards = (searchParams.get('standard') || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value))

    if (!networkId) {
      return NextResponse.json({ success: false, error: 'networkId is required' }, { status: 400 })
    }
    // Chain-wide reads are allowed only when narrowed by standard or counterparty: the OTC
    // directory browses every open deal, but an unfiltered dump of one chain's whole offer
    // book is not a query any surface actually wants
    if (!offerer && !collection && standards.length === 0 && !counterparty) {
      return NextResponse.json({ success: false, error: 'Narrow by collection, offerer, counterparty or standard' }, { status: 400 })
    }

    let whereClause = ' WHERE o.network_id = ?'
    const whereParams = [networkId]

    if (standards.length > 0) {
      whereClause += ` AND o.standard IN (${standards.map(() => '?').join(',')})`
      whereParams.push(...standards)
    }
    if (counterparty) {
      whereClause += ' AND o.counterparty = ?'
      whereParams.push(counterparty)
    }
    if (collection) {
      whereClause += ' AND o.collection = ?'
      whereParams.push(collection)
    }
    if (tokenId) {
      whereClause += ' AND o.token_id = ?'
      whereParams.push(tokenId)
    }
    if (offerer) {
      whereClause += ' AND o.offerer = ?'
      whereParams.push(offerer)
    }
    if (status === 'active') {
      whereClause += ' AND o.status = ? AND o.expires_at > UNIX_TIMESTAMP()'
      whereParams.push(OFFER_STATUS_ACTIVE)
    } else if (status === 'past') {
      // Everything that can no longer be filled: settled, withdrawn, or timed out. Expired
      // rows are still Active onchain and still hold escrow — they belong here precisely
      // because this is where their owner finds them to reclaim it.
      whereClause += ' AND (o.status IN (?, ?) OR (o.status = ? AND o.expires_at <= UNIX_TIMESTAMP()))'
      whereParams.push(OFFER_STATUS_FILLED, OFFER_STATUS_CANCELLED, OFFER_STATUS_ACTIVE)
    }

    // Asset-scoped reads rank by escrowed price (the "best offer" view — mixed payment
    // tokens rank imperfectly, but offers on one asset are near-always priced alike);
    // wallet-scoped reads are a history, so recency wins
    const orderClause = offerer ? ' ORDER BY o.made_at DESC' : ' ORDER BY o.price DESC, o.made_at DESC'

    const [rows] = await pool.execute(
      `SELECT o.*, st.symbol AS payment_symbol, st.decimals AS payment_decimals,
              u.name AS display_name, u.profileImage AS profile_image
         FROM nft_offers o
         LEFT JOIN store_tokens st ON st.network_id = o.network_id AND st.token = o.payment_token
         LEFT JOIN users u ON u.wallet_address = o.offerer
         ${whereClause}
         ${orderClause}
        LIMIT 50`,
      whereParams
    )

    const data = rows.map((row) => ({
      ...row,
      standard: Number(row.standard),
      status: Number(row.status),
      partial_fillable: Boolean(Number(row.partial_fillable)),
      is_lsp7: Boolean(Number(row.is_lsp7)),
      expires_at: Number(row.expires_at),
      made_at: Number(row.made_at),
      payment_decimals: row.payment_decimals === null ? null : Number(row.payment_decimals),
      wallet_address: row.offerer,
    }))
    await fulfillUniversalProfiles(data, pool)

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[GET_NFT_OFFERS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
