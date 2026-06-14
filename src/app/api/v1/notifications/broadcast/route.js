/**
 * @file api/v1/notifications/broadcast/route.js
 * @description Admin-only route. Verifies the caller is the admin wallet,
 *              then broadcasts a push notification to all subscribed users.
 */
import { NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import webpush from 'web-push';
import pool from '@/lib/db';

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL}`,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase();

export async function POST(request) {
  try {
    const { signature, nonce, message } = await request.json();

    const walletAddress = await recoverMessageAddress({
      message: `Broadcast notification.\nNonce: ${nonce}`,
      signature,
    });

    // Gate: only the admin wallet can broadcast
    if (walletAddress.toLowerCase() !== ADMIN_WALLET) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const [nonceRows] = await pool.execute(
      `SELECT id FROM nonces 
       WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()`,
      [nonce, walletAddress.toLowerCase()]
    );

    if (nonceRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid or expired nonce' }, { status: 401 });
    }

    await pool.execute('DELETE FROM nonces WHERE nonce = ?', [nonce]);

    // Fetch all subscriptions across all users
    const [rows] = await pool.execute(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions'
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'No subscribers found' }, { status: 404 });
    }

    const payload = JSON.stringify({ title: 'Announcement', body: message });

    const results = await Promise.allSettled(
      rows.map(({ endpoint, p256dh, auth }) =>
        webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, payload)
      )
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.error('[BROADCAST_PARTIAL_FAILURE]:', failed.map(f => f.reason?.message));
    }

    return NextResponse.json({
      success: true,
      total: rows.length,
      sent: results.length - failed.length,
      failed: failed.length,
    });
  } catch (error) {
    console.error('[BROADCAST_ERROR]:', error.message);
    return NextResponse.json({ success: false, error: 'Broadcast failed' }, { status: 500 });
  }
}