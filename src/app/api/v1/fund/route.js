/**
 * @file api/v1/fund/route.js
 * @description Lists Hup Fund campaigns from the cidex-indexed fund_campaigns table. The app
 * never scans chains — HupFund lifecycle events land here via the cidex runFundSync runner,
 * which also denormalizes each campaign's IPFS metadata JSON (title, description, FAQ) into
 * columns and keeps `raised` / `backer_count` current from Backed snapshots. Hidden
 * (moderated) and metadata-less rows are never served. Every row carries the chain's native
 * coin price so a card can print dollars without a second request.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { nativePricesFor } from '@/lib/fundServer'

export const runtime = 'nodejs'

/* How many faces a card's backer strip holds. Only the addresses travel — the client renders
   each one through Profile, which owns identity everywhere in the app. */
const FACE_COUNT = 3

const CAMPAIGN_COLUMNS = `
  c.network_id,
  c.campaign_id,
  c.creator AS wallet_address,
  c.payout,
  c.goal,
  c.raised,
  c.backer_count,
  c.fee_bps,
  c.closes_at,
  c.closed_at,
  c.withdrawn_at,
  c.withdrawn_amount,
  c.refunding,
  c.refunded,
  c.metadata_cid,
  c.title,
  c.description,
  c.image,
  c.faq,
  c.tx_hash,
  c.opened_at,
  u.name AS display_name,
  u.profileImage AS profile_image`

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const scope = ['open', 'closed', 'funded', 'refunding', 'mine', 'created'].includes(searchParams.get('scope')) ? searchParams.get('scope') : 'open'
    const sort = ['recent', 'raised', 'backers', 'closing'].includes(searchParams.get('sort')) ? searchParams.get('sort') : null
    const networkId = parseInt(searchParams.get('networkId')) || null
    const participant = (searchParams.get('participant') || '').toLowerCase() || null
    const q = (searchParams.get('q') || '').trim().slice(0, 100) || null
    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 25, 50)
    const offset = (page - 1) * limit

    const networkFilter = networkId ? 'AND c.network_id = ?' : ''
    const networkArgs = networkId ? [networkId] : []

    const searchFilter = q ? 'AND (c.title LIKE ? OR c.description LIKE ?)' : ''
    const searchArgs = q ? [`%${q}%`, `%${q}%`] : []

    // A campaign is open while it is inside its window and the creator has not ended it
    // early; closed_at is 0 for every campaign running its full term.
    const isRunning = 'c.refunding = 0 AND c.closed_at = 0 AND c.closes_at > UNIX_TIMESTAMP()'

    let scopeFilter = ''
    let scopeArgs = []
    if (scope === 'open') {
      scopeFilter = `AND ${isRunning}`
    } else if (scope === 'closed') {
      scopeFilter = 'AND (c.closed_at > 0 OR c.closes_at <= UNIX_TIMESTAMP())'
    } else if (scope === 'funded') {
      scopeFilter = 'AND c.raised >= c.goal AND c.refunding = 0'
    } else if (scope === 'refunding') {
      scopeFilter = 'AND c.refunding = 1'
    } else if (scope === 'mine') {
      if (!participant) {
        return NextResponse.json({ success: false, error: 'participant is required for scope=mine' }, { status: 400 })
      }
      scopeFilter = `AND (c.creator = ?
        OR EXISTS (SELECT 1 FROM fund_backings b WHERE b.network_id = c.network_id AND b.campaign_id = c.campaign_id AND b.backer = ?))`
      scopeArgs = [participant, participant]
    } else if (scope === 'created') {
      // Narrower than `mine`: only campaigns the wallet opened, any status. The composer's
      // attach chooser lists these — a campaign you merely backed is not yours to attach.
      if (!participant) {
        return NextResponse.json({ success: false, error: 'participant is required for scope=created' }, { status: 400 })
      }
      scopeFilter = 'AND c.creator = ?'
      scopeArgs = [participant]
    }

    // "closing" is the natural order for a live list and the default for the open scope: the
    // one about to end is the one still worth backing.
    const effectiveSort = sort ?? (scope === 'open' ? 'closing' : 'recent')
    const orderBy =
      effectiveSort === 'raised'
        ? 'c.raised DESC, c.opened_at DESC'
        : effectiveSort === 'backers'
          ? 'c.backer_count DESC, c.opened_at DESC'
          : effectiveSort === 'closing'
            ? 'c.closes_at ASC'
            : 'c.opened_at DESC'

    const [rows] = await pool.execute(
      `SELECT ${CAMPAIGN_COLUMNS}
       FROM fund_campaigns c
       LEFT JOIN users u ON u.wallet_address = c.creator
       WHERE c.hidden = 0 AND c.metadata_fetched = 1 ${networkFilter} ${searchFilter} ${scopeFilter}
       ORDER BY ${orderBy}, c.campaign_id DESC
       LIMIT ? OFFSET ?`,
      [...networkArgs, ...searchArgs, ...scopeArgs, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const campaigns = hasMore ? rows.slice(0, limit) : rows

    await fulfillUniversalProfiles(campaigns, pool)

    const prices = await nativePricesFor(campaigns.map((campaign) => campaign.network_id))
    for (const campaign of campaigns) {
      campaign.native_usd = prices[Number(campaign.network_id)] ?? null
      campaign.recent_backers = []
      campaign.viewer_backed = null
      campaign.viewer_refunded = null
    }

    // The viewer's own total for just this page, joined in JS — a select-list subquery would
    // run for every row before the sort/limit (see the posts feed query shape)
    if (participant && campaigns.length > 0) {
      const tuples = campaigns.map(() => '(?, ?)').join(', ')
      const tupleArgs = campaigns.flatMap((campaign) => [campaign.network_id, campaign.campaign_id])
      const [totals] = await pool.execute(
        `SELECT network_id, campaign_id, SUM(amount) AS total
         FROM fund_backings
         WHERE backer = ? AND (network_id, campaign_id) IN (${tuples})
         GROUP BY network_id, campaign_id`,
        [participant, ...tupleArgs],
      )
      const [refunds] = await pool.execute(
        `SELECT network_id, campaign_id, SUM(amount) AS total
         FROM fund_refunds
         WHERE backer = ? AND (network_id, campaign_id) IN (${tuples})
         GROUP BY network_id, campaign_id`,
        [participant, ...tupleArgs],
      )
      const totalByKey = Object.fromEntries(totals.map((row) => [`${row.network_id}-${row.campaign_id}`, String(row.total)]))
      const refundByKey = Object.fromEntries(refunds.map((row) => [`${row.network_id}-${row.campaign_id}`, String(row.total)]))
      for (const campaign of campaigns) {
        const key = `${campaign.network_id}-${campaign.campaign_id}`
        campaign.viewer_backed = totalByKey[key] ?? null
        campaign.viewer_refunded = refundByKey[key] ?? null
      }
    }

    // The last few to back, for the card's face strip. One UNION ALL of per-campaign point
    // lookups, each riding idx_campaign, rather than a ROW_NUMBER() over a derived table: the
    // same shape the posts feed settled on, because that plan is one this XAMPP MariaDB 10.4
    // build crashes on.
    const backed = campaigns.filter((campaign) => Number(campaign.backer_count) > 0)
    if (backed.length > 0) {
      const faceArgs = []
      const faceQuery = backed
        .map((campaign) => {
          faceArgs.push(campaign.network_id, campaign.campaign_id)
          return `(SELECT network_id, campaign_id, backer, block_number, log_index
                     FROM fund_backings
                    WHERE network_id = ? AND campaign_id = ?
                    ORDER BY block_number DESC, log_index DESC
                    LIMIT ${FACE_COUNT * 3})`
        })
        .join(' UNION ALL ')

      const [faces] = await pool.execute(faceQuery, faceArgs)

      const facesByKey = {}
      for (const face of faces) {
        const key = `${face.network_id}-${face.campaign_id}`
        ;(facesByKey[key] ||= []).push(face)
      }
      for (const campaign of campaigns) {
        const bucket = facesByKey[`${campaign.network_id}-${campaign.campaign_id}`] ?? []
        // Newest first, then one face per wallet — a repeat backer is one person, not three
        const seen = new Set()
        campaign.recent_backers = bucket
          .sort((a, b) => Number(b.block_number) - Number(a.block_number) || Number(b.log_index) - Number(a.log_index))
          .map((face) => String(face.backer))
          .filter((backer) => (seen.has(backer) ? false : seen.add(backer)))
          .slice(0, FACE_COUNT)
      }
    }

    return NextResponse.json({
      success: true,
      data: campaigns,
      nextPage: hasMore ? page + 1 : null,
      meta: { page, count: campaigns.length, hasMore, scope, sort: effectiveSort },
    })
  } catch (error) {
    console.error('[GET_FUND_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
