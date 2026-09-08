/**
 * @file lib/fundTracking.js
 * @description Owns a backing from the moment its transaction is sent: bumps the campaign's
 * raised figure right away, holds a loading toast open while the chain mines it, then pulls
 * the campaign row until the indexer publishes the backing — or rolls the bump back and says
 * why. Lives in a module rather than in BackFundModal because the modal closes the instant
 * the transaction is sent — the receipt wait and the toast handle have to outlive it. The
 * other campaign transactions (withdraw, refund, close) ride the same toast-and-refetch shape
 * through trackFundTx, without an optimistic figure.
 */

import { useSyncExternalStore } from 'react'
import { mutate as globalMutate } from 'swr'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { config } from '@/config/wagmi'
import { toast } from '@/components/NextToast'

// How long cidex takes to see the Backed event depends on the chain and on how far behind the
// indexer is, so the row is pulled on a widening schedule rather than once at a guessed moment.
const REFRESH_SCHEDULE_MS = [5_000, 10_000, 20_000, 40_000, 60_000]
// Long enough for a slow chain to mine, short enough that a transaction nobody will ever see
// mined stops holding a toast open.
const RECEIPT_TIMEOUT_MS = 120_000

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

/** The cache key every reader of one campaign shares, whatever query string it adds. */
export const fundKey = (chainId, campaignId) => `${Number(chainId)}-${String(campaignId)}`

// Backings the chain has accepted but the index has not published yet, keyed by fundKey.
// Every card and page reading that campaign adds these on top of the indexed row, so the
// figure the backer just moved never blinks back while cidex catches up.
const pending = new Map()
const listeners = new Set()

const emit = () => {
  for (const listener of listeners) listener()
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const EMPTY = { amount: 0n, count: 0 }

const snapshotFor = (key) => pending.get(key) ?? EMPTY

/**
 * The backings still held for a campaign — wei not yet in the indexed `raised`, and how
 * many of them are first-time backers as far as this viewer knows.
 * @param {number} chainId
 * @param {string|number} campaignId
 * @returns {{amount: bigint, count: number}}
 */
export const usePendingBacking = (chainId, campaignId) => {
  const key = fundKey(chainId, campaignId)
  return useSyncExternalStore(
    subscribe,
    () => snapshotFor(key),
    () => EMPTY,
  )
}

/**
 * Applies the held backings to an indexed row, so a reader sees raised and backer_count the
 * way the chain already has them.
 * @param {Object|null|undefined} campaign Indexed campaign row.
 * @param {{amount: bigint, count: number}} held From usePendingBacking.
 * @returns {Object|null|undefined} The row with the hold applied, or the row itself when idle.
 */
export const withPendingBacking = (campaign, held) => {
  if (!campaign || !held || held.amount === 0n) return campaign
  let raised
  try {
    raised = (BigInt(campaign.raised ?? 0) + held.amount).toString()
  } catch {
    return campaign
  }
  return { ...campaign, raised, backer_count: Number(campaign.backer_count ?? 0) + held.count }
}

const hold = (key, amount, firstTime) => {
  const current = snapshotFor(key)
  pending.set(key, { amount: current.amount + amount, count: current.count + (firstTime ? 1 : 0) })
  emit()
}

const release = (key, amount, firstTime) => {
  const current = snapshotFor(key)
  const amountLeft = current.amount > amount ? current.amount - amount : 0n
  const countLeft = Math.max(0, current.count - (firstTime ? 1 : 0))
  if (amountLeft === 0n && countLeft === 0) pending.delete(key)
  else pending.set(key, { amount: amountLeft, count: countLeft })
  emit()
}

/** Refetches every SWR reader of a campaign, whatever query string each one added. */
export const refreshCampaign = (chainId, campaignId) =>
  globalMutate(
    (key) =>
      typeof key === 'string' &&
      (key.startsWith(`/api/v1/fund/${campaignId}?networkId=${chainId}`) || key.startsWith('/api/v1/fund?')),
  )

/**
 * Pulls the campaign until the indexer has published the backing, then drops the hold. The
 * indexed `raised` is monotonic, so the row has caught up the moment it reaches what the
 * viewer already saw.
 */
const refreshUntilIndexed = async (chainId, campaignId, targetRaised, amount, firstTime) => {
  const key = fundKey(chainId, campaignId)
  for (const delay of REFRESH_SCHEDULE_MS) {
    await wait(delay)
    const rows = await refreshCampaign(chainId, campaignId)
    const detail = rows?.find?.((row) => row?.data?.campaign)
    let indexedRaised = 0n
    try {
      indexedRaised = BigInt(detail?.data?.campaign?.raised ?? 0)
    } catch {
      indexedRaised = 0n
    }
    if (indexedRaised >= targetRaised) {
      release(key, amount, firstTime)
      return
    }
  }
  // Out of tries: the hold stays for the rest of the page, so the figure keeps the backing.
}

/**
 * Takes over a backing whose transaction has just been accepted by the wallet. The modal that
 * called this can close right away.
 * @param {Object} params
 * @param {Object} params.campaign The indexed campaign row as the modal saw it.
 * @param {string} params.hash Transaction hash on the campaign's own chain.
 * @param {bigint} params.amount Wei sent.
 * @param {boolean} params.firstTime True when the viewer had never backed this campaign.
 * @param {string} params.amountLabel The backing as the user saw it, e.g. "$25 · 0.8 LYX".
 */
export function trackBacking({ campaign, hash, amount, firstTime, amountLabel }) {
  const chainId = Number(campaign.network_id)
  const campaignId = String(campaign.campaign_id)
  const key = fundKey(chainId, campaignId)
  const handle = toast(`Sending ${amountLabel}…`, 'loading')
  const report = (message, type) => {
    if (!handle.update(message, type)) toast(message, type)
  }

  let targetRaised = amount
  try {
    targetRaised = BigInt(campaign.raised ?? 0) + amount
  } catch {
    targetRaised = amount
  }

  hold(key, amount, firstTime)

  waitForTransactionReceipt(config, { chainId, hash, timeout: RECEIPT_TIMEOUT_MS })
    .then((receipt) => {
      if (receipt.status !== 'success') {
        release(key, amount, firstTime)
        refreshCampaign(chainId, campaignId)
        report(`Your ${amountLabel} backing was rejected onchain — nothing was sent.`, 'error')
        return
      }

      report(`${amountLabel} sent — thank you for backing this campaign`, 'success')
      refreshUntilIndexed(chainId, campaignId, targetRaised, amount, firstTime)
    })
    .catch((error) => {
      console.warn('Could not settle the backing transaction:', error.message)
      report('Still confirming — your backing will show once the network catches up.', 'info')
      refreshUntilIndexed(chainId, campaignId, targetRaised, amount, firstTime)
    })
}

/**
 * Takes over any other campaign transaction — withdraw, refund switch, refund claim, early
 * close — once the wallet has accepted it: a loading toast until the receipt, the verdict in
 * place of it, and the campaign refetched on a widening schedule so the indexed row catches
 * up on screen. The button that called this can unlock right away.
 * @param {Object} params
 * @param {number} params.chainId
 * @param {string|number} params.campaignId
 * @param {string} params.hash
 * @param {string} params.pending Toast copy while it mines.
 * @param {string} params.success Toast copy once it lands.
 * @param {string} params.failure Toast copy if it reverts.
 */
export function trackFundTx({ chainId, campaignId, hash, pending: pendingCopy, success, failure }) {
  const handle = toast(pendingCopy, 'loading')
  const report = (message, type) => {
    if (!handle.update(message, type)) toast(message, type)
  }

  const refreshAfter = async () => {
    for (const delay of REFRESH_SCHEDULE_MS) {
      await wait(delay)
      await refreshCampaign(chainId, campaignId)
    }
  }

  waitForTransactionReceipt(config, { chainId: Number(chainId), hash, timeout: RECEIPT_TIMEOUT_MS })
    .then((receipt) => {
      if (receipt.status !== 'success') {
        report(failure, 'error')
        return
      }
      report(success, 'success')
      refreshAfter()
    })
    .catch((error) => {
      console.warn('Could not settle the campaign transaction:', error.message)
      report('Still confirming — the campaign will update once the network catches up.', 'info')
      refreshAfter()
    })
}
