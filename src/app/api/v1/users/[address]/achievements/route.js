import { NextResponse } from 'next/server'
import { isWalletAddress, normalizeAddress } from '@/lib/address'
import { readAchievementSummary } from '@/lib/achievementsServer'

export const runtime = 'nodejs'

export async function GET(_request, { params }) {
  try {
    const { address } = await params
    if (!isWalletAddress(address)) return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 })
    return NextResponse.json({ success: true, data: await readAchievementSummary(normalizeAddress(address)) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[USER_ACHIEVEMENTS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to load achievements', details: process.env.NODE_ENV === 'production' ? undefined : error.message }, { status: 500 })
  }
}
