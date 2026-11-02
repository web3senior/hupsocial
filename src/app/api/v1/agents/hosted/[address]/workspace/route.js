/**
 * @file app/api/v1/agents/hosted/[address]/workspace/route.js
 * @description An agent's workspace working copy: every file and the snapshot history (GET), one
 * file written (PUT {path, content}), or a skill removed (DELETE ?path=).
 */

import { NextResponse } from 'next/server'
import { chatAddressFromRequest } from '@/lib/chatSession'
import { AgentError } from '@/lib/hostedAgents'
import { deleteWorkspaceFile, readWorkspace, writeWorkspaceFile } from '@/lib/agentWorkspace'

const failure = (error) => {
  if (error instanceof AgentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
  console.error('[AGENT_WORKSPACE_ERROR]:', error.message)
  return NextResponse.json({ success: false, error: 'The workspace could not be reached' }, { status: 500 })
}

const unauthorized = () => NextResponse.json({ success: false, error: 'Sign in to see your agent' }, { status: 401 })

export async function GET(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return unauthorized()
  try {
    const { address } = await params
    return NextResponse.json({ success: true, ...(await readWorkspace(owner, address)) })
  } catch (error) {
    return failure(error)
  }
}

export async function PUT(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return unauthorized()
  try {
    const { address } = await params
    const { path, content } = await request.json().catch(() => ({}))
    await writeWorkspaceFile(owner, address, path, content)
    return NextResponse.json({ success: true })
  } catch (error) {
    return failure(error)
  }
}

export async function DELETE(request, { params }) {
  const owner = chatAddressFromRequest(request)
  if (!owner) return unauthorized()
  try {
    const { address } = await params
    await deleteWorkspaceFile(owner, address, new URL(request.url).searchParams.get('path'))
    return NextResponse.json({ success: true })
  } catch (error) {
    return failure(error)
  }
}
