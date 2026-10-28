/**
 * @file api/v1/bridge/claim/route.js
 * @description POST { chainId, txHash } → the signed LUKSO claim for each Hup bridge deposit in that
 * source-chain transaction, once it is deep enough. Until then it answers pending or confirming
 * with the depth so far, and the page polls.
 */

import { attestDeposit } from '@/lib/hupBridge/attest'
import { BridgeError, fail, ok } from '@/lib/hupBridge/respond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The first claim of a token pins its icon and metadata to IPFS
export const maxDuration = 60

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body) throw new BridgeError('Expected a JSON body')
    return ok(await attestDeposit({ chainId: Number(body.chainId), txHash: body.txHash }))
  } catch (error) {
    return fail(error)
  }
}
