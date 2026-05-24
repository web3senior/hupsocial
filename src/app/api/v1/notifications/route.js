import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const walletAddress =
      searchParams.get('wallet_address') ||
      searchParams.get('recipient_wallet_address') ||
      searchParams.get('address')

    if (!isWalletAddress(walletAddress)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    const page = clampNumber(parseInt(searchParams.get('page'), 10), 1, 1000, 1)
    const limit = clampNumber(parseInt(searchParams.get('limit'), 10), 1, MAX_LIMIT, DEFAULT_LIMIT)
    const offset = (page - 1) * limit
    const unreadOnly = ['1', 'true'].includes(String(searchParams.get('unread')).toLowerCase())

    const where = ['recipient_wallet_address = ?']
    const queryParams = [walletAddress]

    if (unreadOnly) {
      where.push('is_read = 0')
    }

    const [rows] = await pool.execute(
      `
        SELECT
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
          is_read,
          read_at,
          created_at
        FROM notifications
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `,
      [...queryParams, limit + 1, offset],
    )

    const [unreadRows] = await pool.execute(
      `
        SELECT COUNT(*) AS unread_count
        FROM notifications
        WHERE recipient_wallet_address = ? AND is_read = 0
      `,
      [walletAddress],
    )

    const hasMore = rows.length > limit
    const notifications = hasMore ? rows.slice(0, limit) : rows

    return NextResponse.json({
      success: true,
      data: notifications.map(serializeNotification),
      nextPage: hasMore ? page + 1 : null,
      meta: {
        page,
        count: notifications.length,
        hasMore,
        unread_count: Number(unreadRows[0]?.unread_count || 0),
      },
    })
  } catch (error) {
    console.error('[NOTIFICATIONS_FETCH_ERROR]:', error.message)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch notifications',
        details: process.env.NODE_ENV === 'production' ? undefined : error.message,
      },
      { status: 500 },
    )
  }
}

function serializeNotification(row) {
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
    is_read: Boolean(row.is_read),
    read_at: toSerializableDate(row.read_at),
    created_at: toSerializableDate(row.created_at),
  }
}

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || '')
}

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
