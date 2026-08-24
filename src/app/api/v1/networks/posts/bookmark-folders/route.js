/**
 * @file api/v1/networks/posts/bookmark-folders/route.js
 * @description Lists and creates a wallet's bookmark folders, used to organize saved posts (see post_bookmarks.folder_id).
 */
import { NextResponse } from 'next/server'
import { isWalletAddress, normalizeAddress } from '@/lib/address'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const MAX_NAME_LENGTH = 100

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const walletAddress = searchParams.get('wallet_address')

    if (!isWalletAddress(walletAddress)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    const [rows] = await pool.execute(
      `SELECT f.*, COUNT(b.id) AS post_count
       FROM bookmark_folders f
       LEFT JOIN post_bookmarks b ON b.folder_id = f.id
       WHERE f.wallet_address = ?
       GROUP BY f.id
       ORDER BY f.created_at ASC`,
      [normalizeAddress(walletAddress)]
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (error) {
    console.error('[BOOKMARK_FOLDERS_FETCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch bookmark folders' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { wallet_address, name } = await request.json()

    if (!isWalletAddress(wallet_address)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    const trimmedName = String(name || '').trim()
    if (!trimmedName || trimmedName.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ success: false, error: `Folder name must be between 1 and ${MAX_NAME_LENGTH} characters` }, { status: 400 })
    }

    const [result] = await pool.execute(
      `INSERT INTO bookmark_folders (wallet_address, name) VALUES (?, ?)`,
      [normalizeAddress(wallet_address), trimmedName]
    )

    return NextResponse.json({ success: true, data: { id: result.insertId, wallet_address: normalizeAddress(wallet_address), name: trimmedName, post_count: 0 } })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ success: false, error: 'You already have a folder with that name' }, { status: 409 })
    }
    console.error('[BOOKMARK_FOLDER_CREATE_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to create folder' }, { status: 500 })
  }
}

