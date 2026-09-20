/**
 * @file api/v1/premium/route.js
 * @description Everything the /premium page needs in one request: the price table across every
 * chain premium is sold on, the connected wallet's standing, and the native coin price per
 * chain so a plan can be quoted in dollars.
 *
 * The prices are the reason this is one call rather than a contract read per chain. Premium is
 * priced in native wei per chain to hit one dollar target, so a pricing page that read the
 * chain would make eight RPC round trips before it could render a number. cidex indexes the
 * contracts' own PlanUpdated logs instead, and this reads the table.
 */
import { NextResponse } from 'next/server'
import { nativePricesFor } from '@/lib/fundServer'
import {
  premiumDeployments,
  premiumIsLive,
  readPlans,
  readPremium,
  readPremiumSpotlight,
  readPurchases,
  readTokenPrices,
} from '@/lib/premiumServer'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const address = request.nextUrl.searchParams.get('address')
    const deployments = premiumDeployments()

    if (!premiumIsLive()) {
      /* No chain in this build has a HupPremium yet. A 200 with live:false lets the page say
         so plainly; a 404 would read as a broken route. */
      return NextResponse.json({
        success: true,
        data: { live: false, plans: [], tokens: [], prices: {}, status: null, purchases: [], spotlight: null },
      })
    }

    const [plans, tokens, status, purchases, spotlight] = await Promise.all([
      readPlans(),
      readTokenPrices(),
      address ? readPremium(address) : Promise.resolve(null),
      address ? readPurchases(address) : Promise.resolve([]),
      readPremiumSpotlight(address),
    ])

    /* Every chain that sells premium, not just the ones with an indexed plan row — a chain
       whose cursor has not reached its deploy block yet should still be quotable once it does,
       and the page prices what it can. */
    const prices = await nativePricesFor(deployments.map((entry) => entry.networkId))

    return NextResponse.json({
      success: true,
      data: {
        live: true,
        plans,
        tokens,
        prices,
        status,
        purchases,
        /* A current subscriber with a handle, for the profile nudge to name. */
        spotlight,
        meta: { chains: deployments.map((entry) => entry.networkId) },
      },
    })
  } catch (error) {
    console.error('[GET_PREMIUM_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
