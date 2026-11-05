import { NextResponse } from 'next/server'
import { readAchievementCatalog } from '@/lib/achievementCatalog'
import { readHolderCounts, readTotalWallets } from '@/lib/achievementsServer'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const [holders, totalWallets, catalog] = await Promise.all([readHolderCounts(), readTotalWallets(), readAchievementCatalog()])
    return NextResponse.json({ success: true, data: { catalog, holders, totalWallets } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[ACHIEVEMENTS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to load achievements', details: process.env.NODE_ENV === 'production' ? undefined : error.message }, { status: 500 })
  }
}
