import { NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import pool from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST: Persist an isolated, un-linkable blind contact pointer record.
 */
export async function POST(request) {
  try {
    const { signature, blind_lookup_key, encrypted_data } = await request.json();

    if (!signature || !blind_lookup_key || !encrypted_data) {
      return NextResponse.json({ success: false, error: 'Missing sync payload data values' }, { status: 400 });
    }

    // 1. Rebuild the challenge text matching our frontend blind key signature
    const challengeMessage = `Sync Contact Room Hash: ${blind_lookup_key}`;
    const userAddress = await recoverMessageAddress({
      message: challengeMessage,
      signature
    });

    const cleanUserAddress = userAddress.toLowerCase();

    // 2. Persist data entirely without exposed cleartext topic correlations
    await pool.execute(
      `INSERT INTO contacts (user_address, blind_lookup_key, encrypted_data, is_accepted)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE encrypted_data = VALUES(encrypted_data)`,
      [cleanUserAddress, blind_lookup_key, encrypted_data]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CONTACTS_POST_ERROR]:', error);
    return NextResponse.json({ success: false, error: 'Failed to write contact data' }, { status: 500 });
  }
}

/**
 * GET: Fetch all isolated contacts for a specific user.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const signature = searchParams.get('signature');
    const timestamp = searchParams.get('timestamp');

    if (!signature || !timestamp) {
      return NextResponse.json({ success: false, error: 'Missing validation elements' }, { status: 400 });
    }

    // Limit replay validation window allowance to 5 minutes max
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return NextResponse.json({ success: false, error: 'Challenge window expired' }, { status: 401 });
    }

    const challengeMessage = `Fetch My Contacts Log: ${timestamp}`;
    const userAddress = await recoverMessageAddress({
      message: challengeMessage,
      signature
    });

    // Extract records using solely the owner's authenticated identity key
    const [rows] = await pool.execute(
      'SELECT blind_lookup_key, encrypted_data, is_accepted FROM contacts WHERE user_address = ?',
      [userAddress.toLowerCase()]
    );

    return NextResponse.json({ success: true, contacts: rows });
  } catch (error) {
    console.error('[CONTACTS_GET_ERROR]:', error);
    return NextResponse.json({ success: false, error: 'Failed to query database context' }, { status: 500 });
  }
}