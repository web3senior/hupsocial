import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const DAILY_LIMIT = 5

export async function POST(request) {
  try {
    const payload = await request.json()
    const { wallet_address, identifier, category, subject, message, email } = payload

    if (!subject || !message) {
      return NextResponse.json(
        { success: false, error: 'Subject and Message fields are required.' },
        { status: 400 }
      )
    }

    /* An identifier is strictly required to enforce the daily rate limit */
    if (!identifier) {
      return NextResponse.json(
        { success: false, error: 'A valid user or guest identifier is required.' },
        { status: 400 }
      )
    }

    if (wallet_address && !isWalletAddress(wallet_address)) {
      return NextResponse.json(
        { success: false, error: 'The provided wallet address format is invalid.' },
        { status: 400 }
      )
    }

    /* Check the number of tickets sent by this identifier in the last 24 hours */
    const [rateCheck] = await pool.execute(
      `
        SELECT COUNT(*) AS ticket_count 
        FROM support_tickets 
        WHERE (wallet_address = ? OR wallet_address = ? OR email = ? OR message LIKE ?)
          AND created_at >= NOW() - INTERVAL 1 DAY
      `,
      [identifier, wallet_address || identifier, email || '', `%${identifier}%`]
    )

    /* Fallback precise validation if tracking columns exist or mapping against the explicit sender string */
    const [strictCheck] = await pool.execute(
      `
        SELECT COUNT(*) AS ticket_count
        FROM support_tickets
        WHERE (wallet_address = ? OR wallet_address = ?)
          AND created_at >= NOW() - INTERVAL 1 DAY
      `,
      [wallet_address || identifier, identifier]
    )

    const activeCount = Math.max(
      Number(rateCheck[0]?.ticket_count || 0), 
      Number(strictCheck[0]?.ticket_count || 0)
    )

    if (activeCount >= DAILY_LIMIT) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Daily submission threshold reached. You can only submit up to ${DAILY_LIMIT} tickets every 24 hours.` 
        },
        { status: 429 }
      )
    }

    /* Save the support ticket details into the relational database */
    const [result] = await pool.execute(
      `
        INSERT INTO support_tickets (
          wallet_address,
          category,
          subject,
          message,
          email,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, 'open', NOW())
      `,
      [
        wallet_address || identifier,
        category || 'general',
        subject.trim(),
        message.trim(),
        email || null
      ]
    )

    return NextResponse.json({
      success: true,
      ticketId: String(result.insertId),
      message: 'Support ticket successfully indexed.'
    })
  } catch (error) {
    console.error('[SUPPORT_TICKET_POST_ERROR]:', error.message)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process support request.',
        details: process.env.NODE_ENV === 'production' ? undefined : error.message,
      },
      { status: 500 }
    )
  }
}

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || '')
}