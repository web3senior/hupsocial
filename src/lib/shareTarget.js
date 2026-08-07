// Client half of the Web Share Target flow. The service worker parks an incoming share
// in the Cache Storage bucket named here, then redirects to /share, which drains it.
//
// public/sw.js is served raw (it is never bundled), so it cannot import this module —
// it redeclares the same three constants at the top of the file. Change one, change both.
export const SHARE_CACHE = 'hup-share-v1'
export const SHARE_PAYLOAD_KEY = '/__share-payload'
export const SHARE_FILE_PREFIX = '/__share-file-'

// Android sends a link as a title plus the URL, and often repeats the URL inside the text.
// Fold that into the two fields the composer takes, without echoing the same string twice.
export const normalizeSharedText = ({ title = '', text = '', url = '' } = {}) => {
  const parts = [title, text].map((part) => `${part || ''}`.trim()).filter(Boolean)
  const sharedText = [...new Set(parts)].join('\n')
  const sharedUrl = `${url || ''}`.trim()

  return {
    text: sharedText,
    url: sharedUrl && !sharedText.includes(sharedUrl) ? sharedUrl : '',
  }
}

// Take the parked share and clear it in one move: a refresh of /share must not re-attach
// media the author already dismissed. Returns null when there is nothing waiting, which is
// the normal case for a direct visit or for the /api/share fallback path.
export const drainSharedPayload = async () => {
  if (typeof caches === 'undefined') return null

  let payload
  try {
    const cache = await caches.open(SHARE_CACHE)
    const stored = await cache.match(SHARE_PAYLOAD_KEY)
    if (!stored) return null

    payload = await stored.json()

    const entries = Array.isArray(payload?.files) ? payload.files : []
    const files = await Promise.all(
      entries.map(async (entry) => {
        const response = await cache.match(entry.key)
        if (!response) return null
        const blob = await response.blob()
        return new File([blob], entry.name || 'shared-media', { type: entry.type || blob.type || '' })
      })
    )

    return { ...normalizeSharedText(payload), files: files.filter(Boolean) }
  } catch (error) {
    console.error('Failed to read the shared payload:', error)
    return null
  } finally {
    // Even a half-read payload gets dropped — a stale share is worse than a lost one
    if (payload !== undefined) await caches.delete(SHARE_CACHE).catch(() => {})
  }
}
