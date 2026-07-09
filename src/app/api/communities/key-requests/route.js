// app/api/communities/key-requests/route.js
//
// UI discovery index for the lazy key-delivery flow of encrypted communities. Two row types:
//   'grant'    — a member has no envelope for the current key version (e.g. joined-then-rotated,
//                or was offline during a rotation) and is waiting for a moderator to re-grant.
//   'rotation' — a member left voluntarily; leave() can't rotate the key itself (bumpKeyVersion
//                is moderator-only), so this row tells moderators a rotation is pending.
// Like community_join_requests, this is not security-critical: envelopes only ever move via the
// on-chain grantKey/grantKeyBatch, which are moderator-gated regardless of what this table says.

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let tableReady = null
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.execute(`
      CREATE TABLE IF NOT EXISTS community_key_requests (
        network_id INT UNSIGNED NOT NULL,
        community_id BIGINT UNSIGNED NOT NULL,
        wallet_address VARCHAR(42) NOT NULL,
        request_type VARCHAR(10) NOT NULL DEFAULT 'grant',
        key_version BIGINT UNSIGNED DEFAULT NULL,
        requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (network_id, community_id, wallet_address, request_type)
      )
    `)
  }
  return tableReady
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = searchParams.get('network_id')
    const communityId = searchParams.get('community_id')
    const requestType = searchParams.get('request_type')

    if (!networkId || !communityId) {
      return NextResponse.json({ error: 'network_id and community_id are required' }, { status: 400 })
    }

    await ensureTable()

    let query =
      'SELECT wallet_address, request_type, key_version, requested_at FROM community_key_requests WHERE network_id = ? AND community_id = ?'
    const params = [networkId, communityId]

    if (requestType) {
      query += ' AND request_type = ?'
      params.push(requestType)
    }
    query += ' ORDER BY requested_at ASC'

    const [rows] = await pool.execute(query, params)

    return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    console.error('[KEY_REQUESTS_FETCH_ERROR]:', e.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch key requests' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { networkId, communityId, walletAddress, requestType = 'grant', keyVersion = null } = await request.json()
    if (!networkId || !communityId || !walletAddress) {
      return NextResponse.json({ error: 'networkId, communityId and walletAddress are required' }, { status: 400 })
    }
    if (requestType !== 'grant' && requestType !== 'rotation') {
      return NextResponse.json({ error: 'requestType must be grant or rotation' }, { status: 400 })
    }

    await ensureTable()
    await pool.execute(
      'INSERT IGNORE INTO community_key_requests (network_id, community_id, wallet_address, request_type, key_version) VALUES (?, ?, ?, ?, ?)',
      [networkId, communityId, walletAddress.toLowerCase(), requestType, keyVersion],
    )

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[KEY_REQUEST_CREATE_ERROR]:', e.message)
    return NextResponse.json({ success: false, error: 'Failed to record key request' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url)
    const networkId = searchParams.get('network_id')
    const communityId = searchParams.get('community_id')
    const walletAddress = searchParams.get('wallet_address')
    const requestType = searchParams.get('request_type')

    if (!networkId || !communityId) {
      return NextResponse.json({ error: 'network_id and community_id are required' }, { status: 400 })
    }
    if (!walletAddress && !requestType) {
      return NextResponse.json({ error: 'wallet_address or request_type is required' }, { status: 400 })
    }

    await ensureTable()

    let query = 'DELETE FROM community_key_requests WHERE network_id = ? AND community_id = ?'
    const params = [networkId, communityId]

    if (walletAddress) {
      query += ' AND wallet_address = ?'
      params.push(walletAddress.toLowerCase())
    }
    if (requestType) {
      query += ' AND request_type = ?'
      params.push(requestType)
    }

    await pool.execute(query, params)

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[KEY_REQUEST_DELETE_ERROR]:', e.message)
    return NextResponse.json({ success: false, error: 'Failed to remove key requests' }, { status: 500 })
  }
}
