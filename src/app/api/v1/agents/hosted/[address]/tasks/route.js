/**
 * @file app/api/v1/agents/hosted/[address]/tasks/route.js
 * @description An agent's tasks: the list (GET) and a new one (POST {title, instructions, schedule}).
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError } from '@/lib/hostedAgents'
import { createTask, listTasks } from '@/lib/agentTasks'

const failure = (error) => {
  if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
  console.error('[AGENT_TASKS_ERROR]:', error.message)
  return NextResponse.json({ success: false, error: 'Tasks could not be reached' }, { status: 500 })
}

export async function GET(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to see your agent' }, { status: 401 })
  try {
    const { address } = await params
    return NextResponse.json({ success: true, tasks: await listTasks(owner, address) })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to change your agent' }, { status: 401 })
  try {
    const { address } = await params
    return NextResponse.json({ success: true, task: await createTask(owner, address, await request.json().catch(() => ({}))) })
  } catch (error) {
    return failure(error)
  }
}
