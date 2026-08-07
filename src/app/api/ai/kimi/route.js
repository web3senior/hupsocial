/**
 * @file api/ai/kimi/route.js
 * @description Generates the Profile Insights read (archetype + persona scores) with
 * Moonshot's Kimi models. Moonshot exposes an OpenAI-compatible surface, so we reuse the
 * `openai` SDK with a different baseURL rather than pulling in another dependency.
 */

import OpenAI from 'openai'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
// Headroom over the ~6s typical round trip, so a slow generation still lands.
export const maxDuration = 60

const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1'
// k3 is thinking-only and defaults to `max` effort. Pinned to `low` below, it answers this
// prompt in ~6s against ~34s for k2.5 and ~51s for k2.6, at equal or better quality.
const DEFAULT_MODEL = 'kimi-k3'

// Bounds cost/latency on prolific accounts; the prompt only needs a representative sample
// of someone's voice, not their full history.
const MAX_POSTS_CHARS = 12000

const SYSTEM_PROMPT = `
You are an expert Web3 Cultural Analyst. Your task is to analyze a user's onchain persona based on their profile and social activity.

### SCORING LOGIC:
1. **Degen (0-100):** High scores for memecoin mentions, high-frequency trading, NFT flipping, "apeing" into new projects, and use of slang like "LFG", "GM", or "Moon".
2. **Builder (0-100):** High scores for technical terms (Solidity, Rust, SDKs), hackathon participation (ETHGlobal), mentions of building/shipping, and GitHub activity.
3. **Researcher (0-100):** High scores for long-form analysis, governance voting, whitepaper discussions, DAO participation, and educational content.

### OUTPUT REQUIREMENTS:
- **Summary:** A sharp, insightful 2-sentence breakdown of who they are in the ecosystem. Avoid generic "This user is active" filler.
- **Web3 Vibe:** A creative, 2-4 word "Archetype" title (e.g., "The Stealth Alpha Hunter", "Protocol Architect", "Governance Minimalist", "High-Stakes Yield Farmer").
- **Format:** Return ONLY a valid JSON object. No markdown blocks, no extra text.

JSON structure:
{
  "summary": "string",
  "web3_vibe": "string",
  "scores": {
    "degen": number,
    "builder": number,
    "researcher": number
  }
}
`

/**
 * Coerces a model-supplied score into the 0-100 integer the UI's <progress> expects.
 * @param {unknown} value - Raw score from the model.
 * @returns {number} Clamped, rounded score.
 */
const toScore = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(100, Math.max(0, Math.round(parsed)))
}

export async function POST(req) {
  try {
    const apiKey = process.env.MOONSHOT_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'MOONSHOT_API_KEY is not configured' }, { status: 500 })
    }

    const { profile, posts } = await req.json()

    if (!profile || !posts) {
      return NextResponse.json({ error: 'Profile and posts are required' }, { status: 400 })
    }

    // Instantiated per-request: the SDK throws when the key is missing, and a module-scope
    // client would make `next build` fail without MOONSHOT_API_KEY.
    const client = new OpenAI({
      baseURL: MOONSHOT_BASE_URL,
      apiKey,
      timeout: 55000,
    })

    const userPrompt = [
      `Name: ${profile.name || 'Unknown'}`,
      `Bio: ${profile.bio || 'No bio provided'}`,
      `Recent Activity: ${String(posts).slice(0, MAX_POSTS_CHARS)}`,
    ].join('\n')

    const model = process.env.MOONSHOT_MODEL || DEFAULT_MODEL

    const completion = await client.chat.completions.create({
      // Kimi k2.x/k3 reject any temperature other than 1, so it is left unset on purpose.
      model,
      response_format: { type: 'json_object' },
      // Only the kimi-* line takes a reasoning budget; the moonshot-v1-* models reject it.
      ...(model.startsWith('kimi-') ? { reasoning_effort: 'low' } : {}),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    })

    const text = completion.choices?.[0]?.message?.content ?? ''
    // JSON mode should already return bare JSON; the fence strip is belt-and-braces.
    const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      console.error('Kimi API Error: model returned unparseable JSON', { text })
      return NextResponse.json({ error: 'Model returned an unreadable response' }, { status: 502 })
    }

    return NextResponse.json({
      summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
      web3_vibe: typeof parsed?.web3_vibe === 'string' ? parsed.web3_vibe : '',
      scores: {
        degen: toScore(parsed?.scores?.degen),
        builder: toScore(parsed?.scores?.builder),
        researcher: toScore(parsed?.scores?.researcher),
      },
    })
  } catch (error) {
    console.error('Kimi API Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate content', details: error.message },
      { status: 500 },
    )
  }
}
