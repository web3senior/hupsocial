/**
 * @file app/api/v1/agents/hosted/[address]/workspace/restore/route.js
 * @description Replaces the working copy with a snapshot the owner's browser read from the chain
 * and decrypted (POST {files}).
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError } from '@/lib/hostedAgents'
import { restoreWorkspace } from '@/lib/agentWorkspace'

export async function POST(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to change your agent' }, { status: 401 })
  try {
    const { address } = await params
    const { files } = await request.json().catch(() => ({}))
    await restoreWorkspace(owner, address, files)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[AGENT_WORKSPACE_RESTORE_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'The workspace could not be restored' }, { status: 500 })
  }
}
