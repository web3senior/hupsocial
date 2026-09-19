// Retired: unauthenticated read, insert and delete over chat_messages, with no caller in the
// app — the live /chat page writes through /api/v1/relay and reads from IPFS.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const gone = () => NextResponse.json({ error: 'This endpoint has been retired.' }, { status: 410 })

export async function GET() {
  return gone()
}

export async function POST() {
  return gone()
}

export async function DELETE() {
  return gone()
}
