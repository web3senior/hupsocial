import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(request, { params }) {
  try {
    const { address } = await params

    if (!address) {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 })
    }

    const [rows] = await pool.execute(
      `SELECT 
        u.*, 
        (SELECT COUNT(*) FROM posts p WHERE p.wallet_address = u.wallet_address) as total_posts
      FROM users u
      WHERE u.wallet_address = ?`,
      [address],
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    console.error('Database Error:', error.message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
