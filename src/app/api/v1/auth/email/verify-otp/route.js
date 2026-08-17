/**
 * @file app/api/v1/auth/email/verify-otp/route.js
 * @description Verifies a login code, upserts the account and mints the session cookie.
 */

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import pool from '@/lib/db'
import { hashOtp, mintSessionToken, sessionCookieOptions, SESSION_COOKIE } from '@/lib/emailAuthSession'

const MAX_ATTEMPTS = 5

export async function POST(request) {
  try {
    const { email, code } = await request.json()
    const normalized = String(email || '').trim().toLowerCase()
    const submitted = String(code || '').trim()

    if (!normalized || !/^\d{6}$/.test(submitted)) {
      return NextResponse.json({ success: false, error: 'Email and 6-digit code are required' }, { status: 400 })
    }

    // Attempts are burned BEFORE the comparison so a failed request can never be
    // replayed for a free guess; five wrong codes dead-end the OTP.
    const [burn] = await pool.execute(
      `UPDATE email_otps SET attempts = attempts + 1
       WHERE email = ? AND purpose = 'login' AND consumed = 0 AND expires_at > NOW() AND attempts < ?`,
      [normalized, MAX_ATTEMPTS],
    )
    if (burn.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Code expired or too many attempts — request a new one' }, { status: 400 })
    }

    const [[row]] = await pool.execute(`SELECT code_hash FROM email_otps WHERE email = ? AND purpose = 'login'`, [normalized])
    const expected = Buffer.from(row.code_hash)
    const actual = Buffer.from(hashOtp(normalized, submitted))
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return NextResponse.json({ success: false, error: 'Incorrect code' }, { status: 400 })
    }

    await pool.execute(`UPDATE email_otps SET consumed = 1 WHERE email = ? AND purpose = 'login'`, [normalized])

    await pool.execute(
      `INSERT INTO email_accounts (email, last_login_at) VALUES (?, NOW())
       ON DUPLICATE KEY UPDATE last_login_at = NOW()`,
      [normalized],
    )

    const [[account]] = await pool.execute(
      `SELECT a.id, a.wallet_address, k.account_id IS NOT NULL AS has_keystore
       FROM email_accounts a
       LEFT JOIN email_keystore k ON k.account_id = a.id
       WHERE a.email = ?`,
      [normalized],
    )

    const response = NextResponse.json({
      success: true,
      account: {
        email: normalized,
        walletAddress: account.wallet_address,
        hasKeystore: Boolean(account.has_keystore),
      },
    })
    response.cookies.set(SESSION_COOKIE, mintSessionToken(account.id, normalized), sessionCookieOptions())
    return response
  } catch (error) {
    console.error('[EMAIL_OTP_VERIFY_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to verify the code' }, { status: 500 })
  }
}
