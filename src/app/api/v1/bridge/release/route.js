/**
 * @file api/v1/bridge/release/route.js
 * @description POST { txHash } → the signed source-chain release for each Hup bridge burn in that
 * LUKSO transaction, once it is deep enough. Until then it answers pending or confirming.
 */

import { attestBurn } from '@/lib/hupBridge/attest'
import { BridgeError, fail, ok } from '@/lib/hupBridge/respond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body) throw new BridgeError('Expected a JSON body')
    return ok(await attestBurn({ txHash: body.txHash }))
  } catch (error) {
    return fail(error)
  }
}
