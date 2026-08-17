/**
 * @file app/api/v1/users/email/route.js
 * @description Read, toggle and remove a profile's notification email.
 *
 * GET is intentionally lossy: it reports state and a masked address only, so
 * the endpoint never becomes an email directory keyed by wallet. The full
 * address is shown nowhere after verification — the owner knows what they
 * typed.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// in***@g***.com — enough for the owner to recognize, useless to a scraper
const maskEmail = (email) => {
  const [user, domain] = email.split('@')
  const [host, ...tld] = domain.split('.')
  return `${user.slice(0, 2)}***@${host.slice(0, 1)}***.${tld.join('.')}`
}

const walletFrom = (value) => {
  const wallet = String(value || '').trim().toLowerCase()
  return ADDRESS_RE.test(wallet) ? wallet : null
}

export async function GET(request) {
  try {
    const wallet = walletFrom(new URL(request.url).searchParams.get('address'))
    if (!wallet) return NextResponse.json({ success: false, error: 'Wallet address is required' }, { status: 400 })

    const [[row]] = await pool.execute(
      `SELECT email, email_verified_at, email_notifications FROM users WHERE wallet_address = ?`,
      [wallet],
    )
    if (!row) return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 })

    const verified = Boolean(row.email && row.email_verified_at)
    return NextResponse.json({
      success: true,
      email: {
        verified,
        masked: verified ? maskEmail(row.email) : null,
        enabled: verified ? Boolean(row.email_notifications) : false,
      },
    })
  } catch (error) {
    console.error('[NOTIFY_EMAIL_GET_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to load email settings' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const { address, enabled } = await request.json()
    const wallet = walletFrom(address)
    if (!wallet) return NextResponse.json({ success: false, error: 'Wallet address is required' }, { status: 400 })

    const [update] = await pool.execute(
      `UPDATE users SET email_notifications = ? WHERE wallet_address = ? AND email_verified_at IS NOT NULL`,
      [enabled ? 1 : 0, wallet],
    )
    if (update.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'No verified email on this profile' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[NOTIFY_EMAIL_PATCH_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to update email settings' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { address } = await request.json()
    const wallet = walletFrom(address)
    if (!wallet) return NextResponse.json({ success: false, error: 'Wallet address is required' }, { status: 400 })

    await pool.execute(
      `UPDATE users SET email = NULL, email_verified_at = NULL, email_notifications = 1 WHERE wallet_address = ?`,
      [wallet],
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[NOTIFY_EMAIL_DELETE_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to remove the email' }, { status: 500 })
  }
}
