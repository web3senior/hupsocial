/**
 * @file lib/serverRpc.js
 * @description Which endpoint a server-side read should actually talk to. The browser never
 * needs this — a wallet brings its own RPC — but our server calls out from a datacenter, and
 * public endpoints treat that differently: LUKSO's official node answers Vercel with a 403
 * HTML page, and thirdweb's keyless tier rate-limits per IP, which a shared serverless egress
 * address exhausts long before we reach it. The symptom is silent and identical either way —
 * every read on that chain comes back empty — and it never reproduces on a laptop, which is
 * how chain 42 sat broken in production while localhost looked perfectly healthy.
 *
 * Resolution order, per chain:
 *   1. RPC_URL_<chainId> — a private or keyed endpoint. Server-only (no NEXT_PUBLIC), so it
 *      never ships to the browser, and the only entry that survives a public provider
 *      deciding it dislikes our IP.
 *   2. every URL in that chain's rpcUrls.default.http, in listed order.
 *
 * The list is probed rather than assumed: the first endpoint that answers eth_chainId with
 * the id we asked for wins, and is remembered for HEALTH_TTL_MS. That is what makes the
 * fallback real — http[0] being unreachable from here no longer takes the whole chain down,
 * and the same code can pick a different endpoint in production than in dev without either
 * being configured for it.
 *
 * THIRDWEB_RPC_SECRET_KEY is optional. Set it and thirdweb hosts are called as our account
 * instead of anonymously; leave it unset and they are called keyless, exactly as before.
 */

import { ethers } from 'ethers'
import { appChains } from '@/config/contracts'

const THIRDWEB_RPC_SECRET_KEY = process.env.THIRDWEB_RPC_SECRET_KEY

// How long a resolved endpoint is trusted before it is probed again. Long enough that the
// probe costs nothing at feed rates, short enough that a provider coming back up does not
// have to wait for a redeploy.
const HEALTH_TTL_MS = 300000

// A public endpoint that has not answered in this long is not going to; the point of the
// probe is to move on to the next one quickly, not to wait out a hung gateway.
const PROBE_TIMEOUT_MS = 4000

// Cached on globalThis for the same reason lib/serverPublicClient.js does it: a hot reload
// would otherwise re-probe every chain on every edit.
const globalForRpc = globalThis
const resolved = globalForRpc.__hupServerRpc ?? new Map()
if (process.env.NODE_ENV !== 'production') globalForRpc.__hupServerRpc = resolved

const hostOf = (url) => {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

// Authenticating a thirdweb call bills it to our account rather than to whatever the shared
// egress IP has left of the anonymous allowance — the difference between working and not
// from a serverless host. Skipped entirely when no key is configured.
const headersFor = (url) => {
  const host = hostOf(url)
  if (!host || !THIRDWEB_RPC_SECRET_KEY || !host.endsWith('rpc.thirdweb.com')) return null

  return { 'x-secret-key': THIRDWEB_RPC_SECRET_KEY }
}

/** Every endpoint we would consider for a chain, best first. */
export const serverRpcEndpoints = (chainId) => {
  const id = Number(chainId)
  const chain = appChains.find((entry) => entry.id === id)

  return [process.env[`RPC_URL_${id}`], ...(chain?.rpcUrls?.default?.http ?? [])]
    .filter((url) => typeof url === 'string' && url.startsWith('http'))
    .filter((url, index, all) => all.indexOf(url) === index)
    .map((url) => ({ url, host: hostOf(url), headers: headersFor(url) }))
}

// One cheap round trip that proves the endpoint is reachable from wherever this is running.
const answers = async (endpoint, chainId) => {
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(endpoint.headers ?? {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })

    if (!response.ok) return false

    const json = await response.json()
    // A gateway answering with someone else's chain is worse than one that refuses outright
    return Number(json?.result) === chainId
  } catch {
    return false
  }
}

/**
 * The first endpoint for a chain that answers from here, or null when none do.
 * @param {number|string} chainId Chain to resolve.
 * @returns {Promise<{url: string, host: string|null, headers: Object|null}|null>}
 */
export const resolveServerRpc = async (chainId) => {
  const id = Number(chainId)
  const endpoints = serverRpcEndpoints(id)
  if (!endpoints.length) return null

  const cached = resolved.get(id)
  if (cached && Date.now() - cached.at < HEALTH_TTL_MS) return cached.endpoint

  // With nothing to fall back to, a probe only buys a slower failure — let the real call
  // produce the real error instead.
  if (endpoints.length === 1) {
    resolved.set(id, { at: Date.now(), endpoint: endpoints[0] })
    return endpoints[0]
  }

  for (const endpoint of endpoints) {
    if (await answers(endpoint, id)) {
      resolved.set(id, { at: Date.now(), endpoint })
      return endpoint
    }
  }

  console.error('SERVER_RPC_UNREACHABLE:', id, endpoints.map((entry) => entry.host).join(', '))
  return null
}

/** An ethers provider bound to an already-resolved endpoint. */
export const providerForEndpoint = (endpoint, chainId) => {
  const request = new ethers.FetchRequest(endpoint.url)
  for (const [name, value] of Object.entries(endpoint.headers ?? {})) request.setHeader(name, value)

  // The chain is known before the first call, so the provider never spends a round trip
  // detecting what it is already being told.
  return new ethers.JsonRpcProvider(request, Number(chainId), { staticNetwork: true })
}

/**
 * Resolve and connect in one step.
 * @param {number|string} chainId Chain to read from or send on.
 * @returns {Promise<Object|null>} An ethers provider, or null when the chain is unreachable.
 */
export const getServerProvider = async (chainId) => {
  const endpoint = await resolveServerRpc(chainId)
  if (!endpoint) return null

  return providerForEndpoint(endpoint, chainId)
}
