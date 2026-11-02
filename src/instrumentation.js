/**
 * @file instrumentation.js
 * @description Runs once when a Next.js server process starts.
 *
 * Starts the hosted-agent task scheduler (lib/agentScheduler.js) on the Node.js server only — not
 * on the edge runtime, and not while `next build` collects pages. AGENT_TASKS_SCHEDULER=off turns
 * it off, for a process that should serve requests and nothing else.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.AGENT_TASKS_SCHEDULER === 'off') return

  const { startAgentScheduler } = await import('@/lib/agentScheduler')
  startAgentScheduler()
}
