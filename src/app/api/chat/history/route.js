import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const topic = searchParams.get('topic')

    // Validate the incoming topic parameter
    if (!topic) {
      return NextResponse.json(
        { success: false, error: 'Topic hash parameter is required' }, 
        { status: 400 }
      )
    }

    // Use pool.query directly to execute the query safely via prepared statements
    const [messages] = await pool.query(
      `SELECT id, topic, encrypted_key, content, cid, created_at
       FROM chats
       WHERE topic = ?
       ORDER BY created_at ASC`,
      [topic]
    )

    return NextResponse.json({
      success: true,
      messages: messages
    })

  } catch (error) {
    console.error('[DATABASE_HISTORY_POOL_ERROR]:', error)
    return NextResponse.json(
      { success: false, error: 'Internal pipeline connection dropped' }, 
      { status: 500 }
    )
  }
}
