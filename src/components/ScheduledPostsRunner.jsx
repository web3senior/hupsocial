'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useConnection } from 'wagmi'
import { trackPostPublication } from '@/lib/postPublication'
import {
  clearScheduleToken,
  deliverDueScheduledPosts,
  listScheduledPosts,
  readScheduleToken,
  SCHEDULE_POKE_EVENT,
  subscribeScheduleToken,
} from '@/lib/scheduledPosts'

const TICK_MS = 60_000

const nowSeconds = () => Math.floor(Date.now() / 1000)

/**
 * Speeds up scheduled posts while their author happens to be online. The relayer publishes them
 * either way (the cron in app/api/v1/cron/scheduled-posts); this only asks for the sweep the moment
 * a post is due instead of at the next tick, and shows the usual publishing toast when it goes out.
 * Never prompts and renders nothing. Needs the list token, so it stays idle for an author who has
 * never opened /scheduled.
 */
export default function ScheduledPostsRunner() {
  const { address, isConnected } = useConnection()
  const token = useSyncExternalStore(
    subscribeScheduleToken,
    () => readScheduleToken(address),
    () => null,
  )
  const busyRef = useRef(false)

  const tick = useCallback(async () => {
    if (!address || !token || busyRef.current || document.hidden) return
    busyRef.current = true

    try {
      const now = nowSeconds()
      const rows = await listScheduledPosts(token, 'pending')
      const due = rows.filter((row) => row.status === 'scheduled' && row.scheduledAt <= now && (!row.retryAt || row.retryAt <= now))
      if (due.length === 0) return

      const result = await deliverDueScheduledPosts(token)
      for (const sent of result?.sent ?? []) {
        const row = due.find((item) => item.id === sent.id)
        if (!row) continue
        trackPostPublication({ networkId: row.networkId, author: address, metadata: row.metadata, kind: 'post', txHash: sent.txHash })
      }
    } catch (error) {
      // A token the server no longer accepts is dropped, so the list page asks for a fresh sign-in
      if (error.status === 401) clearScheduleToken(address)
      else console.warn('Scheduled posts check failed:', error.message)
    } finally {
      busyRef.current = false
    }
  }, [address, token])

  useEffect(() => {
    if (!isConnected || !address || !token) return

    tick()
    const interval = window.setInterval(tick, TICK_MS)
    const onWake = () => {
      if (!document.hidden) tick()
    }
    window.addEventListener(SCHEDULE_POKE_EVENT, onWake)
    document.addEventListener('visibilitychange', onWake)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener(SCHEDULE_POKE_EVENT, onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [isConnected, address, token, tick])

  return null
}
