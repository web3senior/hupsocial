/**
 * @file api/v1/public/feedback/route.js
 * @description Fetches paginated agent feedback with accurate nextPage logic and metadata.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 10
    const offset = (page - 1) * limit

    /* Fetch limit + 1 to check if another page actually exists (Peek-Ahead) */
    const [rows] = await pool.execute(
      `SELECT 
        f.id, 
        f.rating, 
        f.comment, 
        f.onchain_proof_hash,
        f.created_at,
        f.transaction_id,
        m.business_name,
        a.agent_name,
        a.wallet_address AS agent_wallet
      FROM feedback f
      LEFT JOIN merchants m ON f.merchant_id = m.id
      LEFT JOIN agents a ON f.agent_id = a.id
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?`,
      [limit + 1, offset],
    )

    const hasMore = rows.length > limit
    /* Remove the "peek" record before sending to the client */
    const feedbackToSend = hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    /* SUCCESS BRANCH: Includes the standardized meta object */
    return NextResponse.json({
      success: true,
      feedback: feedbackToSend,
      nextPage: nextPage,
      meta: {
        page: page,
        limit: limit,
        count: feedbackToSend.length,
        hasMore: hasMore
      }
    })
  } catch (error) {
    console.error('[Feedback API] Error:', error.message)

    /* ERROR BRANCH: Standardized error response */
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch feedback',
        details: error.message,
      },
      { status: 500 },
    )
  }
}