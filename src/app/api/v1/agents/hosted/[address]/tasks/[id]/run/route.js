/**
 * @file app/api/v1/agents/hosted/[address]/tasks/[id]/run/route.js
 * @description The owner's "Run now": one task run, charged to the agent's credits. The result
 * lands in the agent's chat, and its drafts wait there for approval.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError } from '@/lib/hostedAgents'
import { runTask } from '@/lib/agentTasks'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to run your agent' }, { status: 401 })
  try {
    const { address, id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })

    const result = await runTask(owner, address, id)
    if (result.status === 'busy') return NextResponse.json({ success: false, error: 'This task is already running' }, { status: 409 })
    if (result.status === 'skipped') return NextResponse.json({ success: false, error: result.reason }, { status: 402 })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    // Provider errors can echo the prompt or the key; log them, never send them
    console.error('[AGENT_TASK_RUN_ERROR]:', error?.status, error?.message)
    return NextResponse.json({ success: false, error: 'The task could not run right now' }, { status: 500 })
  }
}
