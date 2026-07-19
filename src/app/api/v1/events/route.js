/**
 * @file api/v1/events/route.js
 * @description Lists the paid events directory from the cidex-indexed events table. The app
 * never scans chains — HupEvents' lifecycle events land here via the cidex runEventsSync
 * runner, which also denormalizes each event's IPFS metadata JSON into columns. Hidden
 * (moderated), canceled, and metadata-less rows are never served.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

const EVENT_COLUMNS = `
  e.network_id,
  e.event_id,
  e.organizer AS wallet_address,
  e.start_time,
  e.end_time,
  e.featured,
  e.canceled,
  CAST(e.fee_paid AS CHAR) AS fee_paid,
  e.metadata_cid,
  e.title,
  e.description,
  e.organizer_name,
  e.venue,
  e.city,
  e.timezone,
  e.registration_url,
  e.image_cid,
  e.tx_hash,
  e.listed_at,
  u.name AS display_name,
  u.profileImage AS profile_image`

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const scope = searchParams.get('scope') === 'past' ? 'past' : 'upcoming'
    const networkId = parseInt(searchParams.get('networkId')) || null
    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 25, 50)
    const offset = (page - 1) * limit

    const networkFilter = networkId ? 'AND e.network_id = ?' : ''
    const networkArgs = networkId ? [networkId] : []

    // Upcoming keeps events visible until they end (multi-day events stay listed while
    // running); past is everything already over, newest first.
    const scopeFilter = scope === 'upcoming' ? 'AND e.end_time >= UNIX_TIMESTAMP()' : 'AND e.end_time < UNIX_TIMESTAMP()'
    const order = scope === 'upcoming' ? 'ORDER BY e.start_time ASC, e.event_id ASC' : 'ORDER BY e.start_time DESC, e.event_id DESC'

    const [rows] = await pool.execute(
      `SELECT ${EVENT_COLUMNS}
       FROM events e
       LEFT JOIN users u ON u.wallet_address = e.organizer
       WHERE e.hidden = 0 AND e.canceled = 0 AND e.metadata_fetched = 1 ${networkFilter} ${scopeFilter}
       ${order}
       LIMIT ? OFFSET ?`,
      [...networkArgs, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const events = hasMore ? rows.slice(0, limit) : rows

    await fulfillUniversalProfiles(events, pool)

    // Featured strip for the directory header — page 1 only, upcoming only. Featured rows
    // also stay in the main list; the client pins them within their day group.
    let featured
    if (page === 1 && scope === 'upcoming') {
      const [featuredRows] = await pool.execute(
        `SELECT ${EVENT_COLUMNS}
         FROM events e
         LEFT JOIN users u ON u.wallet_address = e.organizer
         WHERE e.featured = 1 AND e.hidden = 0 AND e.canceled = 0 AND e.metadata_fetched = 1
           ${networkFilter} AND e.end_time >= UNIX_TIMESTAMP()
         ORDER BY e.start_time ASC, e.event_id ASC
         LIMIT 10`,
        networkArgs,
      )
      await fulfillUniversalProfiles(featuredRows, pool)
      featured = featuredRows
    }

    return NextResponse.json({
      success: true,
      data: events,
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: events.length,
        hasMore,
        ...(featured ? { featured } : {}),
      },
    })
  } catch (error) {
    console.error('[GET_EVENTS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
