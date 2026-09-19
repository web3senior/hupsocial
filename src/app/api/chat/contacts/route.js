// Retired alongside the rest of /api/chat — see ../route.js.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const gone = () => NextResponse.json({ error: 'This endpoint has been retired.' }, { status: 410 })

export async function GET() {
  return gone()
}

export async function POST() {
  return gone()
}
