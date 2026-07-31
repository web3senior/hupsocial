// app/api/moderation/check/route.js
//
// Pre-upload moderation check for PUBLIC content (posts, comments). Two tiers: `flagged` is
// advisory — the composer warns the author but lets them post anyway; `blocked` (CSAM, explicit
// sexual imagery) is a hard stop so that content never gets pinned. Do NOT call this for
// chat: chat payloads are end-to-end encrypted ciphertext, so moderating them would both leak
// private user data to a third party (OpenAI) and produce meaningless results (ciphertext isn't
// readable text/images). The indexer separately re-checks published posts and flags
// `moderation_flagged` in the DB — this route is only the earlier heads-up on the way in.

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
      blocked: Boolean(moderation?.blocked),
      categories: moderation?.categories || [],
      blockedCategories: moderation?.blockedCategories || [],
    })
  } catch (e) {
    console.error('Moderation check error:', e)
    // Fail open — a broken check shouldn't block legitimate posting
    return NextResponse.json({ flagged: false, blocked: false, categories: [], blockedCategories: [] })
  }
}
