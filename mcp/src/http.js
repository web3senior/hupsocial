/**
 * @file mcp/src/http.js
 * One fetch wrapper for the Hup HTTP API. Every read the server exposes is a public GET
 * on hup.social; the writes that go through HTTP (pin, relay, profile) are here too.
 */

import { DEFAULT_BASE_URL } from './config.js'

export class HupHttpError extends Error {
  constructor(status, message, body) {
    super(message)
    this.name = 'HupHttpError'
    this.status = status
    this.body = body
  }
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * @param {string} [baseUrl]
 */
export function createHttp(baseUrl = DEFAULT_BASE_URL) {
  const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')

  const url = (path, query) => {
    const u = new URL(path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue
      u.searchParams.set(key, String(value))
    }
    return u
  }

  /**
   * Raw request; never throws on a non-2xx, so callers can read the body of a refusal.
   * @returns {Promise<{status:number, ok:boolean, body:any, headers:Headers}>}
   */
  async function request(path, { method = 'GET', query, body, form, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const init = { method, signal: controller.signal, headers: { accept: 'application/json, text/plain;q=0.9' } }
      if (form) init.body = form
      else if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const res = await fetch(url(path, query), init)
      const type = res.headers.get('content-type') || ''
      let parsed = null
      const text = await res.text()
      if (type.includes('json')) {
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          parsed = text
        }
      } else parsed = text
      return { status: res.status, ok: res.ok, body: parsed, headers: res.headers }
    } finally {
      clearTimeout(timer)
    }
  }

  /** JSON request that throws HupHttpError on a non-2xx. */
  async function json(path, options) {
    const res = await request(path, options)
    if (!res.ok) {
      const message =
        (res.body && typeof res.body === 'object' && (res.body.error || res.body.message)) ||
        (typeof res.body === 'string' && res.body.slice(0, 200)) ||
        `HTTP ${res.status}`
      throw new HupHttpError(res.status, `${path} → ${res.status}: ${message}`, res.body)
    }
    return res.body
  }

  return {
    base,
    url,
    request,
    json,
    get: (path, query) => json(path, { query }),
    post: (path, body) => json(path, { method: 'POST', body }),
    text: (path, query) => request(path, { query }).then((r) => (r.ok ? String(r.body ?? '') : null)),
  }
}
