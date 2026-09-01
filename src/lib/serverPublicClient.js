/**
 * @file lib/serverPublicClient.js
 * @description Memoized viem public clients for server-side contract reads. Imports
 * chain data from config/contracts (never config/wagmi) so evaluating this module
 * never constructs wallet connectors.
 */

import { createPublicClient, http } from 'viem'
import { appChains } from '@/config/contracts'

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

  // Keyed by endpoint as well as chain, because the map outlives a hot reload: repointing a
  // chain's RPC in config/contracts would otherwise keep handing back a client still bound to
  // the endpoint that was there at boot, and the edit would look like it did nothing until the
  // dev server was restarted.
  const rpcUrl = chain.rpcUrls.default.http[0]
  const cacheKey = `${id}|${rpcUrl}`

  const cached = clients.get(cacheKey)
  if (cached) return cached

  const client = createPublicClient({
    chain,
    // Metadata resolution fires several reads per token — batching folds them into
    // one JSON-RPC request so public endpoints don't rate-limit a feed render. Bounded so
    // an endpoint that stops answering costs a request twenty seconds, not viem's default four attempts.
    transport: http(rpcUrl, { batch: true, timeout: 10_000, retryCount: 1 }),
  })

  clients.set(cacheKey, client)
  return client
}
