import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const walletAddress = searchParams.get('wallet_address') || searchParams.get('address')

    if (!isWalletAddress(walletAddress)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    const page = clampNumber(parseInt(searchParams.get('page'), 10), 1, 1000, 1)
    const limit = clampNumber(parseInt(searchParams.get('limit'), 10), 1, MAX_LIMIT, DEFAULT_LIMIT)
    const offset = (page - 1) * limit

    // Querying notifications table where the user is the actor who liked the post
    const [rows] = await pool.execute(
      `SELECT
          id,
          recipient_wallet_address,
          actor_wallet_address,
          action_type,
          entity_type,
          entity_id,
          network_id,
          block_number,
          tx_hash,
          log_index,
          title,
          message,
          action_url,
          data,
          created_at
        FROM notifications
        WHERE actor_wallet_address = ? 
          AND action_type IN ('post_liked', 'content_liked')
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      [walletAddress, limit + 1, offset],
    )

    const [totalRows] = await pool.execute(
      `
        SELECT COUNT(*) AS total_count
        FROM notifications
        WHERE actor_wallet_address = ? 
          AND action_type IN ('post_liked', 'content_liked')
      `,
      [walletAddress],
    )

    const hasMore = rows.length > limit
    const likedActions = hasMore ? rows.slice(0, limit) : rows

    return NextResponse.json({
      success: true,
      data: likedActions.map(serializeLikedAction),
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: likedActions.length,
        hasMore,
        total_count: Number(totalRows[0]?.total_count || 0),
      },
    })
  } catch (error) {
    console.error('[LIKED_POSTS_FETCH_ERROR]:', error.message)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch liked posts',
        details: process.env.NODE_ENV === 'production' ? undefined : error.message,
      },
      { status: 500 },
    )
  }
}

function serializeLikedAction(row) {
  return {
    id: String(row.id),
    recipient_wallet_address: row.recipient_wallet_address,
    actor_wallet_address: row.actor_wallet_address,
    action_type: row.action_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    network_id: toNullableNumber(row.network_id),
    block_number: toNullableNumber(row.block_number),
    tx_hash: row.tx_hash,
    log_index: toNullableNumber(row.log_index),
    title: row.title,
    message: row.message,
    action_url: row.action_url,
    data: parseJson(row.data),
    created_at: toSerializableDate(row.created_at),
  }
}

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || '')
}

// Keep comments compliant with constraints
function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function parseJson(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function toNullableNumber(value) {
  return value === null || value === undefined ? null : Number(value)
}

function toSerializableDate(value) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}
