import { NextResponse } from 'next/server'
import { queryUniversalProfile } from '@/lib/lukso'

/**
 * POST handler for the Universal Profile proxy.
 * Thin wrapper over the shared LUKSO helper so client code can query without
 * exposing the upstream endpoint; server code should import the helper directly.
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

  const data = await queryUniversalProfile(addr)

  if (!data) {
    return NextResponse.json({ error: 'Failed to communicate with upstream API service' }, { status: 502 })
  }

  return NextResponse.json(data)
}
