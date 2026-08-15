/**
 * @file lib/batchLike.js
 * @description Pure helpers for sending a basket of queued likes. Extracted from the old
 * /batch-like page so the floating basket trigger is the only surface left.
 *
 * Mirrored from Hup.sol: batchLike is all-or-nothing — it reverts the whole array on an
 * oversized batch or on a single unlikeable id, so a basket is validated and sliced here
 * instead of failing at wallet gas estimation.
 */

import abi from '@/abi/post.json'

export const MAX_BATCH_LIKE_COUNT = 50
const MAX_BATCH_READ_COUNT = 100
const CONTENT_TYPE_REPOST = 2

export const chunk = (items, size) => {
  const groups = []
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size))
  return groups
}

// Reason labels double as the toast copy, so keep them short and plural-safe
export const describeDropped = (dropped) => {
  const counts = dropped.reduce((acc, entry) => ({ ...acc, [entry.reason]: (acc[entry.reason] ?? 0) + 1 }), {})
  return Object.entries(counts)
    .map(([reason, count]) => `${count} ${reason}`)
    .join(', ')
}

/**
 * Splits a queued basket into the ids batchLike will accept and the ids it can
 * never accept. Ids keep their original type so removeFromBatch still matches.
 * @param {Object} params
 * @param {Object} params.client Public client bound to the queued network.
 * @param {string} params.contractAddress Hup contract on that network.
 * @param {Array} params.ids Queued post ids for the network.
 * @param {string} params.viewer Wallet the likes are attributed to.
 * @returns {Promise<{likeable: Array, dropped: Array<{id: *, reason: string}>}>}
 */
export const preflightQueue = async ({ client, contractAddress, ids, viewer }) => {
  const contentCount = await client.readContract({
    abi,
    address: contractAddress,
    functionName: 'contentCount',
  })

  const likeable = []
  const dropped = []
  const inRange = []

  for (const id of ids) {
    let numeric

    try {
      numeric = BigInt(id)
    } catch {
      dropped.push({ id, reason: 'unreadable' })
      continue
    }

    if (numeric <= 0n || numeric > contentCount) dropped.push({ id, reason: 'missing' })
    else inRange.push({ id, numeric })
  }

  for (const group of chunk(inRange, MAX_BATCH_READ_COUNT)) {
    const views = await client.readContract({
      abi,
      address: contractAddress,
      functionName: 'getContents',
      args: [group.map((entry) => entry.numeric), viewer],
    })

    group.forEach((entry, index) => {
      const view = views[index]

      if (!view) dropped.push({ id: entry.id, reason: 'missing' })
      else if (view.isDeleted) dropped.push({ id: entry.id, reason: 'deleted' })
      else if (Number(view.cType) === CONTENT_TYPE_REPOST) dropped.push({ id: entry.id, reason: 'reposts' })
      else if (view.hasLiked) dropped.push({ id: entry.id, reason: 'already liked' })
      else likeable.push(entry.id)
    })
  }

  return { likeable, dropped }
}
