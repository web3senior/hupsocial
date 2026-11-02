/**
 * @file app/api/v1/agents/hosted/[address]/route.js
 * @description One of the owner's agents: its settings, one chat session with its drafts, and the
 * list of recent sessions (GET ?session=), or a settings
 * change — name, instructions, pause, model, whether its profile names the owner (PATCH) — or its
 * removal from Hup (DELETE); its wallet, profile and posts stay onchain.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { abandonAgent, AgentError, deleteAgent, getAgent, getSession, latestChatSession, listSessions, readMessages, readProposals, setAgentKey, updateAgent } from '@/lib/hostedAgents'

const failure = (error, tag) => {
  if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
  console.error(`[${tag}]:`, error.message)
  return NextResponse.json({ success: false, error: 'This agent could not be reached' }, { status: 500 })
}

export async function GET(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to see your agent' }, { status: 401 })

  try {
    const { address } = await params
    const { memory, ...agent } = await getAgent(owner, address)
    // ?session= opens that one; without it, the chat the owner was last in (or none: a fresh chat)
    const requested = new URL(request.url).searchParams.get('session')
    const session = requested ? await getSession(agent.address, requested) : await latestChatSession(agent.address)
    const [sessions, messages, proposals] = await Promise.all([
      listSessions(agent.address),
      session ? readMessages(agent.address, session.id) : [],
      session ? readProposals(agent.address, { sessionId: session.id }) : [],
    ])
    const { summary, summarizedThrough, ...current } = session ?? {}
    return NextResponse.json({ success: true, agent, hasMemory: Boolean(memory), session: session ? current : null, sessions, messages, proposals })
  } catch (error) {
    return failure(error, 'HOSTED_AGENT_READ_ERROR')
  }
}

export async function PATCH(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to change your agent' }, { status: 401 })

  try {
    const { address } = await params
    const body = await request.json().catch(() => ({}))
    // A new key for a Universal Profile agent rides the same PATCH, proven by the key itself
    const { memory, ...agent } = body?.controllerKey
      ? await setAgentKey(owner, address, { key: body.controllerKey, proof: body.proof })
      : await updateAgent(owner, address, body)
    return NextResponse.json({ success: true, agent, hasMemory: Boolean(memory) })
  } catch (error) {
    return failure(error, 'HOSTED_AGENT_UPDATE_ERROR')
  }
}

export async function DELETE(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to change your agent' }, { status: 401 })

  try {
    const { address } = await params
    // ?abandon=1 undoes a Universal Profile agent its profile declined, freeing its fee
    if (new URL(request.url).searchParams.get('abandon')) await abandonAgent(owner, address)
    else await deleteAgent(owner, address)
    return NextResponse.json({ success: true })
  } catch (error) {
    return failure(error, 'HOSTED_AGENT_DELETE_ERROR')
  }
}
