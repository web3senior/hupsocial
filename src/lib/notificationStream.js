/**
 * @file lib/notificationStream.js
 * @description Server-side fan-out behind /api/v1/notifications/stream. cidex writes the
 * notifications table from its own process, so nothing in this one is told when a row lands —
 * instead ONE ticker per Node process tails the table by primary key and hands each new row to
 * the SSE connections open for its recipient. The cost is one indexed range read per tick no
 * matter how many readers are connected, and the ticker stops when the last one leaves.
 *
 * Single-process by design: the subscriber map lives in this process's memory, which holds for
 * `next start` on one box. Running several instances behind a balancer still works (each tails
 * on its own), but serverless functions would drop it — that is the point to move to pub/sub.
 */
import pool from '@/lib/db'
import { normalizeAddress } from '@/lib/address'
import { NOTIFICATION_COLUMNS, serializeNotification } from '@/lib/notificationRows'

const TICK_MS = 3000
// A burst larger than this drains over the following ticks instead of in one read
const BATCH_LIMIT = 500

// Dev reloads re-evaluate modules; keeping the state on globalThis stops each reload from
// starting another ticker alongside the old one.
const state = (globalThis.__hupNotificationStream ??= {
  subscribers: new Map(),
  lastId: null,
  timer: null,
  busy: false,
})

/**
 * Registers `send` for every new row addressed to `wallet` that someone else caused — the same
 * set the notifications page opens on (`filter=inbox`).
 * @param {string} wallet
 * @param {(notification: object) => void} send
 * @returns {() => void} unsubscribe
 */
export function subscribeNotifications(wallet, send) {
  const key = normalizeAddress(wallet)
  let listeners = state.subscribers.get(key)
  if (!listeners) {
    listeners = new Set()
    state.subscribers.set(key, listeners)
  }
  listeners.add(send)
  start()

  return () => {
    listeners.delete(send)
    if (listeners.size === 0) state.subscribers.delete(key)
    if (state.subscribers.size === 0) stop()
  }
}

function start() {
  if (state.timer) return
  state.timer = setInterval(tick, TICK_MS)
  tick()
}

function stop() {
  clearInterval(state.timer)
  state.timer = null
  // The next reader starts from "now" — rows written while nobody listened are the catch-up
  // request's job, not the stream's
  state.lastId = null
}

async function tick() {
  if (state.busy) return
  state.busy = true

  try {
    if (state.lastId === null) {
      const [[head]] = await pool.execute('SELECT COALESCE(MAX(id), 0) AS id FROM notifications')
      state.lastId = Number(head.id)
      return
    }

    // Every row past the cursor, self-rows included, so the cursor can step over them; the
    // recipient filter happens in memory where it costs nothing.
    const [rows] = await pool.execute(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE id > ? ORDER BY id ASC LIMIT ${BATCH_LIMIT}`,
      [state.lastId],
    )
    if (rows.length === 0) return
    state.lastId = Number(rows[rows.length - 1].id)

    rows.forEach((row) => {
      const recipient = normalizeAddress(row.recipient_wallet_address)
      const actor = normalizeAddress(row.actor_wallet_address)
      if (!actor || actor === recipient) return

      const listeners = state.subscribers.get(recipient)
      if (!listeners) return

      const notification = serializeNotification(row)
      listeners.forEach((send) => send(notification))
    })
  } catch (error) {
    console.error('[NOTIFICATION_STREAM_TICK_ERROR]:', error.message)
  } finally {
    state.busy = false
  }
}
