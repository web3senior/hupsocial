// app/api/moderation/check/route.js
//
// Pre-upload moderation check for PUBLIC content (posts, comments). Two tiers: `flagged` is
// advisory — the composer warns the author but lets them post anyway; `blocked` (CSAM, explicit
// sexual imagery) is a hard stop so that content never gets pinned. Do NOT call this for
// chat: chat payloads are end-to-end encrypted ciphertext, so moderating them would both leak
// private user data to a third party (OpenAI) and produce meaningless results (ciphertext isn't
// readable text/images). The indexer separately re-checks published posts and flags
// `moderation_flagged` in the DB — this route is only the earlier heads-up on the way in.
//
// `images` is the profile editor's form of the same question, asked about a freshly pinned
// picture or cover before the wallet signs the save. One tier there: `rejected`. The profile
// PUT re-runs the same check itself, so this answer only spares a signature.

import { NextResponse } from 'next/server'
import { moderateContent, moderateImages } from '@/lib/moderation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/* Every image is fetched from a gateway and then sent to OpenAI; the platform default would cut that short. */
export const maxDuration = 60

const MAX_IMAGES = 4

export async function POST(request) {
  try {
    const { content, images } = await request.json()

    if (Array.isArray(images)) {
      const moderation = await moderateImages(images.slice(0, MAX_IMAGES))
      return NextResponse.json({
        rejected: Boolean(moderation?.rejected),
        categories: moderation?.categories || [],
        unreadable: moderation?.unreadable || [],
      })
    }

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
    return NextResponse.json({ flagged: false, blocked: false, rejected: false, categories: [], blockedCategories: [], unreadable: [] })
  }
}
