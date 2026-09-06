// app/api/translate/route.js
//
// Post translation runs through our own origin: Google's free gtx endpoint sends no CORS
// header and answers browsers with a 302 to /sorry, so the call can only be made server
// side. Providers are tried in order and the whole text is re-chunked per provider, since
// each one takes a different amount of text per request.

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_INPUT = 5000
const CACHE_LIMIT = 500
const UPSTREAM_TIMEOUT = 12000

const cache = new Map()

const readCache = (key) => {
  if (!cache.has(key)) return null
  const value = cache.get(key)
  cache.delete(key)
  cache.set(key, value)
  return value
}

const writeCache = (key, value) => {
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
}

// Cut on a paragraph, then a sentence, then any space, so a boundary never lands mid-word
// and hands the translator a fragment it can't read
const chunkText = (text, limit) => {
  if (text.length <= limit) return [text]

  const chunks = []
  let rest = text

  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '))
    if (cut < limit / 2) cut = window.lastIndexOf(' ')
    cut = cut > 0 ? cut + 1 : limit
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }

  if (rest) chunks.push(rest)
  return chunks
}

const fetchJson = async (url, init) => {
  let res
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT) })
  } catch (error) {
    // A dropped socket or a timeout is worth one more try; a refusal is not
    throw Object.assign(new Error(`upstream unreachable: ${error.message}`), { retryable: true })
  }

  if (!res.ok) throw Object.assign(new Error(`upstream responded ${res.status}`), { retryable: res.status >= 500 })

  // A redirect to Google's /sorry interstitial arrives as HTML, not as an error status
  const body = await res.text()
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('upstream returned a non-JSON body')
  }
}

const withRetry = async (task) => {
  try {
    return await task()
  } catch (error) {
    if (!error?.retryable) throw error
    return task()
  }
}

// Cloud Translation escapes a handful of entities even with format: 'text'
const decodeEntities = (text) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const viaCloudApi = async (chunk, target) => {
  const data = await fetchJson(`https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_TRANSLATE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: chunk, target, format: 'text' }),
  })

  const hit = data?.data?.translations?.[0]
  if (!hit?.translatedText) throw new Error('cloud translation returned no text')
  return { text: decodeEntities(hit.translatedText), detected: hit.detectedSourceLanguage || '' }
}

const viaGtx = async (chunk, target) => {
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dt: 't', q: chunk })
  const data = await fetchJson(`https://translate.googleapis.com/translate_a/single?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hup.social/1.0)', Accept: 'application/json' },
  })

  if (!Array.isArray(data?.[0])) throw new Error('unexpected gtx payload')
  return {
    text: data[0].map((segment) => segment?.[0]).filter(Boolean).join(''),
    detected: typeof data[2] === 'string' ? data[2] : '',
  }
}

// Keyless last resort. The anonymous daily quota is per server IP, so MYMEMORY_EMAIL is
// worth setting; errors come back as 200 with a code in responseStatus
const viaMyMemory = async (chunk, target) => {
  const params = new URLSearchParams({ q: chunk, langpair: `Autodetect|${target}` })
  if (process.env.MYMEMORY_EMAIL) params.set('de', process.env.MYMEMORY_EMAIL)

  const data = await fetchJson(`https://api.mymemory.translated.net/get?${params}`, { headers: { Accept: 'application/json' } })
  if (Number(data?.responseStatus) !== 200 || data?.quotaFinished) {
    throw new Error(`mymemory refused: ${data?.responseDetails || data?.responseStatus}`)
  }

  const text = data?.responseData?.translatedText
  if (!text) throw new Error('mymemory returned no text')
  return { text: decodeEntities(text), detected: '' }
}

const PROVIDERS = [
  { name: 'cloud', chunk: 4500, available: () => Boolean(process.env.GOOGLE_TRANSLATE_API_KEY), translate: viaCloudApi },
  { name: 'gtx', chunk: 1500, available: () => true, translate: viaGtx },
  // 500 chars a call, so a long post would mean a dozen round trips and a burnt daily quota
  { name: 'mymemory', chunk: 450, available: (text) => text.length <= 1500, translate: viaMyMemory },
]

const translateText = async (text, target) => {
  let lastError

  for (const provider of PROVIDERS) {
    if (!provider.available(text)) continue

    try {
      const pieces = []
      let detected = ''

      for (const chunk of chunkText(text, provider.chunk)) {
        const result = await withRetry(() => provider.translate(chunk, target))
        pieces.push(result.text)
        if (!detected) detected = result.detected
      }

      const translated = pieces.join('')
      if (!translated) throw new Error('empty translation')
      return { text: translated, detected, provider: provider.name }
    } catch (error) {
      lastError = error
      console.warn(`[translate] ${provider.name} failed: ${error.message}`)
    }
  }

  throw lastError || new Error('no translation provider available')
}

export async function POST(request) {
  let payload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'A JSON body is required' }, { status: 400 })
  }

  const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
  const target = typeof payload?.target === 'string' ? payload.target.trim() : ''

  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
  if (text.length > MAX_INPUT) return NextResponse.json({ error: 'text is too long to translate' }, { status: 413 })
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(target)) {
    return NextResponse.json({ error: 'target must be a language code' }, { status: 400 })
  }

  const cacheKey = `${target}|${text}`
  const cached = readCache(cacheKey)
  if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 'private, max-age=86400' } })

  try {
    const result = await translateText(text, target)
    writeCache(cacheKey, result)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=86400' } })
  } catch (error) {
    console.error('[translate] every provider failed:', error)
    return NextResponse.json({ error: 'Unable to reach the translation service' }, { status: 502 })
  }
}
