/**
 * @file lib/taskTracking.js
 * @description Owns a task transaction once the wallet has returned its hash: a loading toast
 * until the receipt, the verdict in its place, then the task refetched on a widening schedule
 * so the indexed row catches up on screen. The dialog that sent it can close right away.
 */

import { mutate as globalMutate } from 'swr'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { config } from '@/config/wagmi'
import { toast } from '@/components/NextToast'

const REFRESH_SCHEDULE_MS = [4_000, 8_000, 15_000, 30_000, 60_000]
const RECEIPT_TIMEOUT_MS = 120_000

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

export const taskDetailKey = (networkId, postId) => `/api/v1/tasks/${Number(networkId)}/${postId}`

/** Refetches every SWR reader of one task, plus the directory lists. */
export const refreshTask = (networkId, postId) =>
  globalMutate(
    (key) => typeof key === 'string' && (key.startsWith(taskDetailKey(networkId, postId)) || key.startsWith('/api/v1/tasks?')),
  )

/**
 * @param {Object} params
 * @param {number} params.chainId
 * @param {string|number} params.postId
 * @param {string} params.hash
 * @param {string} params.pending Toast copy while it mines.
 * @param {string} params.success Toast copy once it lands.
 * @param {string} params.failure Toast copy if it reverts.
 * @param {Function} [params.onConfirmed] Runs after a successful receipt.
 */
export function trackTaskTx({ chainId, postId, hash, pending, success, failure, onConfirmed }) {
  const handle = toast(pending, 'loading')
  const report = (message, type) => {
    if (!handle.update(message, type)) toast(message, type)
  }

  const refreshAfter = async () => {
    for (const delay of REFRESH_SCHEDULE_MS) {
      await wait(delay)
      await refreshTask(chainId, postId)
    }
  }

  waitForTransactionReceipt(config, { chainId: Number(chainId), hash, timeout: RECEIPT_TIMEOUT_MS })
    .then((receipt) => {
      if (receipt.status !== 'success') {
        report(failure, 'error')
        refreshTask(chainId, postId)
        return
      }
      report(success, 'success')
      onConfirmed?.(receipt)
      refreshAfter()
    })
    .catch((error) => {
      console.warn('Could not settle the task transaction:', error.message)
      report('Still confirming — the task will update once the network catches up.', 'info')
      refreshAfter()
    })
}
