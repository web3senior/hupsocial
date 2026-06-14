/**
 * @file app/api/v1/auth/merchant/nonce/route.js
 * @description Generates a cryptographic nonce for Merchant login.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import crypto from 'crypto'

export async function POST(request) {
  try {
    const { wallet_address } = await request.json()

    if (!wallet_address) {
      return NextResponse.json({ success: false, error: 'Wallet address is required' }, { status: 400 })
    }

    // Cryptographically secure hex string
    const nonce = crypto.randomBytes(16).toString('hex')
    // const ip_address = request.headers.get('x-forwarded-for') || request.ip || '127.0.0.1'

    // Expiration: 5 minutes is standard for SIWE
    const expires_at = new Date(Date.now() + 5 * 60 * 1000)

    /**
     * Use ON DUPLICATE KEY UPDATE.
     * This prevents errors if a merchant requests a second nonce before the first one expires.
     */
    await pool.execute(
      `INSERT INTO nonces (nonce, wallet_address, entity_type, expires_at) 
       VALUES (?, ?, 'user', ?)
       ON DUPLICATE KEY UPDATE 
       nonce = VALUES(nonce), 
       expires_at = VALUES(expires_at)`,
      [nonce, wallet_address.toLowerCase(), expires_at],
    )

    return NextResponse.json({
      success: true,
      nonce,
      message: `Sign this message to verify ownership of this wallet for ${process.env.NEXT_PUBLIC_NAME}.`,
    })
  } catch (error) {
    console.error('[AUTH_NONCE_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to generate challenge' }, { status: 500 })
  }
}
