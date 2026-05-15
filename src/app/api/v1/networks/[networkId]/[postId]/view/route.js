/**
 * @file api/v1/posts/[id]/view/route.js
 * @description Records a unique view for a specific post using its database ID from the URL.
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  try {
    /* Extract the unique database ID from the dynamic route parameter */
    const { networkId, postId } = await params;
    
    /* Retrieve the viewer identifier from the request body */
    const { viewer_id } = await request.json();
    const userAgent = request.headers.get('user-agent');

    /* Validate that both the post and viewer identities are present */
    if (!networkId || !postId || !viewer_id) {
      return NextResponse.json(
        { success: false, error: 'Missing post ID or viewer identity' },
        { status: 400 }
      );
    }

    /* Use INSERT IGNORE to skip recording if this specific viewer has already seen this post */
    const query = `
      INSERT IGNORE INTO post_views (network_id, post_id, viewer_id, user_agent)
      VALUES (?, ?, ?, ?)
    `;

    /* The 'id' from the URL maps directly to your 'post_id' in the views table */
    await pool.execute(query, [networkId, postId, viewer_id, userAgent]);

    return NextResponse.json({ success: true });
  } catch (error) {
    /* Log internal errors for debugging while keeping the response user-friendly */
    console.error('[VIEW_RECORD_ERROR]:', error.message);
    
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}