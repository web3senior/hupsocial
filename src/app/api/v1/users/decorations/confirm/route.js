/**
 * @file api/v1/users/decorations/confirm/route.js
 * @description Grants a paid decoration once the transfer paying its order checks out onchain.
 * Safe to call again for the same order and transfer — a client that lost the response, or one
 * finishing a purchase on its next visit, gets the same answer.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { confirmDecorationOrder, shopTablesMissing } from '@/lib/decorationShop'
import { PaymentError } from '@/lib/onchainPayment'
import { DecorationError } from '@/lib/userDecorations'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    return NextResponse.json({ success: true, data: await confirmDecorationOrder(pool, body) }, { headers })
  } catch (caught) {
    const error = shopTablesMissing(caught) ?? caught
    const known = error instanceof DecorationError || error instanceof PaymentError
    if (!known) console.error('[DECORATION_CONFIRM_ERROR]:', error.message)
    return NextResponse.json(
      { success: false, error: known ? error.message : 'Could not confirm that purchase' },
      { status: known ? error.status : 500, headers }
    )
  }
}
