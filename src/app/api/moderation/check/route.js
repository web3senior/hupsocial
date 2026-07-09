// app/api/moderation/check/route.js
//
// Pre-upload moderation gate for PUBLIC content (posts, comments) — call this before uploading
// content to IPFS so flagged content never gets pinned in the first place. Do NOT call this for
// chat: chat payloads are end-to-end encrypted ciphertext, so moderating them would both leak
// private user data to a third party (OpenAI) and produce meaningless results (ciphertext isn't
// readable text/images). The indexer separately re-checks published posts and flags
// `moderation_flagged` in the DB — this route is the earlier, preventive check on the way in.

import { NextResponse } from 'next/server'
import { moderateContent } from '@/lib/moderation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const { content } = await request.json()
    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    const moderation = await moderateContent(content)

    return NextResponse.json({
      flagged: Boolean(moderation?.flagged),
      categories: moderation?.categories || [],
    })
  } catch (e) {
    console.error('Moderation check error:', e)
    // Fail open — a broken check shouldn't block legitimate posting
    return NextResponse.json({ flagged: false, categories: [] })
  }
}
