/**
 * @file api/v1/users/status/route.js
 * @description One wallet's offchain Status. GET reads it; POST sets or clears it with a signed
 * message (EOA or smart account through ERC-1271).
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { readUserStatus, saveUserStatus, StatusError } from '@/lib/userStatus'
import { verifyWalletSignature } from '@/lib/walletSignature'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request) {
  try {
    const address = new URL(request.url).searchParams.get('address')
    return NextResponse.json({ success: true, data: await readUserStatus(pool, address) }, { headers })
  } catch (error) {
    console.error('[USER_STATUS_READ_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Could not load status' }, { status: 500, headers })
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const status = await saveUserStatus(pool, body, verifyWalletSignature)
    return NextResponse.json({ success: true, data: status }, { headers })
  } catch (error) {
    if (!(error instanceof StatusError)) console.error('[USER_STATUS_WRITE_ERROR]:', error.message)
    return NextResponse.json(
      { success: false, error: error instanceof StatusError ? error.message : 'Could not save status' },
      { status: error instanceof StatusError ? error.status : 500, headers }
    )
  }
}
