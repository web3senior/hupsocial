/**
 * @file lib/pendingTips.js
 * @description Holds tips this tab has sent but the indexer hasn't published yet, so a
 * revalidation that reads the pre-tip row can't wipe the counter the tipper just watched
 * move. A tip is final onchain the moment the wallet returns a hash, but the badge reads
 * the API, and the API only knows what cidex has written — the gap between the two is
 * what this module covers.
 *
 * Lives apart from tipTracking so `usePostStats` can apply the floor on every fetch
 * without the two modules importing each other.
 */

// statsKey -> { baseline, pending }: the count the API reported when the first unindexed
// tip was sent, and how many tips this tab has added on top of it. Absent key = nothing
// is being held, and the API's own count is the truth.
const holds = new Map()

/**
 * Registers a sent tip against a post's stats key.
 * @param {string|null} statsKey SWR key every footer counter of the post reads.
 * @param {number} servedCount The tip count the API last reported for the post.
 */
export function holdTip(statsKey, servedCount) {
  if (!statsKey) return
  // Only the first hold sets the baseline — later tips stack on the same API reading, so
  // the floor stays right even when the cache has already been raised once.
  const entry = holds.get(statsKey) || { baseline: Math.max(0, Number(servedCount) || 0), pending: 0 }
  entry.pending += 1
  holds.set(statsKey, entry)
}

/**
 * Drops one held tip — the chain rejected it, so it was never a tip at all.
 * @param {string|null} statsKey SWR key every footer counter of the post reads.
 */
export function releaseTip(statsKey) {
  const entry = holds.get(statsKey)
  if (!entry) return

  entry.pending -= 1
  if (entry.pending <= 0) holds.delete(statsKey)
}

/** @returns {boolean} Whether the key still carries a tip the API hasn't published. */
export const hasPendingTips = (statsKey) => holds.has(statsKey)

/**
 * Raises a freshly fetched post row to the held count, and lets the hold go once the API
 * has caught up on its own. Called from the stats fetcher, so it covers every revalidation
 * path — the post-tip pulls, focus, reconnect, and any other counter's mutate.
 * @param {string|null} statsKey SWR key every footer counter of the post reads.
 * @param {Object} row The row about to be written into the cache.
 * @returns {Object} The row, with total_tips raised when a held tip is missing from it.
 */
export function applyPendingTips(statsKey, row) {
  const entry = holds.get(statsKey)
  if (!entry || !row) return row

  const floor = entry.baseline + entry.pending
  if ((Number(row.total_tips) || 0) >= floor) {
    // The indexer landed it: the API is authoritative again, dollars and all
    holds.delete(statsKey)
    return row
  }

  return { ...row, total_tips: floor }
}
