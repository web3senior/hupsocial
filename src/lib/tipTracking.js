/**
 * @file lib/tipTracking.js
 * @description Owns a tip from the moment its transaction is sent: bumps the post's counter
 * right away, holds a loading toast open while the chain mines it, then either schedules the
 * indexer refresh that moves the dollar badge or rolls the counter back and says why.
 *
 * Lives in a module rather than in TipModal because the modal closes the instant the
 * transaction is sent — the receipt wait and the toast handle have to outlive it.
 */

import { mutate as globalMutate } from 'swr'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { config } from '@/config/wagmi'
import { toast } from '@/components/NextToast'
import { getPostStatsKey } from '@/hooks/usePostStats'

// cidex polls its chains every second, so the Tipped event is indexed within a few seconds
// of the receipt. Long enough that the refetch reads the new row, short enough that the
// dollar badge updates while the tipper is still looking at the post.
const TIP_INDEX_DELAY_MS = 10_000
// Long enough for a slow chain to mine, short enough that a transaction nobody will ever see
// mined stops holding a toast open. Running out is not a verdict — the counter keeps its bump
// and the next refresh settles it either way.
const RECEIPT_TIMEOUT_MS = 120_000

/**
 * Moves the post's tip counter without asking the API — the indexer lands the Tipped event a
 * few seconds after the receipt, so revalidating too early would snap the counter back.
 * @param {string|null} statsKey SWR key every footer counter of the post reads.
 * @param {object} post Fallback row when the cache has nothing for the key yet.
 * @param {number} delta +1 when the tip is sent, -1 when the chain rejects it.
 */
const shiftTipCount = (statsKey, post, delta) =>
  globalMutate(
    statsKey,
    (current) => {
      const base = current || post
      return { ...base, total_tips: Math.max(0, Number(base?.total_tips || 0) + delta) }
    },
    { revalidate: false },
  )

/**
 * Takes over a tip whose transaction has just been accepted by the wallet or the session key.
 * The modal that called this can close right away.
 * @param {object} params
 * @param {object} params.post The tipped post, with network metadata and its current counters.
 * @param {string} [params.viewer] Connected wallet — part of the stats cache key the badge reads.
 * @param {string} params.hash Transaction hash on the post's own chain.
 * @param {string} params.amountLabel The tip as the user typed it, e.g. "5 LYX".
 */
export function trackTip({ post, viewer, hash, amountLabel }) {
  const statsKey = getPostStatsKey(post, viewer)
  const handle = toast(`Sending ${amountLabel}…`, 'loading')
  // The user may have closed the card already — the verdict still deserves to be seen
  const report = (message, type) => {
    if (!handle.update(message, type)) toast(message, type)
  }

  shiftTipCount(statsKey, post, 1)

  waitForTransactionReceipt(config, { chainId: Number(post.network_id), hash, timeout: RECEIPT_TIMEOUT_MS })
    .then((receipt) => {
      if (receipt.status !== 'success') {
        // Reverted: the tip never left the wallet, so the counter goes back to what the API says
        shiftTipCount(statsKey, post, -1)
        globalMutate(statsKey)
        report(`Your ${amountLabel} tip was rejected onchain — nothing was sent.`, 'error')
        return
      }

      report(`${amountLabel} tip confirmed`, 'success')
      // The badge shows dollars, and only the API can price them — so once the indexer has had
      // time to land the event, pull the row again to move the earned figure
      window.setTimeout(() => globalMutate(statsKey), TIP_INDEX_DELAY_MS)
    })
    .catch((error) => {
      // Timed out or the RPC dropped: not a verdict. Keep the bump and let the refresh decide.
      console.warn('Could not settle the tip transaction:', error.message)
      report('Still confirming — the tip will show once the network catches up.', 'info')
      window.setTimeout(() => globalMutate(statsKey), TIP_INDEX_DELAY_MS)
    })
}
