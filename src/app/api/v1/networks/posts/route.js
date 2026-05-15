/**
 * @file api/v1/posts/route.js
 * @description Fetches indexed posts with multichain support filtering by chain_id.
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

    // Filters
    const chainId = searchParams.get('chain_id') // e.g., 4201 for LUKSO Testnet
    const walletAddress = searchParams.get('wallet_address')

    let queryParams = []

    // 1. Build the Base Query with User Profile and Network Joins
    let query = `
      SELECT 
        p.*,
        u.name as display_name,
        u.profileImage as profile_image,
        n.name as network_name,
        n.chain_id,
        n.explorer_url
      FROM posts p
      LEFT JOIN users u ON p.wallet_address = u.wallet_address
      JOIN networks n ON p.network_id = n.id
      WHERE 1=1
    `

    // 2. Apply dynamic filters using chain_id from the networks table
    if (chainId) {
      query += ` AND n.chain_id = ?`
      queryParams.push(chainId)
    }
    if (walletAddress) {
      query += ` AND p.wallet_address = ?`
      queryParams.push(walletAddress)
    }

    // 3. Sorting and Pagination
    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    queryParams.push(limit + 1, offset)

    /* 4. Execute using standardized pool */
    const [rows] = await pool.execute(query, queryParams)

    // 5. Handle "Has More" for infinite scroll
    const hasMore = rows.length > limit
    const postsToSend = hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    return NextResponse.json({
      success: true,
      data: postsToSend.map(post => ({
        ...post,
        // Safely handle IPFS JSON data
        content: parseIPFSContent(post.content)
      })),
      nextPage,
      meta: {
        page,
        count: postsToSend.length,
        hasMore,
        filter_chain_id: chainId || 'all'
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