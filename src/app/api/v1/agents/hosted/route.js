/**
 * @file app/api/v1/agents/hosted/route.js
 * @description The signed-in owner's hosted agents: list them, or register a new one. Identity is
 * the chat session token, as for Hupi; a new agent also carries its own signature proving the
 * owner's vault derived it. Creating agents is free.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError, createAgent, listAgents } from '@/lib/hostedAgents'

const failure = (error, tag) => {
  if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
  console.error(`[${tag}]:`, error.message)
  return NextResponse.json({ success: false, error: 'Your agents could not be reached' }, { status: 500 })
}

export async function GET(request) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to see your agents' }, { status: 401 })

  try {
    return NextResponse.json({ success: true, agents: await listAgents(owner) })
  } catch (error) {
    return failure(error, 'HOSTED_AGENTS_LIST_ERROR')
  }
}

export async function POST(request) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to create an agent' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const agent = await createAgent(owner, body)
    return NextResponse.json({ success: true, agent }, { status: 201 })
  } catch (error) {
    return failure(error, 'HOSTED_AGENTS_CREATE_ERROR')
  }
}
