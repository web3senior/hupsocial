/**
 * @file api/v1/users/[address]/badges/route.js
 * @description The community tags a wallet is entitled to wear — what the profile editor's badge
 * picker offers.
 *
 * Deliberately not a "my communities" endpoint: it lists memberships that can actually become a
 * badge, so a community with no tag, an archived one, or one the wallet was banned from never
 * shows up as a choice that would silently fail to render. The same rule validates the save
 * (lib/badge.js), so the picker can never offer something the setter then rejects.
 */

import { NextResponse } from 'next/server'
import { isWalletAddress } from '@/lib/address'
import { listWearableBadges } from '@/lib/badge'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { address } = await params

    if (!isWalletAddress(address)) {
      return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 })
    }

    /* Membership is public — the same list is visible on every community page — so this needs no
       viewer check. Nothing here is private to the wallet it belongs to. */
    const badges = await listWearableBadges(address)

    return NextResponse.json({ success: true, data: badges })
  } catch (error) {
    console.error('[USER_BADGES_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to load badges' }, { status: 500 })
  }
}
