'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { getNftCollectionAudit, requestNftCollectionAudit } from '@/lib/api'

// While cidex is probing, the row's state moves in seconds — poll on this clock, and stop the
// moment a report lands. Never on a settled row: a day-old report does not change on its own.
const PENDING_POLL_MS = 5000
// A running audit writes its stage every few seconds; poll close to that
const RUNNING_POLL_MS = 3000
// A settled row still changes on its own — the daily re-audit, a re-check asked for elsewhere —
// so it is re-read on a slow clock rather than never
const SETTLED_POLL_MS = 60000
const PENDING_STATES = new Set(['pending', 'running', 'refreshing'])
const RUNNING_STATES = new Set(['running', 'refreshing'])

/**
 * The permanence audit for one collection, as cidex holds it: the score, grade and badges
 * (and, unless `summary`, the full report and history), plus where the row is in the queue.
 *
 * `autoRequest` asks for an audit when a collection with no row is looked at — the collection
 * page does this so the market audits itself as people browse it — and moves a row that is
 * still waiting to the front of the queue, so the collection on screen is the next one probed.
 * The tool page asks explicitly through `request`, which also re-audits a settled collection;
 * the server answers a request inside its cooldown with a throttled error carrying the row.
 *
 * @param {Object} params
 * @param {number|string} params.chainId Chain the collection lives on.
 * @param {string} params.collection NFT contract address.
 * @param {boolean} [params.enabled=true] Skip fetching while inputs are incomplete.
 * @param {boolean} [params.summary=false] Leave the report and history out of the fetch.
 * @param {boolean} [params.autoRequest=false] Queue an audit when none exists yet.
 */
export default function useCollectionAudit({ chainId, collection, enabled = true, summary = false, autoRequest = false }) {
  const ready = Boolean(enabled && chainId && collection)
  const key = ready ? ['nft-collection-audit', Number(chainId), collection.toLowerCase(), summary ? 'summary' : 'full'] : null

  const { data, error, isLoading, mutate } = useSWR(key, () => getNftCollectionAudit(chainId, collection, { summary }), {
    revalidateOnFocus: false,
    refreshInterval: (latest) => (latest && RUNNING_STATES.has(latest.status) && latest.data?.startedAt ? RUNNING_POLL_MS : latest && PENDING_STATES.has(latest.status) ? PENDING_POLL_MS : latest?.status === 'done' ? SETTLED_POLL_MS : 0),
  })

  const status = data?.status || (isLoading ? 'loading' : 'none')
  const audit = data?.data || null

  const [isRequesting, setIsRequesting] = useState(false)
  const [requestError, setRequestError] = useState(null)
  // One automatic request per collection, however many times the hook re-renders
  const autoRequestedRef = useRef(null)

  const request = useCallback(async () => {
    if (!ready || isRequesting) return null
    setIsRequesting(true)
    setRequestError(null)
    try {
      const body = await requestNftCollectionAudit(chainId, collection)
      // The POST answers with the summary row; a full consumer re-reads to pick up the report
      // once the audit lands, so only the status is written into the cache here
      await mutate((current) => ({ ...(current || {}), success: true, status: body.status, data: summary ? body.data : { ...(current?.data || {}), ...body.data, report: current?.data?.report ?? null, history: current?.data?.history ?? [] } }), { revalidate: !summary })
      return body
    } catch (requestFailure) {
      setRequestError(requestFailure)
      // A throttled request still tells us the row — keep the screen on it
      if (requestFailure.throttled && requestFailure.data) {
        await mutate((current) => ({ ...(current || {}), success: true, status: requestFailure.status, data: { ...(current?.data || {}), ...requestFailure.data, report: current?.data?.report ?? null, history: current?.data?.history ?? [] } }), { revalidate: false })
      }
      return null
    } finally {
      setIsRequesting(false)
    }
  }, [ready, isRequesting, chainId, collection, summary, mutate])

  useEffect(() => {
    if (!autoRequest || !ready || !data || (data.status !== 'none' && data.status !== 'pending')) return
    const id = `${chainId}:${collection.toLowerCase()}`
    if (autoRequestedRef.current === id) return
    autoRequestedRef.current = id
    request()
  }, [autoRequest, ready, data, chainId, collection, request])

  return {
    status,
    audit,
    isLoading: ready && isLoading,
    isPending: PENDING_STATES.has(status),
    error,
    request,
    isRequesting,
    requestError,
    mutate,
  }
}
