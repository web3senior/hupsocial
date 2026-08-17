/**
 * @file app/api/v1/auth/email/keystore/route.js
 * @description Session-gated storage for the split-key material of an email wallet.
 *
 * What the server holds is deliberately never enough to sign: server_share is one
 * XOR half of the key (encrypted again at rest under KEYSTORE_MASTER_KEY), and
 * backup_blob was encrypted client-side with the user's recovery password before
 * it ever reached the wire. GET releases both halves the server has to the
 * authenticated owner; PUT stores them at wallet creation and rotates the share
 * pair during recovery on a new device.
 */

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import pool from '@/lib/db'
import { sessionFromRequest } from '@/lib/emailAuthSession'

const HEX_64_RE = /^[0-9a-f]{64}$/
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const MAX_BACKUP_BLOB = 4096

// --- At-rest envelope for the server share ---
// AES-256-GCM under KEYSTORE_MASTER_KEY so a DB dump alone (the XAMPP MariaDB
// has needed full rebuilds before) leaks nothing usable, even paired with the
// user's device share.

const masterKey = () => {
  const hex = process.env.KEYSTORE_MASTER_KEY
  if (!hex || !HEX_64_RE.test(hex)) throw new Error('KEYSTORE_MASTER_KEY must be 32 bytes of hex')
  return Buffer.from(hex, 'hex')
}

const sealShare = (shareHex) => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv)
  const data = Buffer.concat([cipher.update(shareHex, 'utf8'), cipher.final()])
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })
}

const openShare = (sealed) => {
  const { iv, tag, data } = JSON.parse(sealed)
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}

// --- Handlers ---

export async function GET(request) {
  try {
    const session = sessionFromRequest(request)
    if (!session) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })

    const [[row]] = await pool.execute(
      `SELECT wallet_address, server_share, backup_blob, kdf_params FROM email_keystore WHERE account_id = ?`,
      [session.accountId],
    )
    if (!row) return NextResponse.json({ success: false, error: 'No wallet yet' }, { status: 404 })

    return NextResponse.json({
      success: true,
      keystore: {
        walletAddress: row.wallet_address,
        serverShare: openShare(row.server_share),
        backupBlob: row.backup_blob,
        kdfParams: row.kdf_params,
      },
    })
  } catch (error) {
    console.error('[EMAIL_KEYSTORE_GET_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to load the keystore' }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const session = sessionFromRequest(request)
    if (!session) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })

    const { walletAddress, serverShare, backupBlob, kdfParams } = await request.json()

    if (
      !ADDRESS_RE.test(walletAddress || '') ||
      !HEX_64_RE.test(serverShare || '') ||
      typeof backupBlob !== 'string' ||
      backupBlob.length === 0 ||
      backupBlob.length > MAX_BACKUP_BLOB ||
      typeof kdfParams !== 'string' ||
      kdfParams.length > 255
    ) {
      return NextResponse.json({ success: false, error: 'Malformed keystore payload' }, { status: 400 })
    }

    // The address is immutable once bound: a hijacked session may rotate shares
    // (that is what recovery does) but can never swap in a different wallet —
    // rebinding would silently orphan whatever the original address holds.
    const [[account]] = await pool.execute(`SELECT wallet_address FROM email_accounts WHERE id = ?`, [session.accountId])
    if (!account) return NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 })
    if (account.wallet_address && account.wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json({ success: false, error: 'This account already has a different wallet' }, { status: 409 })
    }

    await pool.execute(
      `INSERT INTO email_keystore (account_id, wallet_address, server_share, backup_blob, kdf_params)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       server_share = VALUES(server_share),
       backup_blob = VALUES(backup_blob),
       kdf_params = VALUES(kdf_params)`,
      [session.accountId, walletAddress, sealShare(serverShare), backupBlob, kdfParams],
    )
    await pool.execute(`UPDATE email_accounts SET wallet_address = ? WHERE id = ?`, [walletAddress, session.accountId])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[EMAIL_KEYSTORE_PUT_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to store the keystore' }, { status: 500 })
  }
}

/**
 * Reset: the escape hatch for a lost recovery password AND lost device. Deletes
 * the keystore and unbinds the address so the create flow can mint a fresh
 * wallet — the old address and anything it holds are abandoned forever, which
 * is why the dialog demands a typed confirmation before calling this.
 */
export async function DELETE(request) {
  try {
    const session = sessionFromRequest(request)
    if (!session) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })

    await pool.execute(`DELETE FROM email_keystore WHERE account_id = ?`, [session.accountId])
    await pool.execute(`UPDATE email_accounts SET wallet_address = NULL WHERE id = ?`, [session.accountId])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[EMAIL_KEYSTORE_DELETE_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to reset the wallet' }, { status: 500 })
  }
}
