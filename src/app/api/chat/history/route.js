// Retired alongside the rest of /api/chat — see ../route.js.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ error: 'This endpoint has been retired.' }, { status: 410 })
}
