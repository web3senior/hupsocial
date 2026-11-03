/**
 * @file api/v1/users/decorations/route.js
 * @description One wallet's avatar decorations. GET reads what it wears and which paid ones it
 * owns; POST replaces the whole worn set with a signed message (EOA or smart account through
 * ERC-1271), refusing paid decorations the wallet has not bought. Profiles also carry the worn set
 * as `decorations`, so bylines never call this — it is the sheet's read and write.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { readOwnedDecorations } from '@/lib/decorationShop'
import { readDecorationCatalog } from '@/lib/decorationCatalog'
import { DecorationError, readUserDecorations, saveUserDecorations } from '@/lib/userDecorations'
import { verifyWalletSignature } from '@/lib/walletSignature'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request) {
  try {
    const address = new URL(request.url).searchParams.get('address')
    const [equipped, owned] = await Promise.all([readUserDecorations(pool, address), readOwnedDecorations(pool, address)])
    return NextResponse.json({ success: true, data: { equipped, owned } }, { headers })
  } catch (error) {
    console.error('[USER_DECORATIONS_READ_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Could not load decorations' }, { status: 500, headers })
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const decorations = await saveUserDecorations(pool, body, verifyWalletSignature, { readOwned: readOwnedDecorations, readCatalog: readDecorationCatalog })
    return NextResponse.json({ success: true, data: decorations }, { headers })
  } catch (error) {
    if (!(error instanceof DecorationError)) console.error('[USER_DECORATIONS_WRITE_ERROR]:', error.message)
    return NextResponse.json(
      { success: false, error: error instanceof DecorationError ? error.message : 'Could not save decorations' },
      { status: error instanceof DecorationError ? error.status : 500, headers }
    )
  }
}
