/**
 * @file app/api/v1/agents/hosted/[address]/workspace/snapshots/route.js
 * @description Notes a snapshot the owner's browser just wrote onchain (POST {chainId, fileId,
 * txHash, size}), for the history. The chain is the record; this is a cache of it.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError } from '@/lib/hostedAgents'
import { recordSnapshot } from '@/lib/agentWorkspace'

export async function POST(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to change your agent' }, { status: 401 })
  try {
    const { address } = await params
    await recordSnapshot(owner, address, await request.json().catch(() => ({})))
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[AGENT_SNAPSHOT_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'The snapshot could not be noted' }, { status: 500 })
  }
}
