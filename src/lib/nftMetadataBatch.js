/**
 * @file lib/nftMetadataBatch.js
 * @description Client-side request coalescer for NFT metadata.
 *
 * Each card resolves its own token, so a market grid or feed asks for ~30 tokens at once.
 * As 30 separate requests that is actively harmful: the app speaks HTTP/1.1, browsers open
 * only ~6 connections per origin, and the metadata calls end up queued ahead of the image
 * requests they exist to produce — the grid renders blank while the connection budget is
 * spent on JSON. Collecting the keys that arrive in the same tick into one POST keeps the
 * per-card API intact while leaving the connections free for artwork.
 */

// Long enough to catch a whole grid mounting, short enough to be invisible.
const BATCH_WINDOW_MS = 30

// Mirrors MAX_BATCH in the route handler.
const MAX_BATCH = 60

let pending = []
let timer = null

const flush = async () => {
  const batch = pending
  pending = []
  timer = null

  const chunks = []
  for (let i = 0; i < batch.length; i += MAX_BATCH) chunks.push(batch.slice(i, i + MAX_BATCH))

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const response = await fetch('/api/v1/nfts/metadata', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tokens: chunk.map((entry) => entry.token) }),
        })
        if (!response.ok) throw new Error(`Metadata batch responded ${response.status}`)

        const body = await response.json()
        if (!body?.success || !Array.isArray(body.data)) throw new Error(body?.error || 'Metadata batch returned no data')

        chunk.forEach((entry, index) => {
          const item = body.data[index]
          if (item) entry.resolve(item)
          else entry.reject(new Error('Token could not be resolved'))
        })
      } catch (error) {
        // Reject individually so each card can fall back to its own RPC read.
        chunk.forEach((entry) => entry.reject(error))
      }
    }),
  )
}

/**
 * Queues one token for the next batched metadata request.
 * @param {{chainId: number, collection: string, tokenId: string, isLsp8: boolean}} token
 * @returns {Promise<Object>} The same payload shape the single-token GET returns.
 */
export const loadNftMetadata = (token) =>
  new Promise((resolve, reject) => {
    pending.push({ token, resolve, reject })
    if (!timer) timer = setTimeout(flush, BATCH_WINDOW_MS)
  })
