/**
 * @file api/v1/polls/route.js
 * @description Lists Hup polls from the cidex-indexed polls table. The app never scans chains —
 * HupPolls lifecycle events land here via the cidex runPollsSync runner, which also
 * denormalizes each poll's IPFS metadata JSON (question, option labels) into columns and keeps
 * the tallies current from VoteCast snapshots. Hidden (moderated) and metadata-less rows are
 * never served.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

const POLL_COLUMNS = `
  p.network_id,
  p.poll_id,
  p.creator AS wallet_address,
  p.option_count,
  p.opens_at,
  p.closes_at,
  p.closed_at,
  p.total_votes,
  p.tallies,
  p.metadata_cid,
  p.question,
  p.option_labels,
  p.requirements,
  p.requirement_mode,
  p.allowlist_root,
  p.requirement_labels,
  p.tx_hash,
  p.opened_at,
  u.name AS display_name,
  u.profileImage AS profile_image`

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const scope = ['open', 'upcoming', 'closed', 'mine', 'created'].includes(searchParams.get('scope')) ? searchParams.get('scope') : 'open'
    const sort = ['recent', 'votes', 'closing'].includes(searchParams.get('sort')) ? searchParams.get('sort') : null
    const networkId = parseInt(searchParams.get('networkId')) || null
    const participant = (searchParams.get('participant') || '').toLowerCase() || null
    const q = (searchParams.get('q') || '').trim().slice(0, 100) || null
    const page = parseInt(searchParams.get('page')) || 1
    const limit = Math.min(parseInt(searchParams.get('limit')) || 25, 50)
    const offset = (page - 1) * limit

    const networkFilter = networkId ? 'AND p.network_id = ?' : ''
    const networkArgs = networkId ? [networkId] : []

    const searchFilter = q ? 'AND p.question LIKE ?' : ''
    const searchArgs = q ? [`%${q}%`] : []

    // A poll is open while it is inside its window and the creator has not ended it early;
    // closed_at is 0 for every poll running its full term.
    const isRunning = 'p.closed_at = 0 AND p.closes_at > UNIX_TIMESTAMP() AND p.opens_at <= UNIX_TIMESTAMP()'

    let scopeFilter = ''
    let scopeArgs = []
    if (scope === 'open') {
      scopeFilter = `AND ${isRunning}`
    } else if (scope === 'upcoming') {
      scopeFilter = 'AND p.closed_at = 0 AND p.opens_at > UNIX_TIMESTAMP()'
    } else if (scope === 'closed') {
      scopeFilter = 'AND (p.closed_at > 0 OR p.closes_at <= UNIX_TIMESTAMP())'
    } else if (scope === 'mine') {
      if (!participant) {
        return NextResponse.json({ success: false, error: 'participant is required for scope=mine' }, { status: 400 })
      }
      scopeFilter = `AND (p.creator = ?
        OR EXISTS (SELECT 1 FROM poll_votes v WHERE v.network_id = p.network_id AND v.poll_id = p.poll_id AND v.voter = ?))`
      scopeArgs = [participant, participant]
    } else if (scope === 'created') {
      // Narrower than `mine`: only polls the wallet opened, any status. The composer's
      // attach chooser lists these — a poll you merely voted on is not yours to attach.
      if (!participant) {
        return NextResponse.json({ success: false, error: 'participant is required for scope=created' }, { status: 400 })
      }
      scopeFilter = 'AND p.creator = ?'
      scopeArgs = [participant]
    }

    // "closing" is the natural order for a live poll list and the default for the open scope:
    // the one about to expire is the one still worth a vote.
    const effectiveSort = sort ?? (scope === 'open' ? 'closing' : 'recent')
    const orderBy =
      effectiveSort === 'votes'
        ? 'p.total_votes DESC, p.opened_at DESC'
        : effectiveSort === 'closing'
          ? 'p.closes_at ASC'
          : 'p.opened_at DESC'

    const [rows] = await pool.execute(
      `SELECT ${POLL_COLUMNS}
       FROM polls p
       LEFT JOIN users u ON u.wallet_address = p.creator
       WHERE p.hidden = 0 AND p.metadata_fetched = 1 ${networkFilter} ${searchFilter} ${scopeFilter}
       ORDER BY ${orderBy}, p.poll_id DESC
       LIMIT ? OFFSET ?`,
      [...networkArgs, ...searchArgs, ...scopeArgs, limit + 1, offset],
    )

    const hasMore = rows.length > limit
    const polls = hasMore ? rows.slice(0, limit) : rows

    await fulfillUniversalProfiles(polls, pool)

    // The viewer's own ballots for just this page, joined in JS — a select-list subquery
    // would run for every row before the sort/limit (see the posts feed query shape)
    if (participant && polls.length > 0) {
      const tuples = polls.map(() => '(?, ?)').join(', ')
      const tupleArgs = polls.flatMap((poll) => [poll.network_id, poll.poll_id])
      const [ballots] = await pool.execute(
        `SELECT network_id, poll_id, option_index
         FROM poll_votes
         WHERE voter = ? AND (network_id, poll_id) IN (${tuples})`,
        [participant, ...tupleArgs],
      )
      const ballotByKey = Object.fromEntries(ballots.map((row) => [`${row.network_id}-${row.poll_id}`, Number(row.option_index)]))
      for (const poll of polls) {
        const key = `${poll.network_id}-${poll.poll_id}`
        poll.viewer_option = key in ballotByKey ? ballotByKey[key] : null
      }
    }

    // Same rule as the detail route: no standings for a running poll the viewer hasn't
    // answered, so a list can't do the steering a card refuses to. `total_votes` stays.
    const now = Math.floor(Date.now() / 1000)
    for (const poll of polls) {
      const votingClosed = Number(poll.closed_at) > 0 || Number(poll.closes_at) <= now
      // undefined when no wallet was supplied at all, null when that wallet hasn't voted
      const hasVoted = poll.viewer_option !== null && poll.viewer_option !== undefined
      if (!votingClosed && !hasVoted) poll.tallies = null
    }

    return NextResponse.json({
      success: true,
      data: polls,
      nextPage: hasMore ? page + 1 : null,
      meta: { page, count: polls.length, hasMore, scope, sort: effectiveSort },
    })
  } catch (error) {
    console.error('[GET_POLLS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
