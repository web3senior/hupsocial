import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { achievementAdminMessage, validateAchievementAdminClaim } from '@/lib/achievements'
import { achievementsAreMigrated, awardAchievement, listAchievementHolders, revokeAchievement, runAchievementRules } from '@/lib/achievementsServer'
import { verifyWalletSignature } from '@/lib/walletSignature'
import { readAchievementCatalog, saveAchievementSetting } from '@/lib/achievementCatalog'
import { achievementSettingMessage, validateAchievementSetting } from '@/lib/achievementSettings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()

function failure(error) {
  console.error('[ADMIN_ACHIEVEMENTS_ERROR]:', error.message)
  const status = error.status ?? (error instanceof SyntaxError ? 400 : 500)
  return NextResponse.json({ success: false, error: status < 500 || status === 503 ? error.message : 'Could not manage achievements', details: process.env.NODE_ENV === 'production' ? undefined : error.message }, { status })
}

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams
    const holders = params.has('id') ? await listAchievementHolders(params.get('id'), params.get('scope') ?? '') : []
    const catalog = await readAchievementCatalog()
    return NextResponse.json({ success: true, data: { holders, catalog } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request) {
  if (!ADMIN_WALLET) return NextResponse.json({ success: false, error: 'Admin is not configured.' }, { status: 503 })
  try {
    const body = await request.json()
    const isSetting = ['settings', 'reset-settings'].includes(body?.action)
    const claim = isSetting
      ? { ...validateAchievementSetting(body), nonce: body.nonce, signature: body.signature, chainId: body.chainId }
      : validateAchievementAdminClaim(body)
    if (isSetting && (typeof claim.signature !== 'string' || !claim.signature || claim.signature.length > 16384 ||
      typeof claim.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(claim.nonce))) {
      return NextResponse.json({ success: false, error: 'A wallet signature and fresh nonce are required' }, { status: 400 })
    }
    const message = isSetting ? achievementSettingMessage(claim, claim.nonce) : achievementAdminMessage(claim)
    if (!await verifyWalletSignature(ADMIN_WALLET, message, claim.signature, { chainId: claim.chainId })) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    if (!isSetting && !await achievementsAreMigrated()) return NextResponse.json({ success: false, error: 'Run deploy/migrations/20261105-user-achievements.sql first.' }, { status: 503 })
    const [burn] = await pool.execute('DELETE FROM nonces WHERE nonce = ? AND wallet_address = ? AND expires_at > NOW()', [claim.nonce, ADMIN_WALLET])
    if (!burn.affectedRows) return NextResponse.json({ success: false, error: 'Invalid or expired nonce' }, { status: 401 })
    let data
    if (isSetting) {
      await saveAchievementSetting(claim, ADMIN_WALLET)
      data = { catalog: await readAchievementCatalog() }
    } else if (claim.action === 'run') data = await runAchievementRules({ only: claim.id, notify: claim.notify })
    else if (claim.action === 'grant') data = { inserted: await awardAchievement({ wallets: [claim.wallet], id: claim.id, scope: claim.scope, source: 'admin', grantedBy: ADMIN_WALLET, note: claim.note || null, notify: claim.notify }) }
    else data = { revoked: await revokeAchievement(claim) }
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return failure(error)
  }
}
