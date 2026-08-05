/**
 * @file lib/concurrency.js
 * @description Bounded-parallelism map.
 *
 * Resolving NFT metadata means RPC reads and gateway fetches, so anything that works through
 * a list of tokens has to cap how many conversations it opens at once — a whole grid or a
 * whole collection fired off in parallel would hit rate limits on both ends.
 */

/**
 * Maps over items with a bounded number of in-flight workers, preserving input order.
 * @param {Array} items
 * @param {number} limit Maximum number of workers running at once.
 * @param {Function} worker Called with (item, index); its resolved value lands at that index.
 * @returns {Promise<Array>} Results in input order.
 */
export const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}
