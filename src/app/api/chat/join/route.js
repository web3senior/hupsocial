/**
 * @file api/chat/join/route.js
 * @description Verifies signatures to check or save public stealth keys inside your database users table.
 */
import { NextResponse } from 'next/server';
import { recoverMessageAddress, isAddress } from 'viem';
import pool from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST: Register Public Key
 */
export async function POST(request) {
  try {
    const { signature, public_key } = await request.json();

    if (!signature || !public_key) {
      return NextResponse.json({ success: false, error: 'Missing public key or signature parameters' }, { status: 400 });
    }

    const cleanPublicKey = public_key.toLowerCase();
    const registrationMessage = `Join Chat Registry: ${cleanPublicKey}`;

    // Re-verify that the user signing the statement actually owns the address
    const walletAddress = await recoverMessageAddress({
      message: registrationMessage,
      signature: signature,
    });

    const cleanAddress = walletAddress.toLowerCase();

    // Insert or update directly targeting your wallet_address column layout
    await pool.execute(
      `INSERT INTO users (wallet_address, public_key, signature) 
       VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE public_key = VALUES(public_key), signature = VALUES(signature)`,
      [cleanAddress, cleanPublicKey, signature]
    );

    return NextResponse.json({ success: true, wallet_address: cleanAddress });

  } catch (error) {
    console.error('[CHAT_JOIN_POST_ERROR]:', error);
    return NextResponse.json({ success: false, error: error.message || 'Registration failed' }, { status: 500 });
  }
}

/**
 * GET: Fetch Registry Status / Public Key
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetAddress = searchParams.get('address');

    if (!targetAddress || !isAddress(targetAddress)) {
      return NextResponse.json({ success: false, error: 'Valid address parameter required.' }, { status: 400 });
    }

    const [rows] = await pool.execute(
      'SELECT public_key FROM users WHERE wallet_address = ?',
      [targetAddress.toLowerCase()]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: true, registered: false, public_key: null });
    }

    return NextResponse.json({ success: true, registered: true, public_key: rows[0].public_key });

  } catch (error) {
    console.error('[CHAT_JOIN_GET_ERROR]:', error);
    return NextResponse.json({ success: false, error: 'Database registry lookup failed' }, { status: 500 });
  }
}