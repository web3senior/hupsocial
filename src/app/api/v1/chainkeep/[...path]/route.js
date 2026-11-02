/**
 * @file app/api/v1/chainkeep/[...path]/route.js
 * @description A narrow pass-through to ChainKeep (onchain file storage), which serves no CORS
 * headers, so the browser cannot call it directly. The `chainkeep` client is pointed at
 * `/api/v1/chainkeep` as its base URL; only the endpoints it uses for a native-coin upload and a
 * read are forwarded, and nothing here signs or pays — the agent's wallet does that in the browser.
 */

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const CHAINKEEP_URL = (process.env.CHAINKEEP_URL || 'https://chainkeep.online').replace(/\/+$/, '')

// Agent workspaces are small; this only bounds what a caller can push through Hup's server
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

const ALLOWED = [
  { method: 'GET', pattern: /^api\/v1\/uploads\/config$/ },
  { method: 'POST', pattern: /^api\/v1\/uploads\/quote$/ },
  { method: 'POST', pattern: /^api\/v1\/uploads$/ },
  { method: 'GET', pattern: /^api\/v1\/uploads\/\d{1,10}\/0x[0-9a-fA-F]{64}$/ },
  { method: 'GET', pattern: /^api\/v1\/files\/\d{1,10}\/0x[0-9a-fA-F]{64}$/ },
]

/* ChainKeep's network list takes seconds to answer and changes almost never, so it is kept here
   for five minutes, then served stale while one refresh runs behind it. Nobody waits on it twice. */
const CONFIG_PATH = 'api/v1/uploads/config'
const CONFIG_TTL_MS = 5 * 60 * 1000
let configCache = { at: 0, body: null, refreshing: null }

const refreshConfig = () => {
  configCache.refreshing ??= fetch(`${CHAINKEEP_URL}/${CONFIG_PATH}`, { signal: AbortSignal.timeout(20_000) })
    .then(async (response) => {
      if (response.ok) configCache = { at: Date.now(), body: await response.text(), refreshing: null }
    })
    .catch((error) => console.error('[CHAINKEEP_CONFIG_ERROR]:', error.message))
    .finally(() => {
      configCache.refreshing = null
    })
  return configCache.refreshing
}

const configResponse = async () => {
  if (!configCache.body) await refreshConfig()
  else if (Date.now() - configCache.at > CONFIG_TTL_MS) refreshConfig()
  if (!configCache.body) return NextResponse.json({ error: 'ChainKeep cannot be reached right now, try again shortly' }, { status: 502 })
  return new Response(configCache.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

async function forward(request, { params }) {
  const path = (await params).path.join('/')
  if (!ALLOWED.some((rule) => rule.method === request.method && rule.pattern.test(path))) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }
  if (path === CONFIG_PATH) return configResponse()

  const target = new URL(`${CHAINKEEP_URL}/${path}`)
  target.search = new URL(request.url).search

  const headers = { 'content-type': request.headers.get('content-type') || 'application/json' }
  const quoteToken = request.headers.get('x-bytevault-quote')
  if (quoteToken) headers['x-bytevault-quote'] = quoteToken

  let body
  if (request.method === 'POST') {
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'This file is too large to store from Hup' }, { status: 413 })
    body = bytes
  }

  try {
    const response = await fetch(target, { method: request.method, headers, body, signal: AbortSignal.timeout(55_000) })
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
    })
  } catch (error) {
    console.error('[CHAINKEEP_PROXY_ERROR]:', path, error.message)
    return NextResponse.json({ error: 'ChainKeep cannot be reached right now, try again shortly' }, { status: 502 })
  }
}

export const GET = forward
export const POST = forward
