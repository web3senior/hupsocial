/**
 * @file app/api/v1/users/email/confirm/route.js
 * @description Verifies the code and binds the email to the profile as its notification address.
 *
 * The OTP proves inbox ownership — that is the guarantee the cron sweeper
 * relies on before sending anything. Binding to the wallet address follows the
 * app's existing profile-write trust model (no signature is demanded anywhere
 * for profile writes today); tightening that is a global auth task, not an
 * email one.
 */

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import pool from '@/lib/db'
import { hashOtp } from '@/lib/emailAuthSession'

const MAX_ATTEMPTS = 5
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export async function POST(request) {
  try {
    const { address, email, code } = await request.json()
    const normalized = String(email || '').trim().toLowerCase()
    const wallet = String(address || '').trim().toLowerCase()
    const submitted = String(code || '').trim()

    if (!ADDRESS_RE.test(wallet) || !normalized || !/^\d{6}$/.test(submitted)) {
      return NextResponse.json({ success: false, error: 'Address, email and 6-digit code are required' }, { status: 400 })
    }

    const [burn] = await pool.execute(
      `UPDATE email_otps SET attempts = attempts + 1
       WHERE email = ? AND purpose = 'notify' AND consumed = 0 AND expires_at > NOW() AND attempts < ?`,
      [normalized, MAX_ATTEMPTS],
    )
    if (burn.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Code expired or too many attempts — request a new one' }, { status: 400 })
    }

    const [[row]] = await pool.execute(`SELECT code_hash FROM email_otps WHERE email = ? AND purpose = 'notify'`, [normalized])
    const expected = Buffer.from(row.code_hash)
    const actual = Buffer.from(hashOtp(normalized, submitted))
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return NextResponse.json({ success: false, error: 'Incorrect code' }, { status: 400 })
    }

    await pool.execute(`UPDATE email_otps SET consumed = 1 WHERE email = ? AND purpose = 'notify'`, [normalized])

    const [update] = await pool.execute(
      `UPDATE users SET email = ?, email_verified_at = NOW(), email_notifications = 1 WHERE wallet_address = ?`,
      [normalized, wallet],
    )
    if (update.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[NOTIFY_EMAIL_CONFIRM_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to verify the code' }, { status: 500 })
  }
}
