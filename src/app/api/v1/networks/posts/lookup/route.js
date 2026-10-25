/**
 * @file api/v1/networks/posts/lookup/route.js
 * @description Answers a single question — "has the indexer written this submission yet?" — for
 * one author's post, keyed by the metadata URI it was published with. The composer polls this
 * after a receipt so it can hold a loading toast until the post really exists in the feed tables.
 *
 * The metadata alone does not name one post: a pin is addressed by its content, so the same
 * author posting the same words twice gets the same URI both times, and an older row would answer
 * for a submission that has not landed yet. `tx_hash`, when the caller has one, pins the answer to
 * the transaction it actually sent.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = Number(searchParams.get('network_id'))
    const walletAddress = searchParams.get('wallet_address')
    const metadata = searchParams.get('metadata')
    const txHash = searchParams.get('tx_hash')

    if (!networkId || !walletAddress || !metadata) {
      return NextResponse.json(
        { success: false, error: 'network_id, wallet_address and metadata are required' },
        { status: 400 }
      )
    }

    // wallet_address leads the predicate on purpose: it carries the only selective index on
    // `posts`, so the probe stays inside one author's rows instead of scanning the table for an
    // unindexed `metadata`. Both columns are utf8mb4_general_ci, so a checksummed address from
    // the indexer still matches a lowercase one from the client without LOWER() killing the index.
    // Without a hash, the newest matching row is the likeliest to be this submission.
    const [rows] = await pool.execute(
      `SELECT id, network_id, is_comment, is_deleted
       FROM posts
       WHERE wallet_address = ? AND network_id = ? AND metadata = ?${txHash ? ' AND tx_hash = ?' : ''}
       ORDER BY id DESC
       LIMIT 1`,
      [walletAddress, networkId, metadata, ...(txHash ? [txHash] : [])]
    )

    const row = rows[0]

    return NextResponse.json({
      success: true,
      indexed: Boolean(row),
      data: row
        ? {
            id: String(row.id),
            network_id: row.network_id,
            is_comment: row.is_comment ? String(row.is_comment) : null,
            is_deleted: Boolean(row.is_deleted),
          }
        : null,
    })
  } catch (error) {
    console.error('Post lookup error:', error)
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 })
  }
}
