/**
 * @file app/api/v1/users/email/request-code/route.js
 * @description Emails a verification code for attaching a notification email to a profile.
 *
 * Same OTP machinery as email login but under purpose 'notify', so a login code
 * and a verify code for the same inbox never clobber each other. The code is
 * what makes the feature safe: notifications only ever go to an inbox that
 * proved it wanted them.
 */

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import pool from '@/lib/db'
import { hashOtp } from '@/lib/emailAuthSession'
import { sendEmailVerifyCode } from '@/lib/mailer'

const OTP_TTL_MS = 10 * 60 * 1000
const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_EMAIL = 3
const MAX_PER_IP = 10
const hits = new Map()

const throttled = (key, max) => {
  // Production-only: in dev the whole team shares 127.0.0.1, so e2e runs would
  // lock real testing out for 15 minutes at a time. The DB attempt counter
  // still guards code-guessing either way.
  if (process.env.NODE_ENV !== 'production') return false
  const now = Date.now()
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= max) return true
  recent.push(now)
  hits.set(key, recent)
  return false
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export async function POST(request) {
  try {
    const { address, email } = await request.json()
    const normalized = String(email || '').trim().toLowerCase()
    const wallet = String(address || '').trim().toLowerCase()

    if (!ADDRESS_RE.test(wallet)) {
      return NextResponse.json({ success: false, error: 'Wallet address is required' }, { status: 400 })
    }
    if (!EMAIL_RE.test(normalized) || normalized.length > 254) {
      return NextResponse.json({ success: false, error: 'A valid email address is required' }, { status: 400 })
    }

    const [existing] = await pool.execute(`SELECT wallet_address FROM users WHERE wallet_address = ?`, [wallet])
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 })
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1'
    if (throttled(`email:${normalized}`, MAX_PER_EMAIL) || throttled(`ip:${ip}`, MAX_PER_IP)) {
      return NextResponse.json({ success: false, error: 'Too many codes requested — try again in a few minutes' }, { status: 429 })
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0')
    const expiresAt = new Date(Date.now() + OTP_TTL_MS)

    await pool.execute(
      `INSERT INTO email_otps (email, purpose, code_hash, expires_at, attempts, consumed)
       VALUES (?, 'notify', ?, ?, 0, 0)
       ON DUPLICATE KEY UPDATE
       code_hash = VALUES(code_hash),
       expires_at = VALUES(expires_at),
       attempts = 0,
       consumed = 0`,
      [normalized, hashOtp(normalized, code), expiresAt],
    )

    await sendEmailVerifyCode(normalized, code)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[NOTIFY_EMAIL_REQUEST_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to send the verification code' }, { status: 502 })
  }
}
