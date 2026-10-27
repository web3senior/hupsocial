/**
 * @file api/v1/admin/roles/route.js
 * @description Admin-given roles (lib/roles.js) — the Hupster ambassador mark first.
 *
 * GET lists who holds a role. Unsigned: every holder already wears the mark on their profile, so
 * the list is nothing a stranger could not assemble; the admin page gates who looks.
 *
 * POST grants or revokes, and only for a signature from the admin wallet over roleMessage plus a
 * fresh nonce, burned before anything is written. The wallet may be given as an address or as a
 * handle (`@alice`), since that is how the team knows the people they are picking.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { isWalletAddress, normalizeAddress } from '@/lib/address'
import { hasColumn } from '@/lib/schema'
import { readHandleSegment } from '@/lib/username'
import { verifyWalletSignature } from '@/lib/walletSignature'
import { isRole, roleMessage } from '@/lib/roles'
import { grantRole, listRoleHolders, revokeRole, rolesAreMigrated } from '@/lib/rolesServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()

const NOTE_MAX = 255

/** An address, or the wallet behind a handle; null when it is neither. */
async function resolveWallet(input) {
  const raw = String(input ?? '').trim()
  if (isWalletAddress(raw)) return normalizeAddress(raw)

  const handle = readHandleSegment(raw)
  if (!handle || !(await hasColumn('users', 'username_key'))) return null

  const [[row]] = await pool.execute('SELECT wallet_address FROM users WHERE username_key = ? LIMIT 1', [handle.key])
  return row ? normalizeAddress(row.wallet_address) : null
}

export async function GET(request) {
  const role = new URL(request.url).searchParams.get('role') ?? 'ambassador'
  if (!isRole(role)) {
    return NextResponse.json({ success: false, error: 'Unknown role' }, { status: 400 })
  }

  try {
    return NextResponse.json({ success: true, data: await listRoleHolders(role) })
  } catch (error) {
    console.error('ADMIN_ROLES_READ_ERROR:', error.message)
    return NextResponse.json({ success: false, error: 'Could not read role holders.' }, { status: 500 })
  }
}

export async function POST(request) {
  if (!ADMIN_WALLET) {
    return NextResponse.json({ success: false, error: 'Admin is not configured.' }, { status: 503 })
  }

  try {
    const { action, wallet: input, role, note, signature, nonce, chainId } = await request.json()

    if ((action !== 'grant' && action !== 'revoke') || !isRole(role) || !signature || !nonce) {
      return NextResponse.json({ success: false, error: 'action, wallet, role, signature and nonce are required.' }, { status: 400 })
    }

    /* The admin signs over exactly what they typed, so the signature is checked against the raw
       input before it is resolved — a handle that changes hands mid-request cannot redirect it. */
    const signed = await verifyWalletSignature(ADMIN_WALLET, roleMessage({ action, wallet: input, role, nonce }), signature, { chainId })
    if (!signed) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const [burn] = await pool.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [nonce, ADMIN_WALLET])
    if (burn.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Invalid or expired nonce' }, { status: 401 })
    }

    if (!(await rolesAreMigrated())) {
      return NextResponse.json({ success: false, error: 'Run cidex/scripts/add-user-roles.sql first.' }, { status: 503 })
    }

    const wallet = await resolveWallet(input)
    if (!wallet) {
      return NextResponse.json({ success: false, error: 'No wallet or handle matches that.' }, { status: 404 })
    }

    if (action === 'grant') {
      const trimmed = typeof note === 'string' ? note.trim().slice(0, NOTE_MAX) : ''
      await grantRole({ wallet, role, grantedBy: ADMIN_WALLET, note: trimmed || null })
      return NextResponse.json({ success: true, data: { wallet, role, granted: true } })
    }

    const held = await revokeRole({ wallet, role })
    return NextResponse.json({ success: true, data: { wallet, role, granted: false, held } })
  } catch (error) {
    console.error('ADMIN_ROLES_WRITE_ERROR:', error.message)
    return NextResponse.json({ success: false, error: 'Could not update the role.' }, { status: 500 })
  }
}
