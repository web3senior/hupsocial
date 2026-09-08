/**
 * @file api/v1/fund/[id]/route.js
 * @description Fetches a single indexed Hup Fund campaign by its onchain id + network, so a
 * campaign card renders correctly regardless of which chain the viewer's wallet is connected
 * to. Includes a page of the backing activity, the viewer's own total (`backer` param) and the
 * chain's native coin price. Hidden campaigns are still served here — a backer must always be
 * able to see what they backed — the directory is where hidden rows are suppressed.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { nativePricesFor } from '@/lib/fundServer'

export const runtime = 'nodejs'

const BACKINGS_PAGE = 30

export async function GET(request, { params }) {
  try {
    const { id: campaignId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(searchParams.get('networkId')) || null
    const backer = (searchParams.get('backer') || '').toLowerCase() || null
    const backingsOffset = Math.max(0, parseInt(searchParams.get('backingsOffset'), 10) || 0)

    if (!networkId || !/^\d+$/.test(String(campaignId))) {
      return NextResponse.json({ success: false, error: 'networkId and a numeric campaign id are required' }, { status: 400 })
    }

    const [rows] = await pool.execute(
      `SELECT
         c.network_id, c.campaign_id, c.creator AS wallet_address, c.payout, c.goal, c.raised,
         c.backer_count, c.fee_bps, c.closes_at, c.closed_at, c.withdrawn_at, c.withdrawn_amount,
         c.refunding, c.refunded, c.hidden, c.metadata_cid, c.title,
         c.description, c.image, c.faq, c.tx_hash, c.opened_at,
         u.name AS display_name, u.profileImage AS profile_image
       FROM fund_campaigns c
       LEFT JOIN users u ON u.wallet_address = c.creator
       WHERE c.network_id = ? AND c.campaign_id = ?
       LIMIT 1`,
      [networkId, campaignId],
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
    }

    const campaign = rows[0]
    await fulfillUniversalProfiles([campaign], pool)
    const prices = await nativePricesFor([networkId])
    campaign.native_usd = prices[networkId] ?? null

    // The activity feed, newest first. One page per request (`backingsOffset` walks the
    // list); one extra row is fetched only to learn whether another page exists.
    const [pagedBackings] = await pool.execute(
      `SELECT b.backer AS wallet_address, b.amount, b.memo, b.backed_at, b.tx_hash,
              u.name AS display_name, u.profileImage AS profile_image
       FROM fund_backings b
       LEFT JOIN users u ON u.wallet_address = b.backer
       WHERE b.network_id = ? AND b.campaign_id = ?
       ORDER BY b.block_number DESC, b.log_index DESC
       LIMIT ${BACKINGS_PAGE + 1} OFFSET ${backingsOffset}`,
      [networkId, campaignId],
    )
    const hasMoreBackings = pagedBackings.length > BACKINGS_PAGE
    const backings = pagedBackings.slice(0, BACKINGS_PAGE)
    await fulfillUniversalProfiles(backings, pool)

    // The viewer's own totals, when a wallet was supplied: what they gave, and what they have
    // already pulled back. The difference is what a refund claim would return.
    let viewerBacked = null
    let viewerRefunded = null
    if (backer) {
      const [totalRows] = await pool.execute(
        `SELECT SUM(amount) AS total, COUNT(*) AS count
         FROM fund_backings
         WHERE network_id = ? AND campaign_id = ? AND backer = ?`,
        [networkId, campaignId, backer],
      )
      if (Number(totalRows[0]?.count) > 0) viewerBacked = String(totalRows[0].total)

      const [refundRows] = await pool.execute(
        `SELECT SUM(amount) AS total, COUNT(*) AS count
         FROM fund_refunds
         WHERE network_id = ? AND campaign_id = ? AND backer = ?`,
        [networkId, campaignId, backer],
      )
      if (Number(refundRows[0]?.count) > 0) viewerRefunded = String(refundRows[0].total)
    }

    return NextResponse.json({
      success: true,
      data: { campaign, backings, viewerBacked, viewerRefunded, hasMoreBackings },
    })
  } catch (error) {
    console.error('[GET_FUND_DETAIL_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
