/**
 * @file api/v1/networks/posts/bookmark-folders/[folderId]/route.js
 * @description Renames or deletes a wallet's bookmark folder. Deleting a folder un-files its posts (post_bookmarks.folder_id -> NULL via FK) rather than deleting the bookmarks.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const MAX_NAME_LENGTH = 100

export async function PATCH(request, { params }) {
  try {
    const { folderId } = await params
    const { wallet_address, name } = await request.json()

    if (!isWalletAddress(wallet_address)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    const trimmedName = String(name || '').trim()
    if (!trimmedName || trimmedName.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ success: false, error: `Folder name must be between 1 and ${MAX_NAME_LENGTH} characters` }, { status: 400 })
    }

    const [result] = await pool.execute(
      `UPDATE bookmark_folders SET name = ? WHERE id = ? AND wallet_address = ?`,
      [trimmedName, folderId, wallet_address.toLowerCase()]
    )

    if (result.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Folder not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { id: Number(folderId), name: trimmedName } })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ success: false, error: 'You already have a folder with that name' }, { status: 409 })
    }
    console.error('[BOOKMARK_FOLDER_RENAME_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to rename folder' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { folderId } = await params
    const { searchParams } = new URL(request.url)
    const walletAddress = searchParams.get('wallet_address')

    if (!isWalletAddress(walletAddress)) {
      return NextResponse.json({ success: false, error: 'Valid wallet address is required' }, { status: 400 })
    }

    const [result] = await pool.execute(
      `DELETE FROM bookmark_folders WHERE id = ? AND wallet_address = ?`,
      [folderId, walletAddress.toLowerCase()]
    )

    if (result.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Folder not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { id: Number(folderId) } })
  } catch (error) {
    console.error('[BOOKMARK_FOLDER_DELETE_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to delete folder' }, { status: 500 })
  }
}

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || '')
}
