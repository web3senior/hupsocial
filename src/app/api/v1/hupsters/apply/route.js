/**
 * @file api/v1/hupsters/apply/route.js
 * @description Applying to be a Hupster. The wallet signs applicationMessage over a fresh nonce,
 * burned before anything is written, so an application always comes from the wallet it names —
 * an EOA or a Universal Profile alike (verifyWalletSignature asks a smart account directly).
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { isEvmAddress, normalizeAddress } from '@/lib/address'
import { verifyWalletSignature } from '@/lib/walletSignature'
import { APPLICATION_MESSAGE_MAX, applicationMessage, parseProofLinks, REAPPLY_AFTER_DAYS } from '@/lib/roles'
import { applicationsAreMigrated, submitApplication } from '@/lib/rolesServer'

export const runtime = 'nodejs'

const ROLE = 'ambassador'

export async function POST(request) {
  try {
    const { wallet: rawWallet, message, links, signature, nonce, chainId } = await request.json()

    if (!isEvmAddress(rawWallet) || !signature || !nonce) {
      return NextResponse.json({ success: false, error: 'wallet, signature and nonce are required.' }, { status: 400 })
    }

    const proof = parseProofLinks(links)
    if (proof.length === 0) {
      return NextResponse.json({ success: false, error: 'Add at least one link to a post you made about Hup.' }, { status: 400 })
    }

    const wallet = normalizeAddress(rawWallet)

    const signed = await verifyWalletSignature(wallet, applicationMessage({ wallet: rawWallet, nonce }), signature, { chainId })
    if (!signed) {
      return NextResponse.json({ success: false, error: 'That signature does not match the wallet.' }, { status: 401 })
    }

    const [burn] = await pool.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [nonce, wallet])
    if (burn.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'That challenge expired — try again.' }, { status: 401 })
    }

    if (!(await applicationsAreMigrated())) {
      return NextResponse.json({ success: false, error: 'Applications are not open yet.' }, { status: 503 })
    }

    const note = typeof message === 'string' ? message.trim().slice(0, APPLICATION_MESSAGE_MAX) : ''
    const result = await submitApplication({ wallet, role: ROLE, message: note || null, links: proof })

    if (!result.ok) {
      const error = result.reason === 'member' ? 'You are already a Hupster.' : `You can apply again ${REAPPLY_AFTER_DAYS} days after a decision.`
      return NextResponse.json({ success: false, error }, { status: 409 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('HUPSTERS_APPLY_ERROR:', error.message)
    return NextResponse.json({ success: false, error: 'Could not send your application.' }, { status: 500 })
  }
}
