/**
 * @file lib/moderation.js
 * @description Runs a post's structured content (text + images) through OpenAI's
 * moderation endpoint so harmful posts can be flagged in the database.
 * Note: the moderation API has no video input type, so video items are skipped.
 */

import { resolveIPFSUrl } from './storageHelper.js'

const MODERATION_ENDPOINT = 'https://api.openai.com/v1/moderations'
const DEFAULT_MODEL = 'omni-moderation-latest'

let warnedMissingKey = false

/**
 * Resolves a media item to a base64 data URL for the moderation API. Images are fetched and
 * inlined here (rather than handing OpenAI a remote gateway URL) so a slow/unreachable IPFS
 * gateway fails loudly on our side instead of silently dropping the image from the check.
 * @param {object} item - Media item from the post's content JSON.
 * @returns {Promise<string|null>} Usable data: URL, or null if unresolvable.
 */
async function toImageDataUrl(item) {
  const raw = item?.url ?? item?.src ?? item?.uri ?? item?.cid ?? item?.ipfsCid ?? null
  if (!raw) return null

  const value = raw.toString().trim()
  if (!value) return null

  if (value.startsWith('data:')) return value

  const url = /^https?:\/\//i.test(value) ? value : resolveIPFSUrl(value)
  if (!url) {
    console.warn('Moderation: could not resolve an image URL for classification', { raw: value })
    return null
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) {
      console.warn('Moderation: failed to fetch image for classification', { url, status: response.status })
      return null
    }
    const mimeType = response.headers.get('content-type') || 'image/jpeg'
    const buffer = Buffer.from(await response.arrayBuffer())
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  } catch (err) {
    console.warn('Moderation: image fetch errored', { url, err: err.message })
    return null
  }
}

/**
 * Builds OpenAI moderation input items from a post's structured content JSON.
 * @param {string|object} contentJson - Raw `posts.content` value (JSON string or parsed object).
 * @returns {Promise<Array<object>>} Multi-modal moderation input items.
 */
async function buildModerationInput(contentJson) {
  let parsed
  try {
    parsed = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson
  } catch {
    return []
  }

  const elements = Array.isArray(parsed?.elements) ? parsed.elements : []
  const input = []

  for (const element of elements) {
    if (element?.type === 'text' && typeof element?.data?.text === 'string' && element.data.text.trim()) {
      input.push({ type: 'text', text: element.data.text.trim() })
      continue
    }

    if (element?.type === 'media') {
      const items = Array.isArray(element?.data?.items) ? element.data.items : []
      for (const item of items) {
        if (item?.type !== 'image') continue
        const url = await toImageDataUrl(item)
        if (url) input.push({ type: 'image_url', image_url: { url } })
      }
    }
  }

  return input
}

// Hard-block tier: categories where "post anyway" must not exist because pinning the content
// creates criminal liability for the infrastructure operator. sexual/minors blocks on OpenAI's
// (deliberately trigger-happy) boolean; adult `sexual` content blocks only on high-confidence
// explicit material — suggestive/borderline text falls through to the overridable warn tier.
const BLOCK_SEXUAL_SCORE = 0.8

/**
 * Classifies a post's content via OpenAI moderation.
 * Returns null when there's nothing to check or the check could not be run,
 * so callers can leave any existing moderation state untouched.
 * `flagged` is advisory (warn tier); `blocked` means the content must not be published.
 * @param {string|object|null} contentJson - Raw `posts.content` value.
 * @returns {Promise<{flagged: boolean, blocked: boolean, categories: string[], blockedCategories: string[]}|null>}
 */
export async function moderateContent(contentJson) {
  if (!contentJson) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    if (!warnedMissingKey) {
      console.warn('OPENAI_API_KEY not set; skipping content moderation')
      warnedMissingKey = true
    }
    return null
  }

  const input = await buildModerationInput(contentJson)
  if (input.length === 0) return null

  try {
    const response = await fetch(MODERATION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODERATION_MODEL || DEFAULT_MODEL,
        input,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      console.warn('OpenAI moderation request failed', { status: response.status, errorBody })
      return null
    }

    const body = await response.json()
    const results = Array.isArray(body?.results) ? body.results : []

    const flagged = results.some((result) => result?.flagged)
    const categories = [
      ...new Set(
        results.flatMap((result) =>
          Object.entries(result?.categories ?? {})
            .filter(([, isFlagged]) => isFlagged)
            .map(([category]) => category),
        ),
      ),
    ]

    const blockedCategories = new Set()
    for (const result of results) {
      if (result?.categories?.['sexual/minors']) blockedCategories.add('sexual/minors')
      if ((result?.category_scores?.sexual ?? 0) >= BLOCK_SEXUAL_SCORE) blockedCategories.add('sexual')
    }

    return { flagged, blocked: blockedCategories.size > 0, categories, blockedCategories: [...blockedCategories] }
  } catch (err) {
    console.warn('OpenAI moderation request errored', { err: err.message })
    return null
  }
}
