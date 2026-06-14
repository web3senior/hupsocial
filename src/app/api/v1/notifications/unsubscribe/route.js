/**
 * @file api/v1/notifications/unsubscribe/route.js
 * @description Verifies wallet ownership via signature before removing push subscription.
 */
import { NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import pool from '@/lib/db';

export async function POST(request) {
  try {
    const { signature, nonce } = await request.json();

    const walletAddress = await recoverMessageAddress({
      message: `Unsubscribe from ${process.env.NEXT_PUBLIC_NAME} push notifications.\nNonce: ${nonce}`,
      signature,
    });

    const [rows] = await pool.execute(
      `SELECT id FROM nonces 
       WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()`,
      [nonce, walletAddress.toLowerCase()]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid or expired nonce' }, { status: 401 });
    }

    await pool.execute('DELETE FROM nonces WHERE nonce = ?', [nonce]);

    await pool.execute(
      'DELETE FROM push_subscriptions WHERE wallet_address = ?',
      [walletAddress.toLowerCase()]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUSH_UNSUBSCRIBE_ERROR]:', error.message);
    return NextResponse.json({ success: false, error: 'Unsubscribe failed' }, { status: 500 });
  }
}