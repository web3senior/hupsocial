/**
 * @file lib/serverPublicClient.js
 * @description Memoized viem public clients for server-side contract reads. Imports
 * chain data from config/contracts (never config/wagmi) so evaluating this module
 * never constructs wallet connectors.
 *
 * Endpoints come from lib/serverRpc's resolution order (RPC_URL_<chainId> first, then the
 * chain's listed URLs, thirdweb hosts keyed when THIRDWEB_RPC_SECRET_KEY is set) behind a
 * viem fallback transport, so a keyless endpoint refusing our datacenter egress costs one
 * timeout before the next is tried, never the whole request.
 */

import { createPublicClient, fallback, http } from 'viem'
import { appChains } from '@/config/contracts'
import { serverRpcEndpoints } from '@/lib/serverRpc'

// One endpoint that stops answering costs this long before the next is asked
const ENDPOINT_TIMEOUT_MS = 10_000

// Cached on globalThis so hot reloads reuse the clients (and their HTTP agents)
// instead of leaking a new transport per edit, same reasoning as lib/db.js.
const globalForClients = globalThis
const clients = globalForClients.__hupPublicClients ?? new Map()
if (process.env.NODE_ENV !== 'production') globalForClients.__hupPublicClients = clients

/**
 * Resolves a read-only viem client for one of the app's chains.
 * @param {number|string} chainId Chain to read from.
 * @returns {Object|null} A viem public client, or null when the chain isn't configured.
 */
export const getServerPublicClient = (chainId) => {
  const id = Number(chainId)
  if (!Number.isFinite(id)) return null

  const chain = appChains.find((c) => c.id === id)
  if (!chain) return null

  const endpoints = serverRpcEndpoints(id)
  if (!endpoints.length) return null

  // Keyed by the endpoint list as well as chain, because the map outlives a hot reload:
  // repointing a chain's RPC in config/contracts or the env would otherwise keep handing back
  // a client still bound to the endpoints that were there at boot.
  const cacheKey = `${id}|${endpoints.map((endpoint) => endpoint.url).join(',')}`

  const cached = clients.get(cacheKey)
  if (cached) return cached

  // Metadata resolution fires several reads per token — batching folds them into one
  // JSON-RPC request so public endpoints don't rate-limit a feed render. Retries stay off per
  // endpoint so failing over is what a dead endpoint triggers, not a second wait on it.
  const transports = endpoints.map((endpoint) =>
    http(endpoint.url, {
      batch: true,
      timeout: ENDPOINT_TIMEOUT_MS,
      retryCount: 0,
      ...(endpoint.headers ? { fetchOptions: { headers: endpoint.headers } } : {}),
    }),
  )

  const client = createPublicClient({
    chain,
    transport: fallback(transports, { retryCount: 0 }),
  })

  clients.set(cacheKey, client)
  return client
}
