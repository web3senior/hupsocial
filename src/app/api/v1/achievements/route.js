import { NextResponse } from 'next/server'
import { ACHIEVEMENTS } from '@/config/achievements'
import { readHolderCounts, readTotalWallets } from '@/lib/achievementsServer'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const [holders, totalWallets] = await Promise.all([readHolderCounts(), readTotalWallets()])
    return NextResponse.json({ success: true, data: { catalog: ACHIEVEMENTS, holders, totalWallets } }, { headers: { 'Cache-Control': 'public, s-maxage=60' } })
  } catch (error) {
    console.error('[ACHIEVEMENTS_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to load achievements', details: process.env.NODE_ENV === 'production' ? undefined : error.message }, { status: 500 })
  }
}
