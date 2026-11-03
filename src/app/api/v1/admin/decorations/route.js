/**
 * @file api/v1/admin/decorations/route.js
 * @description The admin's controls for avatar decorations.
 *
 * GET is behind the admin pass (lib/adminPassServer.js): every decoration as it stands — catalog
 * values with the admin's setting applied — and what the shop has sold.
 *
 * POST sets or resets one decoration's price, profile-only switch and shop listing, only for a
 * signature from the admin wallet over decorationSettingMessage plus a fresh nonce, burned before
 * anything is written.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { hasAdminPass } from '@/lib/adminPassServer'
import { readDecorationCatalog, readDecorationSales, saveDecorationSetting, validateDecorationSetting } from '@/lib/decorationCatalog'
import { decorationSettingMessage } from '@/lib/decorationSettings'
import { DecorationError } from '@/lib/userDecorations'
import { verifyWalletSignature } from '@/lib/walletSignature'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()
const headers = { 'Cache-Control': 'private, no-store' }

const fail = (error, status = 400) => NextResponse.json({ success: false, error }, { status, headers })

export async function GET(request) {
  if (!(await hasAdminPass(request))) return fail('Admin pass required', 401)
  try {
    const [catalog, sales] = await Promise.all([readDecorationCatalog(pool), readDecorationSales(pool)])
    return NextResponse.json({ success: true, data: { items: [...catalog.values()], sales } }, { headers })
  } catch (error) {
    console.error('[ADMIN_DECORATIONS_READ_ERROR]:', error.message)
    return fail('Could not load decorations', 500)
  }
}

export async function POST(request) {
  if (!ADMIN_WALLET) return fail('Admin is not configured.', 503)

  try {
    const body = await request.json().catch(() => null)
    if (typeof body?.signature !== 'string' || typeof body?.nonce !== 'string') return fail('A signature and nonce are required.')
    const change = validateDecorationSetting(body)

    const message = decorationSettingMessage({ ...change, nonce: body.nonce })
    if (!(await verifyWalletSignature(ADMIN_WALLET, message, body.signature, { chainId: body.chainId }))) return fail('Forbidden', 403)

    const [burn] = await pool.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [body.nonce, ADMIN_WALLET])
    if (burn.affectedRows === 0) return fail('Invalid or expired nonce', 401)

    await saveDecorationSetting(pool, change)
    const catalog = await readDecorationCatalog(pool)
    return NextResponse.json({ success: true, data: catalog.get(change.decorationId) }, { headers })
  } catch (error) {
    if (error instanceof DecorationError) return fail(error.message, error.status)
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      console.warn('[DECORATION_SETTINGS_TABLE_MISSING]: apply deploy/migrations/20261104-decoration-settings.sql')
      return fail('Decoration settings are not set up: run the 20261104-decoration-settings.sql migration.', 503)
    }
    console.error('[ADMIN_DECORATIONS_WRITE_ERROR]:', error.message)
    return fail('Could not update that decoration.', 500)
  }
}
