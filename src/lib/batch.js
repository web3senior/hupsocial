/**
 * @file lib/batch.js
 * @description Pure helpers for all-or-nothing batch transactions — today LSP26 followBatch
 * via lib/batchFollow.js. A call that reverts on one bad entry is sliced and summarised
 * here so the toast can say what was skipped instead of failing at wallet gas estimation.
 */

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
