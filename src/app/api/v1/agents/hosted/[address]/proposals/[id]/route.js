/**
 * @file app/api/v1/agents/hosted/[address]/proposals/[id]/route.js
 * @description Records what the owner did with one of their agent's drafts: published (with the
 * transaction the browser sent) or discarded. Publishing itself never happens here — the agent's
 * key lives only in the owner's browser.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError, resolveProposal } from '@/lib/hostedAgents'

export async function PATCH(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to change your agent' }, { status: 401 })

  try {
    const { address, id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    await resolveProposal(owner, address, id, await request.json().catch(() => ({})))
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[AGENT_PROPOSAL_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'The draft could not be updated' }, { status: 500 })
  }
}
