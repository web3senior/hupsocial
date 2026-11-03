/**
 * @file api/v1/users/decorations/quote/route.js
 * @description Opens an order for a paid decoration: what it costs in the chosen network's coin
 * right now, and where to send it. Unsigned — a quote moves nothing; the transfer that pays it is
 * what proves who bought (see confirm).
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { quoteDecoration, shopTablesMissing } from '@/lib/decorationShop'
import { PaymentError } from '@/lib/onchainPayment'
import { DecorationError } from '@/lib/userDecorations'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    return NextResponse.json({ success: true, data: await quoteDecoration(pool, body) }, { headers })
  } catch (caught) {
    const error = shopTablesMissing(caught) ?? caught
    const known = error instanceof DecorationError || error instanceof PaymentError
    if (!known) console.error('[DECORATION_QUOTE_ERROR]:', error.message)
    return NextResponse.json(
      { success: false, error: known ? error.message : 'Could not price that decoration' },
      { status: known ? error.status : 500, headers }
    )
  }
}
