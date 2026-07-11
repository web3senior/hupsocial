// app/api/store/sales/route.js
//
// Manual sync endpoint for the store_sales history index behind the /revenue page.
// Drives the initial backfill (repeat POST until done: true) and lets the buy flow
// ping it right after a purchase tx confirms, mirroring the listings sync convention.
// The revenue GET route also syncs lazily, so this is an accelerator, not a requirement —
// see lib/storeSalesIndex.js.

import { NextResponse } from 'next/server'
import { syncStoreSales } from '@/lib/storeSalesIndex'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const { networkId } = await request.json()
    const network = Number(networkId)

    if (!Number.isInteger(network) || network <= 0) {
      return NextResponse.json({ success: false, error: 'networkId is required' }, { status: 400 })
    }

    const scanned = await syncStoreSales({ networkId: network, force: true })
    return NextResponse.json({ success: true, scanned })
  } catch (e) {
    console.error('[STORE_SALES_SYNC_ERROR]:', e.message)
    return NextResponse.json({ success: false, error: 'Failed to sync sales' }, { status: 500 })
  }
}
