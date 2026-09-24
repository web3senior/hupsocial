/**
 * @file api/v1/whitelist/route.js
 * @description The mint whitelist. Joining demands a signature so the list only holds
 * wallets whose owners asked — never a pasted exchange deposit address. The primary key on
 * wallet_address refuses duplicates, not a check-then-write.
 */

import { NextResponse } from 'next/server'
import { ethers } from 'ethers'
import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress, sameAddress } from '@/lib/address'
import { hasTable } from '@/lib/schema'
import { verifyWalletSignature } from '@/lib/walletSignature'
import { whitelistJoinMessage } from '@/lib/whitelist'

export const runtime = 'nodejs'

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

/* Production is migrated by hand (cidex/scripts/add-hup-whitelist.sql), so the page can ship
   before its table does and say so instead of 500ing. */
const NOT_MIGRATED = { success: false, error: 'The whitelist is not open yet' }

/** Whether the signature came from a private key rather than a smart account's ERC-1271. */
const isEcdsaSigner = (address, message, signature) => {
  try {
    return sameAddress(ethers.verifyMessage(message, signature), address)
  } catch {
    return false
  }
}

/** The total, and whether `?address=` is already on the list. */
export async function GET(request) {
  try {
    if (!(await hasTable('hup_whitelist'))) return NextResponse.json(NOT_MIGRATED, { status: 503 })

    const address = normalizeAddress(new URL(request.url).searchParams.get('address'))

    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM hup_whitelist')

    let joinedAt = null
    if (isEvmAddress(address)) {
      const [[row]] = await pool.execute('SELECT joined_at FROM hup_whitelist WHERE wallet_address = ? LIMIT 1', [address])
      joinedAt = row?.joined_at ?? null
    }

    return NextResponse.json({ success: true, total: Number(total), joined: Boolean(joinedAt), joinedAt })
  } catch (error) {
    console.error('[WHITELIST_READ_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

/** Adds the signing wallet. Joining twice is not an error — it reports the original sign-up. */
export async function POST(request) {
  try {
    const body = await request.json()
    const address = normalizeAddress(body?.address)
    const signature = typeof body?.signature === 'string' ? body.signature : ''
    const nonce = typeof body?.nonce === 'string' ? body.nonce : ''
    const issuedAt = Number(body?.issuedAt)
    const chainId = Number(body?.chainId)

    if (!isEvmAddress(address)) {
      return NextResponse.json({ success: false, error: 'A wallet address is required' }, { status: 400 })
    }

    if (!(await hasTable('hup_whitelist'))) return NextResponse.json(NOT_MIGRATED, { status: 503 })

    if (!signature || !nonce || !Number.isFinite(issuedAt)) {
      return NextResponse.json({ success: false, error: 'That request arrived without a signature — try again' }, { status: 400 })
    }
    if (Math.abs(Date.now() - issuedAt) > SIGNATURE_MAX_AGE_MS) {
      return NextResponse.json({ success: false, error: 'That signature has expired — try again' }, { status: 400 })
    }

    /* Burned before the signature is checked, so a captured request cannot be replayed and a
       wrong signature costs the nonce rather than allowing guesses at it. */
    const [burn] = await pool.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [nonce, address])
    if (burn.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'That challenge expired — try again' }, { status: 400 })
    }

    const message = whitelistJoinMessage({ address, nonce, issuedAt })
    const signed = await verifyWalletSignature(address, message, signature, { chainId })
    if (!signed) {
      return NextResponse.json({ success: false, error: 'That signature does not match the wallet' }, { status: 401 })
    }

    const [insert] = await pool.execute(
      'INSERT IGNORE INTO hup_whitelist (wallet_address, chain_id, is_contract, joined_at) VALUES (?, ?, ?, NOW())',
      [address, Number.isInteger(chainId) && chainId > 0 ? chainId : null, isEcdsaSigner(address, message, signature) ? 0 : 1],
    )

    const [[row]] = await pool.execute('SELECT joined_at FROM hup_whitelist WHERE wallet_address = ? LIMIT 1', [address])
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM hup_whitelist')

    return NextResponse.json({
      success: true,
      alreadyJoined: insert.affectedRows === 0,
      joinedAt: row?.joined_at ?? null,
      total: Number(total),
    })
  } catch (error) {
    console.error('[WHITELIST_JOIN_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
