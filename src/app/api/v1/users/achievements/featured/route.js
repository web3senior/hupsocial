import { NextResponse } from 'next/server'
import { featuredAchievementMessage, validateFeaturedAchievementClaim } from '@/lib/achievements'
import { setFeaturedAchievement } from '@/lib/achievementsServer'
import { verifyWalletSignature } from '@/lib/walletSignature'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const claim = validateFeaturedAchievementClaim(await request.json())
    if (!await verifyWalletSignature(claim.address, featuredAchievementMessage(claim), claim.signature, { chainId: claim.chainId })) {
      return NextResponse.json({ success: false, error: 'Signature does not match this wallet' }, { status: 401 })
    }
    const featured = await setFeaturedAchievement({ wallet: claim.address, id: claim.achievementId, scope: claim.scope, nonce: claim.nonce })
    return NextResponse.json({ success: true, data: { featured } })
  } catch (error) {
    console.error('[FEATURED_ACHIEVEMENT_ERROR]:', error.message)
    const status = error.status ?? (error instanceof SyntaxError ? 400 : 500)
    return NextResponse.json({ success: false, error: status < 500 || status === 503 ? error.message : 'Could not feature achievement', details: process.env.NODE_ENV === 'production' ? undefined : error.message }, { status })
  }
}
