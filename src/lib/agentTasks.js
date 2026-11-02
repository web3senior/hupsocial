/**
 * @file lib/agentTasks.js
 * @description Standing instructions an owner gives a hosted agent, run on demand or on a schedule.
 * Server-only. A run is an ordinary agent turn (lib/agentRuntime.js): its result lands in the
 * agent's chat, and anything that would act on Hup arrives as a draft for the owner to approve.
 */

import { z } from 'zod'
import pool from '@/lib/db'
import { normalizeAddress } from '@/lib/address'
import { AgentError, appendMessage, createSession, getAgent } from '@/lib/hostedAgents'
import { assertCanRun, runAgentTurn } from '@/lib/agentRuntime'

export const TASK_LIMIT = 10
export const TASK_TITLE_MAX = 120
export const TASK_INSTRUCTIONS_MAX = 2000

/** How long a run may hold its claim before a later tick treats it as abandoned. */
const STALE_RUN_MINUTES = 15

const SCHEDULE_INTERVAL = { hourly: 'INTERVAL 1 HOUR', daily: 'INTERVAL 1 DAY' }

const taskSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX),
  instructions: z.string().trim().min(1).max(TASK_INSTRUCTIONS_MAX),
  schedule: z.enum(['manual', 'hourly', 'daily']),
})

const updateSchema = taskSchema.partial().extend({ enabled: z.boolean().optional() })

const present = (row) => ({
  id: Number(row.id),
  title: row.title,
  instructions: row.instructions,
  schedule: row.schedule,
  enabled: Boolean(row.enabled),
  nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : null,
  lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
  isRunning: Boolean(row.running_since),
})

// A scheduled task is due one interval from now; a manual one is never due on its own
const nextRunSql = (schedule) => (SCHEDULE_INTERVAL[schedule] ? `DATE_ADD(NOW(), ${SCHEDULE_INTERVAL[schedule]})` : 'NULL')

export const listTasks = async (owner, agentAddress) => {
  const agent = await getAgent(owner, agentAddress)
  const [rows] = await pool.execute('SELECT * FROM agent_tasks WHERE agent_address = ? ORDER BY id', [agent.address])
  return rows.map(present)
}

const readTask = async (agentAddress, id) => {
  const [[row]] = await pool.execute('SELECT * FROM agent_tasks WHERE id = ? AND agent_address = ?', [Number(id), normalizeAddress(agentAddress)])
  if (!row) throw new AgentError(404, 'Task not found')
  return row
}

export const createTask = async (owner, agentAddress, input) => {
  const parsed = taskSchema.safeParse(input)
  if (!parsed.success) throw new AgentError(400, 'A task needs a title, instructions and a schedule')
  const agent = await getAgent(owner, agentAddress)

  const [[{ count }]] = await pool.execute('SELECT COUNT(*) AS count FROM agent_tasks WHERE agent_address = ?', [agent.address])
  if (Number(count) >= TASK_LIMIT) throw new AgentError(409, `An agent can have ${TASK_LIMIT} tasks`)

  const { title, instructions, schedule } = parsed.data
  const [result] = await pool.execute(
    `INSERT INTO agent_tasks (agent_address, title, instructions, schedule, next_run_at) VALUES (?, ?, ?, ?, ${nextRunSql(schedule)})`,
    [agent.address, title, instructions, schedule],
  )
  return present(await readTask(agent.address, result.insertId))
}

export const updateTask = async (owner, agentAddress, id, input) => {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) throw new AgentError(400, 'Check the task')
  const agent = await getAgent(owner, agentAddress)
  const current = await readTask(agent.address, id)

  const columns = { title: 'title', instructions: 'instructions', schedule: 'schedule', enabled: 'enabled' }
  const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  const sets = entries.map(([key]) => `${columns[key]} = ?`)
  // A new schedule, or switching a task back on, starts its clock again from now
  const schedule = parsed.data.schedule ?? current.schedule
  if (parsed.data.schedule !== undefined || parsed.data.enabled === true) sets.push(`next_run_at = ${nextRunSql(schedule)}`)

  if (sets.length) {
    await pool.execute(`UPDATE agent_tasks SET ${sets.join(', ')} WHERE id = ? AND agent_address = ?`, [
      ...entries.map(([, value]) => (typeof value === 'boolean' ? Number(value) : value)),
      Number(id),
      agent.address,
    ])
  }
  return present(await readTask(agent.address, id))
}

export const deleteTask = async (owner, agentAddress, id) => {
  const agent = await getAgent(owner, agentAddress)
  const [result] = await pool.execute('DELETE FROM agent_tasks WHERE id = ? AND agent_address = ?', [Number(id), agent.address])
  if (result.affectedRows === 0) throw new AgentError(404, 'Task not found')
}

/**
 * Claims one task for a run, so two triggers (a scheduler tick and the owner's Run now) never run it at
 * once. A claim older than STALE_RUN_MINUTES is from a run that died and can be taken over.
 * @returns {Promise<object|null>} The task, or null when it is already running.
 */
export const claimTask = async (agentAddress, id) => {
  const [result] = await pool.execute(
    `UPDATE agent_tasks SET running_since = NOW()
      WHERE id = ? AND agent_address = ?
        AND (running_since IS NULL OR running_since < DATE_SUB(NOW(), INTERVAL ${STALE_RUN_MINUTES} MINUTE))`,
    [Number(id), normalizeAddress(agentAddress)],
  )
  return result.affectedRows === 1 ? present(await readTask(agentAddress, id)) : null
}

/** Releases a claim and books the next scheduled run. */
export const finishTask = async (agentAddress, task) => {
  await pool.execute(
    `UPDATE agent_tasks SET running_since = NULL, last_run_at = NOW(), next_run_at = ${nextRunSql(task.schedule)} WHERE id = ? AND agent_address = ?`,
    [task.id, normalizeAddress(agentAddress)],
  )
}

/**
 * Runs one task as an agent turn. The task's title goes into the chat as the owner's side of the
 * turn, so the owner sees what ran and what came of it; drafts it makes wait for their approval.
 * A paused or broke agent skips the run but still books the next one, so a schedule never piles up.
 * @returns {Promise<{status: 'done'|'skipped'|'busy', reason?: string, proposals?: number, sessionId?: number}>}
 */
export const runTask = async (owner, agentAddress, id) => {
  const agent = await getAgent(owner, agentAddress)
  const task = await claimTask(agent.address, id)
  if (!task) return { status: 'busy' }

  try {
    try {
      assertCanRun(agent)
    } catch (error) {
      if (error instanceof AgentError) return { status: 'skipped', reason: error.message }
      throw error
    }

    let proposals = 0
    // Every run is a session of its own, so it never crowds the owner's chat and can be opened later
    const sessionId = await createSession(agent.address, { kind: 'task', taskId: task.id, title: task.title })
    await appendMessage(agent.address, 'user', `▶ Task: ${task.title}`, sessionId)
    await runAgentTurn({
      agent,
      owner,
      task,
      sessionId,
      send: (event) => {
        if (event.type === 'proposal') proposals += 1
      },
    })
    return { status: 'done', proposals, sessionId }
  } finally {
    await finishTask(agent.address, task)
  }
}

/** Scheduled tasks whose time has come, oldest first, on agents that are not paused. */
export const listDueTasks = async (limit = 10) => {
  const [rows] = await pool.execute(
    `SELECT t.id, t.agent_address, a.owner_address
       FROM agent_tasks t JOIN hosted_agents a ON a.agent_address = t.agent_address
      WHERE t.enabled = 1 AND t.schedule <> 'manual' AND t.next_run_at <= NOW() AND a.paused = 0
      ORDER BY t.next_run_at LIMIT ${Number(limit)}`,
  )
  return rows.map((row) => ({ id: Number(row.id), agentAddress: row.agent_address, owner: row.owner_address }))
}
