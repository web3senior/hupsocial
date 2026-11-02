/**
 * @file app/api/v1/agents/hosted/[address]/tasks/[id]/route.js
 * @description Change a task (PATCH {title, instructions, schedule, enabled}) or delete it.
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError } from '@/lib/hostedAgents'
import { deleteTask, updateTask } from '@/lib/agentTasks'

const failure = (error) => {
  if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
  console.error('[AGENT_TASK_ERROR]:', error.message)
  return NextResponse.json({ success: false, error: 'The task could not be changed' }, { status: 500 })
}

const validId = (id) => /^\d+$/.test(id)

export async function PATCH(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to change your agent' }, { status: 401 })
  try {
    const { address, id } = await params
    if (!validId(id)) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    return NextResponse.json({ success: true, task: await updateTask(owner, address, id, await request.json().catch(() => ({}))) })
  } catch (error) {
    return failure(error)
  }
}

export async function DELETE(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return NextResponse.json({ success: false, error: 'Sign in to change your agent' }, { status: 401 })
  try {
    const { address, id } = await params
    if (!validId(id)) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    await deleteTask(owner, address, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return failure(error)
  }
}
