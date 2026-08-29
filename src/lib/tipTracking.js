/**
 * @file lib/tipTracking.js
 * @description Owns a tip from the moment its transaction is sent: bumps the post's counter
 * right away, holds a loading toast open while the chain mines it, then pulls the post row
 * until the indexer publishes the tip — or rolls the counter back and says why.
 *
 * Lives in a module rather than in TipModal because the modal closes the instant the
 * transaction is sent — the receipt wait and the toast handle have to outlive it.
 */

import { mutate as globalMutate } from 'swr'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { config } from '@/config/wagmi'
import { toast } from '@/components/NextToast'
import { getPostStatsKey } from '@/hooks/usePostStats'
import { applyPendingTips, hasPendingTips, holdTip, releaseTip } from '@/lib/pendingTips'

// How long cidex takes to see the Tipped event depends on the chain and on how far behind
// the indexer is, so the row is pulled on a widening schedule rather than once at a guessed
// moment. Every pull that still predates the tip leaves the held count standing — the badge
// never blinks back to what it said before the tip was sent.
const REFRESH_SCHEDULE_MS = [5_000, 10_000, 20_000, 40_000, 60_000]
// Long enough for a slow chain to mine, short enough that a transaction nobody will ever see
// mined stops holding a toast open. Running out is not a verdict — the counter keeps its bump
// and the next refresh settles it either way.
const RECEIPT_TIMEOUT_MS = 120_000

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

/**
 * Puts the tip on the post's counter without asking the API — the indexer lands the Tipped
 * event seconds after the receipt at the earliest, so the count the viewer sees is held
 * here until the row catches up.
 * @param {string|null} statsKey SWR key every footer counter of the post reads.
 * @param {object} post Fallback row when the cache has nothing for the key yet.
 */
const holdCurrentTip = async (statsKey, post) => {
  if (!statsKey) return

  // The badge renders from the SWR cache, not from the row the modal was opened with, so
  // the floor has to start from whatever the cache holds right now. An identity mutator
  // reads it without touching it.
  const cached = await globalMutate(statsKey, (data) => data, { revalidate: false })
  holdTip(statsKey, cached?.total_tips ?? post?.total_tips)
  await globalMutate(statsKey, (current) => applyPendingTips(statsKey, current || post), { revalidate: false })
}

/**
 * Pulls the post row until the indexer has published the tip, backing off between tries.
 * The stats fetcher applies the hold to whatever comes back and releases it the moment the
 * API's own count catches up, so this loop only has to keep asking.
 * @param {string|null} statsKey SWR key every footer counter of the post reads.
 */
const refreshUntilIndexed = async (statsKey) => {
  for (const delay of REFRESH_SCHEDULE_MS) {
    await wait(delay)
    if (!hasPendingTips(statsKey)) return
    await globalMutate(statsKey)
  }
  // Out of tries: the hold stays, so the counter keeps the tip for the rest of the page.
  // Only the dollar figure waits on the indexer now.
}

/**
 * Takes over a tip whose transaction has just been accepted by the wallet.
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

  const held = holdCurrentTip(statsKey, post)

  waitForTransactionReceipt(config, { chainId: Number(post.network_id), hash, timeout: RECEIPT_TIMEOUT_MS })
    .then(async (receipt) => {
      if (receipt.status !== 'success') {
        // Reverted: the tip never left the wallet, so the counter goes back to what the API says
        await held
        releaseTip(statsKey)
        globalMutate(statsKey)
        report(`Your ${amountLabel} tip was rejected onchain — nothing was sent.`, 'error')
        return
      }

      report(`${amountLabel} tip confirmed`, 'success')
      // The badge shows dollars, and only the API can price them — so keep pulling the row
      // until the indexed tip (and its price) replaces the held count
      refreshUntilIndexed(statsKey)
    })
    .catch((error) => {
      // Timed out or the RPC dropped: not a verdict. Keep the bump and let the pulls decide.
      console.warn('Could not settle the tip transaction:', error.message)
      report('Still confirming — the tip will show once the network catches up.', 'info')
      refreshUntilIndexed(statsKey)
    })
}
