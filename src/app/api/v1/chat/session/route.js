/**
 * @file app/api/v1/chat/session/route.js
 * @description Turns one wallet signature into a chat bearer token. Nonce from /api/v1/auth/nonce,
 * message from lib/chatSignature.js, verified for EOAs and smart accounts alike.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress } from '@/lib/address'
import { verifyWalletSignature } from '@/lib/walletSignature'
import { chatSessionMessage, CHAT_SIGNATURE_MAX_AGE_MS } from '@/lib/chatSignature'
import { mintChatToken } from '@/lib/chatSession'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const address = normalizeAddress(body?.address)
    const { signature, nonce } = body ?? {}
    const issuedAt = Number(body?.issuedAt)

    if (!isEvmAddress(address) || typeof signature !== 'string' || typeof nonce !== 'string' || !Number.isFinite(issuedAt)) {
      return NextResponse.json({ success: false, error: 'address, nonce, issuedAt and signature are required' }, { status: 400 })
    }
    if (Math.abs(Date.now() - issuedAt) > CHAT_SIGNATURE_MAX_AGE_MS) {
      return NextResponse.json({ success: false, error: 'This sign-in has expired, try again' }, { status: 400 })
    }

    // Burned before verification so a replay never gets a second look
    const [burn] = await pool.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [
      nonce,
      address,
    ])
    if (burn.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Nonce is missing or expired' }, { status: 400 })
    }

    const message = chatSessionMessage({ address, nonce, issuedAt })
    const signed = await verifyWalletSignature(address, message, signature, { chainId: body?.chainId })
    if (!signed) {
      return NextResponse.json({ success: false, error: 'Signature does not match this wallet' }, { status: 401 })
    }

    return NextResponse.json({ success: true, token: mintChatToken(address), address })
  } catch (error) {
    console.error('[CHAT_SESSION_ERROR]:', error)
    return NextResponse.json({ success: false, error: 'Failed to open a chat session' }, { status: 500 })
  }
}
