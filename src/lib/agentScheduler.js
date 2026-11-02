/**
 * @file lib/agentScheduler.js
 * @description Runs hosted agents' scheduled tasks from inside the app server. Server-only.
 *
 * Started once per server process by instrumentation.js: every few minutes it runs the hourly and
 * daily tasks whose time has come (lib/agentTasks.js). There is no public trigger, so nothing
 * outside the app can make an agent run. Several processes are safe too: each task is claimed
 * before it runs, and a run books the next one, so a task never runs more often than its schedule.
 */

import { listDueTasks, runTask } from '@/lib/agentTasks'

const TICK_MS = 5 * 60_000
// The first tick waits for the server to settle after a start or a deploy
const FIRST_TICK_MS = 30_000
// A tick stops picking up new runs after this; whatever is left goes to the next tick
const TICK_BUDGET_MS = 4 * 60_000
const TASKS_PER_TICK = 20

let isTicking = false

/** One pass over the due tasks, one at a time. One agent's failure never holds up the rest. */
export const runDueAgentTasks = async () => {
  const started = Date.now()
  const results = []
  for (const due of await listDueTasks(TASKS_PER_TICK)) {
    if (Date.now() - started > TICK_BUDGET_MS) break
    try {
      results.push({ id: due.id, ...(await runTask(due.owner, due.agentAddress, due.id)) })
    } catch (error) {
      console.error('[AGENT_SCHEDULER_ERROR]:', due.id, error?.status, error?.message)
      results.push({ id: due.id, status: 'failed' })
    }
  }
  return results
}

// A slow tick (several long runs) is never overlapped by the next one
const tick = async () => {
  if (isTicking) return
  isTicking = true
  try {
    const results = await runDueAgentTasks()
    if (results.length) console.info(`[AGENT_SCHEDULER]: ran ${results.length} task(s)`, results.map(({ id, status }) => `${id}:${status}`).join(' '))
  } catch (error) {
    console.error('[AGENT_SCHEDULER_ERROR]:', error?.message)
  } finally {
    isTicking = false
  }
}

/** Starts the timer. Kept on globalThis, so a dev hot reload or a second register() never adds another. */
export const startAgentScheduler = () => {
  if (globalThis.__hupAgentScheduler) return
  const first = setTimeout(tick, FIRST_TICK_MS)
  const every = setInterval(tick, TICK_MS)
  // Never the reason the process stays up
  first.unref?.()
  every.unref?.()
  globalThis.__hupAgentScheduler = { first, every }
  console.info('[AGENT_SCHEDULER]: running scheduled agent tasks every 5 minutes')
}
