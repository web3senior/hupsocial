/**
 * @file api/v1/notifications/subscribe/route.js
 * @description Verifies wallet ownership via signature before persisting push subscription.
 */
import { NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import pool from '@/lib/db';

export async function POST(request) {
  try {
    const { signature, nonce, subscription } = await request.json();

    // Recover the real wallet address from the signature
    const walletAddress = await recoverMessageAddress({
      message: `Subscribe to ${process.env.NEXT_PUBLIC_NAME} push notifications.\nNonce: ${nonce}`,
      signature,
    });

    // Validate nonce exists, belongs to this wallet, and hasn't expired
    const [rows] = await pool.execute(
      `SELECT id FROM nonces 
       WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()`,
      [nonce, walletAddress.toLowerCase()]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid or expired nonce' }, { status: 401 });
    }

    // Consume the nonce so it can't be reused
    await pool.execute('DELETE FROM nonces WHERE nonce = ?', [nonce]);

    const { endpoint, keys: { p256dh, auth } } = subscription;

    await pool.execute(
      `INSERT INTO push_subscriptions (wallet_address, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE endpoint = VALUES(endpoint), auth = VALUES(auth)`,
      [walletAddress.toLowerCase(), endpoint, p256dh, auth]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUSH_SUBSCRIPTION_ERROR]:', error.message);
    return NextResponse.json({ success: false, error: 'Registration failed' }, { status: 500 });
  }
}