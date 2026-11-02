/**
 * @file app/api/v1/agents/hosted/[address]/sessions/[id]/route.js
 * @description Delete one of the agent's sessions, with its messages and drafts.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError, deleteSession } from '@/lib/hostedAgents'

export async function DELETE(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to change your agent' }, { status: 401 })
  try {
    const { address, id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 })
    await deleteSession(owner, address, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[AGENT_SESSION_DELETE_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'The chat could not be deleted' }, { status: 500 })
  }
}
