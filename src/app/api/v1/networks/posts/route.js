/**
 * @file api/v1/posts/route.js
 * @description Fetches indexed posts with multichain support filtering by chain_id, computes live engagement metrics from the unified posts table, and verifies viewer likes.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Pagination parameters
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 20
    const offset = (page - 1) * limit

    // Filters and viewer context
    const networkId = searchParams.get('network_id') 
    const walletAddress = searchParams.get('wallet_address')
    const viewerAddress = searchParams.get('viewer_address') 

    let queryParams = []

    // Push the viewer address parameter first if it exists to match the conditional subquery placement
    if (viewerAddress) {
      queryParams.push(viewerAddress)
    }

    // Build the Base Query with User Profile, Network Joins, and unified Metric calculations
    let query = `
      SELECT 
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.explorer_url,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND network_id = p.network_id) as total_likes,
        (SELECT COUNT(*) FROM posts WHERE is_comment = p.id AND network_id = p.network_id) as total_comments,
        (SELECT COUNT(*) FROM post_views WHERE post_id = p.id) as total_views,
        ${viewerAddress ? `(SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND network_id = p.network_id AND liker = ?))` : '0'} as has_liked
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      WHERE p.is_comment IS NULL
    `

    // Apply dynamic filters using the direct performance indexes set on the posts table
    if (networkId) {
      query += ` AND p.network_id = ?`
      queryParams.push(networkId)
    }
    if (walletAddress) {
      query += ` AND p.wallet_address = ?`
      queryParams.push(walletAddress)
    }

    // Sorting and Pagination
    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    queryParams.push(limit + 1, offset)

    /* Execute using standardized pool */
    const [rows] = await pool.execute(query, queryParams)

    // Handle "Has More" for infinite scroll
    const hasMore = rows.length > limit
    const postsToSend = hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    return NextResponse.json({
      success: true,
      data: postsToSend.map(post => ({
        ...post,
        // Map the boolean identifier to match your frontend expectations cleanly
        is_liked: Boolean(post.has_liked),
        // Safely handle IPFS JSON data
        content: parseIPFSContent(post.content)
      })),
      nextPage,
      meta: {
        page,
        count: postsToSend.length,
        hasMore,
        filter_chain_id: networkId || 'all'
      }
    })

  } catch (error) {
    console.error('[POSTS_FETCH_ERROR]:', error.message)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch posts' }, 
      { status: 500 }
    )
  }
}

/**
 * Helper to safely handle IPFS JSON data stored in the DB
 */
function parseIPFSContent(content) {
  try {
    return JSON.parse(content)
  } catch (e) {
    return content 
  }
}