// Retired: an unauthenticated proxy onto GEMINI_API_KEY with no caller in the app.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({ error: 'This endpoint has been retired.' }, { status: 410 })
}
