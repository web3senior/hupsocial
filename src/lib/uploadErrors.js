/**
 * Turns whatever a storage provider threw at us into one short sentence a toast can show.
 *
 * Provider failures arrive in three shapes: S3-style XML (`<Message>…</Message>`), JSON with the
 * sentence nested somewhere (`{error:{message}}`, `{error:"…"}`, `{Message:"…"}`), or plain text —
 * and often behind a prefix ("Authentication Failed: {…}" from the Pinata SDK, "Filebase RPC 403:
 * {…}" from our own routes). Fetch itself throws a TypeError whose message ("Failed to fetch",
 * "Load failed") tells a user nothing. Without this, the composer showed "Error uploading file"
 * for a plan limit, a missing CORS rule, and a dead network alike.
 *
 * Pure string handling, so it runs on both sides: routes use it to build the `error` they return,
 * and the client uses it on whatever the routes (or the storage edge) send back.
 */

const MAX_LENGTH = 120

/* Browsers word the same failure differently, and none of the wordings mention CORS — the usual
   cause when a request to the storage edge never leaves the page. */
const NETWORK_FAILURE = /^(TypeError: )?(Failed to fetch|Load failed|NetworkError|Network request failed)/i

const MESSAGE_KEYS = ['message', 'Message', 'error', 'details', 'reason']

function findMessage(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return ''
  for (const key of MESSAGE_KEYS) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (candidate && typeof candidate === 'object') {
      const nested = findMessage(candidate, depth + 1)
      if (nested) return nested
    }
  }
  return ''
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Pulls the human sentence out of a provider response body or error text.
 * @param {string} text
 * @returns {string} Empty when there is nothing to work with.
 */
export function extractProviderMessage(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return ''

  const xml = /<Message>([^<]*)<\/Message>/i.exec(trimmed)
  if (xml?.[1]?.trim()) return xml[1].trim()

  /* Whole-body JSON, or JSON embedded after a prefix */
  const start = trimmed.search(/[{[]/)
  if (start !== -1) {
    const found = findMessage(parseJson(trimmed.slice(start)))
    if (found) return found
  }

  /* Plain text — or an HTML error page from whatever proxy sits in front of the provider, whose
     <head> only repeats the status the body already states */
  return trimmed.replace(/<head[\s\S]*?<\/head>/i, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * One short sentence describing why an upload failed.
 * @param {unknown} error An Error, a string, or a raw response body.
 * @param {string} [fallback] Shown when nothing human-readable can be found.
 * @param {number} [maxLength] Ceiling for the returned string.
 * @returns {string}
 */
export function shortUploadError(error, fallback = 'Upload failed', maxLength = MAX_LENGTH) {
  const raw = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : ''
  if (!raw.trim()) return fallback
  if (NETWORK_FAILURE.test(raw.trim())) return 'Upload could not reach storage (network or CORS)'

  const message = extractProviderMessage(raw) || fallback
  if (message.length <= maxLength) return message

  /* A long message usually front-loads the reason: keep the first sentence when it says
     something on its own, otherwise cut at a word boundary */
  const sentence = /^(.{20,}?[.!?])\s/.exec(message)?.[1]
  if (sentence && sentence.length <= maxLength) return sentence
  return `${message.slice(0, maxLength - 1).replace(/\s+\S*$/, '')}…`
}

/**
 * Both pinning providers refused an upload: name each with its reason, kept short enough for one
 * toast line. The primary's reason comes first since that is the one worth fixing.
 * @param {unknown} filebaseError
 * @param {unknown} pinataError
 * @returns {string}
 */
export function bothProvidersFailed(filebaseError, pinataError) {
  return `Filebase: ${shortUploadError(filebaseError, 'failed', 70)} · Pinata: ${shortUploadError(pinataError, 'failed', 70)}`
}
