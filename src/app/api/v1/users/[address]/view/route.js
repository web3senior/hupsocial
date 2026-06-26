/**
 * @file api/v1/users/[address]/view/route.js
 * @description Records a unique view for a specific user profile.
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  try {
    const { address } = await params;

    if (!address) {
      return NextResponse.json(
        { success: false, error: 'Missing profile address' },
        { status: 400 }
      );
    }

    const [rows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM profile_views WHERE wallet_address = ?',
      [address.toLowerCase()]
    );

    return NextResponse.json({ success: true, total: rows[0].total });
  } catch (error) {
    console.error('[PROFILE_VIEW_COUNT_ERROR]:', error.message);

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request, { params }) {
  try {
    const { address } = await params;
    const { viewer_id } = await request.json();
    const userAgent = request.headers.get('user-agent');

    if (!address || !viewer_id) {
      return NextResponse.json(
        { success: false, error: 'Missing profile address or viewer identity' },
        { status: 400 }
      );
    }

    const query = `
      INSERT IGNORE INTO profile_views (wallet_address, viewer_id, user_agent)
      VALUES (?, ?, ?)
    `;

    await pool.execute(query, [address.toLowerCase(), viewer_id, userAgent]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PROFILE_VIEW_RECORD_ERROR]:', error.message);

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
