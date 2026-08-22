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
 * Prefer withServerProvider(): it runs the caller's own reads against each endpoint in turn
 * and keeps whichever one answered, so the real work doubles as the health check. The first
 * cut of this file used a synthetic eth_chainId probe instead and picked wrong in exactly the
 * case it existed for — thirdweb served chain ids from metadata while refusing every state
 * read behind them, so the resolver locked onto an endpoint it had proven nothing about and
 * cached that answer for five minutes. A probe only has to be weaker than the workload once.
 *
 * THIRDWEB_RPC_SECRET_KEY is optional. Set it and thirdweb hosts are called as our account
 * instead of anonymously; leave it unset and they are called keyless, exactly as before.
 */

import { ethers } from 'ethers'
import { appChains } from '@/config/contracts'

const THIRDWEB_RPC_SECRET_KEY = process.env.THIRDWEB_RPC_SECRET_KEY

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// How long an endpoint that answered is used without being re-checked. Long enough that the
// check costs nothing at feed rates, short enough that a provider coming back up does not
// have to wait for a redeploy.
const HEALTH_TTL_MS = 300000

// An endpoint that has not answered in this long is not going to; the point is to move on to
// the next one quickly, not to wait out a hung gateway.
const PROBE_TIMEOUT_MS = 4000

// Cached on globalThis for the same reason lib/serverPublicClient.js does it: a hot reload
// would otherwise re-check every chain on every edit.
const globalForRpc = globalThis
const healthy = globalForRpc.__hupServerRpc ?? new Map()
if (process.env.NODE_ENV !== 'production') globalForRpc.__hupServerRpc = healthy

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

/** An ethers provider bound to one endpoint. Caller owns it and should destroy() it. */
export const providerForEndpoint = (endpoint, chainId) => {
  const request = new ethers.FetchRequest(endpoint.url)
  for (const [name, value] of Object.entries(endpoint.headers ?? {})) request.setHeader(name, value)

  // The chain is known before the first call, so the provider never spends a round trip
  // detecting what it is already being told.
  return new ethers.JsonRpcProvider(request, Number(chainId), { staticNetwork: true })
}

// Endpoints are tried best-first, except that one already known to work goes to the front —
// so the steady state is a single call to a known-good host, not a walk down the list.
const orderedFor = (chainId) => {
  const endpoints = serverRpcEndpoints(chainId)
  const known = healthy.get(Number(chainId))
  if (!known || Date.now() - known.at >= HEALTH_TTL_MS) return endpoints

  const rest = endpoints.filter((endpoint) => endpoint.url !== known.url)
  return endpoints.length === rest.length ? endpoints : [endpoints.find((entry) => entry.url === known.url), ...rest]
}

const remember = (chainId, endpoint) => healthy.set(Number(chainId), { at: Date.now(), url: endpoint.url })

/** Drop a chain's remembered endpoint so the next call re-checks from the top of the list. */
export const forgetServerRpc = (chainId) => healthy.delete(Number(chainId))

/**
 * Anything that means "this endpoint did not answer" rather than "the chain answered no".
 * A revert is a real answer and must never cost an endpoint its place.
 */
export const isTransportError = (err) => {
  const code = err?.code
  if (code === 'NETWORK_ERROR' || code === 'SERVER_ERROR' || code === 'TIMEOUT' || code === 'UNKNOWN_ERROR') return true

  return /fetch failed|econn|etimedout|socket|429|too many requests|forbidden|unauthorized|not supported|unsupported method/i.test(
    err?.shortMessage || err?.message || '',
  )
}

/**
 * Run read-only work against the first endpoint that can actually serve it, and remember
 * which one that was. Safe for reads only — `run` may be called once per endpoint, so never
 * put a transaction send inside it.
 *
 * @param {number|string} chainId Chain to read from.
 * @param {(provider: Object, endpoint: Object) => Promise<any>} run Work to perform.
 * @returns {Promise<any>} Whatever `run` returned.
 * @throws The last error seen when no endpoint could serve the work.
 */
export const withServerProvider = async (chainId, run) => {
  const endpoints = orderedFor(chainId)
  if (!endpoints.length) throw new Error(`No RPC endpoint configured for chain ${chainId}.`)

  let lastError = null

  for (const endpoint of endpoints) {
    const provider = providerForEndpoint(endpoint, chainId)

    try {
      const result = await run(provider, endpoint)
      remember(chainId, endpoint)
      return result
    } catch (err) {
      // A revert travelled through fine — the endpoint is healthy and the answer is no.
      if (!isTransportError(err)) {
        remember(chainId, endpoint)
        throw err
      }

      console.warn(`SERVER_RPC_ENDPOINT_FAILED chain ${chainId} via ${endpoint.host}:`, err.shortMessage || err.message)
      lastError = err
    } finally {
      provider.destroy()
    }
  }

  forgetServerRpc(chainId)
  console.error('SERVER_RPC_UNREACHABLE:', chainId, endpoints.map((entry) => entry.host).join(', '))
  throw lastError ?? new Error(`No RPC endpoint answered for chain ${chainId}.`)
}

// A single-shot check for callers that need one long-lived provider rather than a closure —
// the relay route, whose work ends in a send that must never be replayed against a second
// endpoint. Reads a balance rather than a chain id: it has to touch the same state a real
// call does, or it proves nothing about whether the endpoint will serve one.
const canServe = async (endpoint, chainId) => {
  const call = async (method, params) => {
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(endpoint.headers ?? {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })

      if (!response.ok) return null

      const json = await response.json()
      return json?.result ?? null
    } catch {
      return null
    }
  }

  // A gateway answering with someone else's chain is worse than one that refuses outright
  if (Number(await call('eth_chainId', [])) !== Number(chainId)) return false

  const balance = await call('eth_getBalance', [ZERO_ADDRESS, 'latest'])
  return typeof balance === 'string' && balance.startsWith('0x')
}

/**
 * A provider on the first endpoint that can serve a state read, or null when none can.
 * Callers own it and should destroy() it; on failure, call forgetServerRpc() so the next
 * attempt moves on instead of retrying the same bad host for the rest of the TTL.
 *
 * @param {number|string} chainId Chain to read from or send on.
 * @returns {Promise<Object|null>} An ethers provider, or null when the chain is unreachable.
 */
export const getServerProvider = async (chainId) => {
  const endpoints = orderedFor(chainId)
  if (!endpoints.length) return null

  const known = healthy.get(Number(chainId))
  if (known && Date.now() - known.at < HEALTH_TTL_MS) {
    const endpoint = endpoints.find((entry) => entry.url === known.url)
    if (endpoint) return providerForEndpoint(endpoint, chainId)
  }

  for (const endpoint of endpoints) {
    if (await canServe(endpoint, chainId)) {
      remember(chainId, endpoint)
      return providerForEndpoint(endpoint, chainId)
    }
  }

  console.error('SERVER_RPC_UNREACHABLE:', chainId, endpoints.map((entry) => entry.host).join(', '))
  return null
}
