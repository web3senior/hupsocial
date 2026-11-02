/**
 * @file app/api/v1/agents/hosted/[address]/chat/route.js
 * @description One chat turn between an owner and their hosted agent (the turn itself is
 * lib/agentRuntime.js). The agent pays for it from its own credits, which are its only limit: a
 * run is refused when the agent is paused or out of credits.
 *
 * The conversation lives on the server, so the history is read from the database and never
 * trusted from the client. A message without a sessionId starts a new chat session. Streams NDJSON:
 * session (its id, first), status, delta, proposal, done, error.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError, appendMessage, createSession, getAgent, getSession } from '@/lib/hostedAgents'
import { assertCanRun, runAgentTurn } from '@/lib/agentRuntime'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_MESSAGE_CHARS = 2000

export async function POST(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to talk to your agent' }, { status: 401 })

  const { address } = await params
  const body = await request.json().catch(() => ({}))
  const text = typeof body?.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : ''
  if (!text) return NextResponse.json({ success: false, error: 'A message is required' }, { status: 400 })

  let agent
  let sessionId
  try {
    agent = await getAgent(owner, address)
    assertCanRun(agent)
    // No session means a new chat; a given one must be one of this agent's chats, not a task run
    if (body?.sessionId) {
      const session = await getSession(agent.address, body.sessionId)
      if (session.kind !== 'chat') return NextResponse.json({ success: false, error: 'Task runs cannot be continued; start a new chat' }, { status: 409 })
      sessionId = session.id
    } else {
      sessionId = await createSession(agent.address, { kind: 'chat' })
    }
    await appendMessage(agent.address, 'user', text, sessionId)
  } catch (error) {
    if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[AGENT_CHAT_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Your agent could not be reached' }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // A reader that hung up makes enqueue throw; the turn still finishes, is saved and is charged
      const send = (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          /* client gone */
        }
      }

      try {
        send({ type: 'session', id: sessionId })
        await runAgentTurn({ agent, owner, send, signal: request.signal, sessionId })
        send({ type: 'done' })
      } catch (error) {
        if (error instanceof AgentError) {
          send({ type: 'error', error: error.message })
        } else if (!request.signal.aborted) {
          // Provider errors can echo the prompt or the key; log the status, never send the body
          console.error('[AGENT_CHAT_ERROR]:', error?.status, error?.message)
          send({ type: 'error', error: error?.status === 429 ? `${agent.name} is busy, try again in a moment` : `${agent.name} could not answer right now` })
        }
      } finally {
        try {
          controller.close()
        } catch {
          /* already closed by a cancel */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
