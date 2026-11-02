/**
 * @file app/api/v1/agents/hosted/fee/route.js
 * @description What the signed-in owner's next agent costs on one network (GET ?chainId=): nothing
 * for their first, otherwise the creation fee in that network's own coin at the current price.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError } from '@/lib/hostedAgents'
import { quoteCreationFee } from '@/lib/agentBilling'

export const runtime = 'nodejs'

export async function GET(request) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to create an agent' }, { status: 401 })
  try {
    const chainId = Number(new URL(request.url).searchParams.get('chainId')) || undefined
    return NextResponse.json({ success: true, ...(await quoteCreationFee(owner, chainId)) })
  } catch (error) {
    if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[AGENT_FEE_QUOTE_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'The fee could not be priced' }, { status: 500 })
  }
}
