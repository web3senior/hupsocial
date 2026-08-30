/**
 * @file api/v1/polls/[id]/route.js
 * @description Fetches a single indexed Hup poll by its onchain id + network, mirroring the
 * predict detail pattern so a poll card renders correctly regardless of which chain the
 * viewer's wallet is connected to. Optionally includes the viewer's own ballot (`voter`
 * param) and the recent voter feed. Hidden polls are still served here — a voter must always
 * be able to see what they voted on — the directory is where hidden rows are suppressed.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { id: pollId } = await params
    const { searchParams } = new URL(request.url)
    const networkId = parseInt(searchParams.get('networkId')) || null
    const voter = (searchParams.get('voter') || '').toLowerCase() || null
    const votesOffset = Math.max(0, parseInt(searchParams.get('votesOffset'), 10) || 0)

    if (!networkId || !/^\d+$/.test(String(pollId))) {
      return NextResponse.json({ success: false, error: 'networkId and a numeric poll id are required' }, { status: 400 })
    }

    const [rows] = await pool.execute(
      `SELECT
         p.network_id, p.poll_id, p.creator AS wallet_address, p.option_count,
         p.opens_at, p.closes_at, p.closed_at, p.hidden, p.total_votes, p.tallies,
         p.metadata_cid, p.question, p.option_labels, p.tx_hash, p.opened_at,
         p.requirements, p.requirement_mode, p.allowlist_root, p.allowlist, p.requirement_labels,
         u.name AS display_name, u.profileImage AS profile_image
       FROM polls p
       LEFT JOIN users u ON u.wallet_address = p.creator
       WHERE p.network_id = ? AND p.poll_id = ?
       LIMIT 1`,
      [networkId, pollId],
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Poll not found' }, { status: 404 })
    }

    const poll = rows[0]
    await fulfillUniversalProfiles([poll], pool)

    // Who voted, and — once the viewer has earned the results below — what they picked.
    // One page per request (`votesOffset` walks the list); one extra row is fetched only to
    // learn whether another page exists, then dropped before it can leak.
    const VOTES_PAGE = 30
    const [pagedVotes] = await pool.execute(
      `SELECT v.voter AS wallet_address, v.option_index, v.voted_at, v.tx_hash,
              u.name AS display_name, u.profileImage AS profile_image
       FROM poll_votes v
       LEFT JOIN users u ON u.wallet_address = v.voter
       WHERE v.network_id = ? AND v.poll_id = ?
       ORDER BY v.block_number DESC, v.log_index DESC
       LIMIT ${VOTES_PAGE + 1} OFFSET ${votesOffset}`,
      [networkId, pollId],
    )
    const hasMoreVotes = pagedVotes.length > VOTES_PAGE
    const recentVotes = pagedVotes.slice(0, VOTES_PAGE)
    await fulfillUniversalProfiles(recentVotes, pool)

    // The viewer's own ballot, when a wallet was supplied. One row at most — the contract
    // allows exactly one, and the table carries the same unique key.
    let ballot = null
    if (voter) {
      const [ballotRows] = await pool.execute(
        `SELECT option_index, voted_at, tx_hash
         FROM poll_votes
         WHERE network_id = ? AND poll_id = ? AND voter = ?
         LIMIT 1`,
        [networkId, pollId, voter],
      )
      ballot = ballotRows[0] ?? null
    }

    // Standings are withheld from a viewer who hasn't voted on a poll that is still running:
    // a running count on screen steers the vote it is counting. Enforced here rather than in
    // the component so it holds for anyone reading the network tab too. `total_votes` stays —
    // how many answered is participation, not a standing.
    //
    // Individual choices ride the same gate, and have to: a voter list reading "Alice → Yes,
    // Bob → Yes" is the tally, just spelled out. Withholding one while serving the other
    // would leave the gate open. `tx_hash` goes with them — it leads straight to calldata
    // carrying the choice.
    const now = Math.floor(Date.now() / 1000)
    const votingClosed = Number(poll.closed_at) > 0 || Number(poll.closes_at) <= now
    const canSeeResults = votingClosed || Boolean(ballot)

    if (!canSeeResults) {
      poll.tallies = null
      for (const vote of recentVotes) {
        delete vote.option_index
        delete vote.tx_hash
      }
    }

    return NextResponse.json({
      success: true,
      data: { poll, recentVotes, ballot, hasMoreVotes },
    })
  } catch (error) {
    console.error('[GET_POLL_DETAIL_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
