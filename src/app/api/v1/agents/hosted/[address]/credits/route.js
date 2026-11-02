/**
 * @file app/api/v1/agents/hosted/[address]/credits/route.js
 * @description An agent's credits: balance, recent charges and top-ups (GET), and crediting a
 * top-up the agent's wallet just sent (POST {txHash}), checked onchain before anything is added.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError, getAgent } from '@/lib/hostedAgents'
import { creditTopUp, readBilling } from '@/lib/agentBilling'

export const runtime = 'nodejs'

const failure = (error) => {
  if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
  console.error('[AGENT_CREDITS_ERROR]:', error.message)
  return NextResponse.json({ success: false, error: 'Credits could not be reached' }, { status: 500 })
}

export async function GET(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to see your agent' }, { status: 401 })
  try {
    const { address } = await params
    const agent = await getAgent(owner, address)
    return NextResponse.json({ success: true, balance: agent.credits, ...(await readBilling(agent.address)) })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to top up your agent' }, { status: 401 })
  try {
    const { address } = await params
    const agent = await getAgent(owner, address)
    const { txHash } = await request.json().catch(() => ({}))
    return NextResponse.json({ success: true, ...(await creditTopUp(agent, txHash)) })
  } catch (error) {
    return failure(error)
  }
}
