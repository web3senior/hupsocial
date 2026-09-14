import { NextResponse } from 'next/server'
import { readUniversalProfile } from '@/lib/lukso'

/**
 * POST handler for the Universal Profile proxy.
 * Thin wrapper over the shared LUKSO helper so client code can read a profile without an RPC of
 * its own; server code should import the helper directly.
 */
export async function POST(request) {
  let body

  /* Safely parse incoming payload */
  try {
    body = await request.json()
  } catch (parseError) {
    return NextResponse.json({ error: 'Invalid JSON payload provided' }, { status: 400 })
  }

  const addr = body.addr
  if (!addr) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 })
  }

  const { answered, profile } = await readUniversalProfile(addr)

  if (!answered) {
    return NextResponse.json({ error: 'Could not reach LUKSO' }, { status: 502 })
  }

  /* The list shape this endpoint has always answered in: empty when the wallet publishes no profile. */
  return NextResponse.json({ data: { Profile: profile ? [profile] : [] } })
}
