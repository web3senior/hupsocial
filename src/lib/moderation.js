/**
 * @file lib/moderation.js
 * @description Runs a post's structured content (text + images), or a bare list of image
 * references such as a profile picture and cover, through OpenAI's moderation endpoint so
 * harmful content can be flagged or refused.
 * Note: the moderation API has no video input type, so video items are skipped.
 */

import { gatewayList } from './ipfsGateways.js'
import { extractIPFSCid } from './storageHelper.js'

const MODERATION_ENDPOINT = 'https://api.openai.com/v1/moderations'
const DEFAULT_MODEL = 'omni-moderation-latest'
/* Per gateway, and for the whole walk: the primary holds our own pins and gets a full wait for a
   cold multi-megabyte picture, while a CID nothing serves must still answer inside the route's
   60s budget. */
const GATEWAY_TIMEOUT_MS = 15000
const WALK_BUDGET_MS = 40000
/* A base64 picture is a multi-megabyte request body; text is not. */
const TEXT_TIMEOUT_MS = 15000
const IMAGE_TIMEOUT_MS = 30000

let warnedMissingKey = false

/** The API key, or null with a single warning per process so a keyless environment stays quiet. */
function moderationKey() {
  const apiKey = process.env.OPENAI_API_KEY
  if (apiKey) return apiKey
  if (!warnedMissingKey) {
    console.warn('OPENAI_API_KEY not set; skipping content moderation')
    warnedMissingKey = true
  }
  return null
}

const BARE_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(?:\/.*)?$/

/* The formats OpenAI reads, told from the bytes rather than a header: a gateway can answer with
   a generic content type, and OpenAI rejects a data URL that is not a real picture, which would
   fail the whole check open. */
function sniffImageType(buffer) {
  if (buffer.length < 12) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.toString('latin1', 0, 3) === 'GIF') return 'image/gif'
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/**
 * Fetches an image's bytes, walking the gateway list for IPFS since a CID pinned moments ago is
 * not always on the primary yet. Every answer is checked against the formats above before it
 * counts: a gateway can answer 200 with an HTML page for a CID it does not hold (delegated-ipfs.dev
 * redirects those to its docs), and stopping at the first OK would hand that page to OpenAI as a
 * picture.
 * @param {string} ref - `ipfs://` URI, bare CID, gateway or UP-cloud URL, or https URL.
 * @returns {Promise<{buffer: Buffer, type: string}|null>} The bytes and their format, or null.
 */
async function fetchImage(ref) {
  const cid = extractIPFSCid(ref) ?? (BARE_CID.test(ref) ? ref : null)
  const urls = cid ? gatewayList().map((gateway) => `${gateway}${cid}`) : /^https?:\/\//i.test(ref) ? [ref] : []
  if (urls.length === 0) {
    console.warn('Moderation: could not resolve an image URL for classification', { raw: ref })
    return null
  }

  const deadline = Date.now() + WALK_BUDGET_MS
  for (const url of urls) {
    const timeoutMs = Math.min(GATEWAY_TIMEOUT_MS, deadline - Date.now())
    if (timeoutMs <= 0) break
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) {
        console.warn('Moderation: failed to fetch image for classification', { url, status: response.status })
        continue
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      const type = sniffImageType(buffer)
      if (type) return { buffer, type }
      console.warn('Moderation: fetched bytes are not a picture OpenAI reads', { url, contentType: response.headers.get('content-type') })
    } catch (err) {
      console.warn('Moderation: image fetch errored', { url, err: err.message })
    }
  }

  return null
}

/**
 * Resolves an image reference to a base64 data URL for the moderation API. Images are fetched and
 * inlined here (rather than handing OpenAI a remote gateway URL) so a slow/unreachable IPFS
 * gateway fails loudly on our side instead of silently dropping the image from the check.
 * @param {string} ref - `ipfs://` URI, bare CID, gateway or UP-cloud URL, https URL, or data URL.
 * @returns {Promise<string|null>} Usable data: URL, or null if unresolvable.
 */
async function imageToDataUrl(ref) {
  const value = String(ref ?? '').trim()
  if (!value) return null
  if (value.startsWith('data:')) return value

  const image = await fetchImage(value)
  return image ? `data:${image.type};base64,${image.buffer.toString('base64')}` : null
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
        const url = await imageToDataUrl(item?.url ?? item?.src ?? item?.uri ?? item?.cid ?? item?.ipfsCid ?? null)
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
 * Sends built moderation input to OpenAI and reads the two-tier verdict.
 * Returns null when the request could not be made, so callers can fail open.
 * @param {Array<object>} input - Multi-modal moderation input items.
 * @param {string} apiKey
 * @returns {Promise<{flagged: boolean, blocked: boolean, categories: string[], blockedCategories: string[]}|null>}
 */
async function classify(input, apiKey) {
  const hasImages = input.some((item) => item?.type === 'image_url')

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
      signal: AbortSignal.timeout(hasImages ? IMAGE_TIMEOUT_MS : TEXT_TIMEOUT_MS),
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

  const apiKey = moderationKey()
  if (!apiKey) return null

  const input = await buildModerationInput(contentJson)
  if (input.length === 0) return null

  return classify(input, apiKey)
}

/**
 * Classifies bare image references: a profile picture, a cover. These get one tier, not two —
 * a picture shown beside every post its owner writes cannot be blurred or collapsed the way a
 * flagged post can, so anything the moderator flags is refused outright.
 * Returns null when there is nothing to check or the check could not be run (no key, OpenAI
 * unreachable), so callers can fail open as the post path does. `unreadable` lists references
 * that yielded no picture — no gateway served them, or what came back was not a format OpenAI
 * reads — which is the one failure a gate should not wave through.
 * @param {string[]} refs - Stored image references.
 * @returns {Promise<{rejected: boolean, categories: string[], unreadable: string[]}|null>}
 */
export async function moderateImages(refs) {
  const wanted = [...new Set((Array.isArray(refs) ? refs : []).map((ref) => String(ref ?? '').trim()).filter(Boolean))]
  if (wanted.length === 0) return null

  const apiKey = moderationKey()
  if (!apiKey) return null

  const input = []
  const unreadable = []
  for (const ref of wanted) {
    const url = await imageToDataUrl(ref)
    if (url) input.push({ type: 'image_url', image_url: { url } })
    else unreadable.push(ref)
  }

  if (input.length === 0) return { rejected: false, categories: [], unreadable }

  const verdict = await classify(input, apiKey)
  if (!verdict) return null

  return { rejected: verdict.flagged || verdict.blocked, categories: verdict.categories, unreadable }
}
