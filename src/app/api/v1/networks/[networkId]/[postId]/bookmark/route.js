/**
 * @file api/v1/networks/[networkId]/[postId]/bookmark/route.js
 * @description Saves/unsaves a post for a wallet. Bookmarks are purely offchain (see Hup.sol notice), so this is a plain DB toggle with no onchain transaction required.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function POST(request, { params }) {
  try {
    const { networkId, postId } = await params
    const { wallet_address, folder_id } = await request.json()

    if (!isWalletAddress(wallet_address)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    const folderId = folder_id ? Number(folder_id) : null

    await pool.execute(
      `INSERT INTO post_bookmarks (network_id, post_id, wallet_address, folder_id) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE folder_id = VALUES(folder_id)`,
      [networkId, postId, wallet_address.toLowerCase(), folderId]
    )

    return NextResponse.json({ success: true, data: { is_bookmarked: true, folder_id: folderId } })
  } catch (error) {
    console.error('[BOOKMARK_ADD_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to save post' }, { status: 500 })
  }
}

export async function PATCH(request, { params }) {
  try {
    const { networkId, postId } = await params
    const { wallet_address, folder_id } = await request.json()

    if (!isWalletAddress(wallet_address)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    const folderId = folder_id ? Number(folder_id) : null

    const [result] = await pool.execute(
      `UPDATE post_bookmarks SET folder_id = ? WHERE network_id = ? AND post_id = ? AND wallet_address = ?`,
      [folderId, networkId, postId, wallet_address.toLowerCase()]
    )

    if (result.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Post is not saved yet' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { folder_id: folderId } })
  } catch (error) {
    console.error('[BOOKMARK_MOVE_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to move saved post' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { networkId, postId } = await params
    const { searchParams } = new URL(request.url)
    const walletAddress = searchParams.get('wallet_address')

    if (!isWalletAddress(walletAddress)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    await pool.execute(
      `DELETE FROM post_bookmarks WHERE network_id = ? AND post_id = ? AND wallet_address = ?`,
      [networkId, postId, walletAddress.toLowerCase()]
    )

    return NextResponse.json({ success: true, data: { is_bookmarked: false } })
  } catch (error) {
    console.error('[BOOKMARK_REMOVE_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to remove saved post' }, { status: 500 })
  }
}

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || '')
}
