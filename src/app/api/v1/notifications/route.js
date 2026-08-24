import { ethers } from 'ethers'
import { isWalletAddress } from '@/lib/address'
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

const SIG_MAX_AGE_MS = 5 * 60 * 1000

const ERC1271_ABI = ['function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4)']
const ERC1271_MAGIC_VALUE = '0x1626ba7e'

async function verifyERC1271(contractAddress, message, signature) {
  const rpcUrl = process.env.NEXT_PUBLIC_LUKSO_RPC_URL || 'https://rpc.mainnet.lukso.network'
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const contract = new ethers.Contract(contractAddress, ERC1271_ABI, provider)
  const msgHash = ethers.hashMessage(message)
  try {
    const result = await contract.isValidSignature(msgHash, signature)
    return result.toLowerCase() === ERC1271_MAGIC_VALUE
  } catch {
    return false
  }
}

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

const MENTION_TYPES = ['post_received_comment', 'post_received_quote', 'post_received_repost']
const MONEY_TYPES = [
  'post_received_tip',
  'post_sent_tip',
  'nft_sold',
  'nft_purchased',
  'market_received_bet',
  'market_earned_fee',
  'market_resolved',
  'market_refunds_available',
]

// Every row the indexer writes for something you did yourself carries actor = recipient
// ("You liked a post", "Your post was indexed"), so the split needs no per-type list and keeps
// working for action types added later.
const SELF_ROW = 'actor_wallet_address = recipient_wallet_address'
const OTHERS_ROW = `actor_wallet_address IS NOT NULL AND NOT (${SELF_ROW})`

const FILTER_CLAUSES = {
  inbox: OTHERS_ROW,
  you: SELF_ROW,
  mentions: `action_type IN (${MENTION_TYPES.map(() => '?').join(', ')})`,
  money: `action_type IN (${MONEY_TYPES.map(() => '?').join(', ')})`,
}

const FILTER_PARAMS = {
  inbox: [],
  you: [],
  mentions: MENTION_TYPES,
  money: MONEY_TYPES,
}

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

    // `filter` is optional: without it the endpoint keeps returning every notification.
    const filter = searchParams.get('filter')
    const filterClause = filter ? FILTER_CLAUSES[filter] : null
    if (filter && !filterClause) {
      return NextResponse.json({ success: false, error: 'Unknown filter' }, { status: 400 })
    }

    const where = ['recipient_wallet_address = ?']
    const queryParams = [walletAddress]

    if (filterClause) {
      where.push(`(${filterClause})`)
      queryParams.push(...FILTER_PARAMS[filter])
    }

    if (unreadOnly) {
      where.push('is_read = 0')
    }

    // `counts_only=1` skips the row read entirely — the feed uses it to refresh its tab counters
    // after marking notifications read.
    const countsOnly = ['1', 'true'].includes(String(searchParams.get('counts_only')).toLowerCase())

    const [rows] = countsOnly ? [[]] : await pool.execute(
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

    // Every filter's unread total in one pass, so the feed can label all of its tabs without a
    // request per tab. Counted through the same clauses the row query uses, so a badge can never
    // promise rows its tab does not contain.
    const [unreadRows] = await pool.execute(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN ${FILTER_CLAUSES.inbox} THEN 1 ELSE 0 END) AS inbox,
          SUM(CASE WHEN ${FILTER_CLAUSES.mentions} THEN 1 ELSE 0 END) AS mentions,
          SUM(CASE WHEN ${FILTER_CLAUSES.money} THEN 1 ELSE 0 END) AS money,
          SUM(CASE WHEN ${FILTER_CLAUSES.you} THEN 1 ELSE 0 END) AS you
        FROM notifications
        WHERE recipient_wallet_address = ? AND is_read = 0
      `,
      [...FILTER_PARAMS.mentions, ...FILTER_PARAMS.money, walletAddress],
    )

    const unreadByFilter = {
      inbox: Number(unreadRows[0]?.inbox || 0),
      mentions: Number(unreadRows[0]?.mentions || 0),
      money: Number(unreadRows[0]?.money || 0),
      you: Number(unreadRows[0]?.you || 0),
    }

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
        // Scoped to the requested filter (unfiltered callers keep getting the grand total), with
        // the per-filter breakdown alongside it.
        unread_count: filter ? unreadByFilter[filter] : Number(unreadRows[0]?.total || 0),
        unread_by_filter: unreadByFilter,
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

export async function PATCH(request) {
  try {
    const body = await request.json()
    const { ids, wallet_address, mark_all, message, signature, up_address } = body

    if (mark_all) {
      if (!message || !signature) {
        return NextResponse.json({ success: false, error: 'message and signature are required' }, { status: 400 })
      }

      const timestampMatch = message.match(/Timestamp:\s*(\d+)/)
      if (!timestampMatch) {
        return NextResponse.json({ success: false, error: 'Invalid message format' }, { status: 400 })
      }
      if (Date.now() - Number(timestampMatch[1]) > SIG_MAX_AGE_MS) {
        return NextResponse.json({ success: false, error: 'Signature expired' }, { status: 400 })
      }

      let resolvedAddress
      if (up_address && isWalletAddress(up_address)) {
        const isValidERC1271 = await verifyERC1271(up_address, message, signature)
        if (isValidERC1271) {
          resolvedAddress = up_address.toLowerCase()
        } else {
          // EOA wallet on Lukso network — ERC1271 returns false for plain accounts
          try {
            const recovered = ethers.verifyMessage(message, signature).toLowerCase()
            if (recovered !== up_address.toLowerCase()) {
              return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 400 })
            }
            resolvedAddress = recovered
          } catch {
            return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 400 })
          }
        }
      } else {
        try {
          resolvedAddress = ethers.verifyMessage(message, signature).toLowerCase()
        } catch {
          return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 400 })
        }
      }

      await pool.execute(
        `UPDATE notifications SET is_read = 1, read_at = NOW() WHERE recipient_wallet_address = ? AND is_read = 0`,
        [resolvedAddress],
      )
      return NextResponse.json({ success: true })
    }

    if (!isWalletAddress(wallet_address)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids must be a non-empty array' }, { status: 400 })
    }

    const safeIds = ids.map(Number).filter(Number.isFinite)
    if (safeIds.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid ids provided' }, { status: 400 })
    }

    const placeholders = safeIds.map(() => '?').join(', ')
    await pool.execute(
      `UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id IN (${placeholders}) AND recipient_wallet_address = ? AND is_read = 0`,
      [...safeIds, wallet_address],
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[NOTIFICATIONS_MARK_READ_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to mark notifications as read' }, { status: 500 })
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
