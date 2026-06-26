import { ethers } from 'ethers'
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
