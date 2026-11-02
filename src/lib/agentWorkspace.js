/**
 * @file lib/agentWorkspace.js
 * @description A hosted agent's workspace (layout in lib/agentWorkspaceFiles.js): the working copy
 * Hup keeps, and the snapshot history. Server-only. Snapshots are encrypted and written onchain in
 * the owner's browser; this file only ever sees the plaintext working copy and the snapshot IDs.
 */

import pool from '@/lib/db'
import { AgentError, getAgent, MEMORY_MAX, setMemory, updateAgent } from '@/lib/hostedAgents'
import { AGENT_PERSONA_MAX } from '@/lib/hostedAgentMessages'
import { createTask, deleteTask, listTasks } from '@/lib/agentTasks'
import { CORE_FILES, FILE_MAX_CHARS, isSkillPath, isWritablePath, SKILL_LIMIT, STORED_PATHS } from '@/lib/agentWorkspaceFiles'

const SNAPSHOT_HISTORY = 20
const FILE_ID_RE = /^0x[0-9a-fA-F]{64}$/
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

const tasksJson = (tasks) =>
  JSON.stringify(
    tasks.map(({ title, instructions, schedule, enabled }) => ({ title, instructions, schedule, enabled })),
    null,
    2,
  )

const readStoredFiles = async (agentAddress) => {
  const [rows] = await pool.execute('SELECT path, content FROM agent_files WHERE agent_address = ? ORDER BY path', [agentAddress])
  return rows
}

/**
 * Every file in the workspace, core files first, then skills.
 * @returns {Promise<{files: {path: string, content: string, editable: boolean}[], snapshots: object[]}>}
 */
export const readWorkspace = async (owner, agentAddress) => {
  const agent = await getAgent(owner, agentAddress)
  const [stored, tasks, snapshots] = await Promise.all([readStoredFiles(agent.address), listTasks(owner, agent.address), listSnapshots(agent.address)])
  const byPath = new Map(stored.map((row) => [row.path, row.content]))

  const contentFor = { 'SOUL.md': agent.persona, 'MEMORY.md': agent.memory, 'TASKS.json': tasksJson(tasks) }
  const core = CORE_FILES.map(({ path, editable }) => ({ path, editable, content: contentFor[path] ?? byPath.get(path) ?? '' }))
  const skills = stored.filter((row) => isSkillPath(row.path)).map((row) => ({ path: row.path, editable: true, content: row.content }))

  return { files: [...core, ...skills], snapshots }
}

/** Writes one file of the working copy. SOUL.md and MEMORY.md land in the agent's own columns. */
export const writeWorkspaceFile = async (owner, agentAddress, path, content) => {
  if (!isWritablePath(path)) throw new AgentError(400, 'That file cannot be written')
  if (typeof content !== 'string' || content.length > FILE_MAX_CHARS) throw new AgentError(400, `A file holds at most ${FILE_MAX_CHARS.toLocaleString('en')} characters`)
  const agent = await getAgent(owner, agentAddress)

  if (path === 'SOUL.md') {
    if (!content.trim() || content.length > AGENT_PERSONA_MAX) throw new AgentError(400, `SOUL.md needs text, at most ${AGENT_PERSONA_MAX} characters`)
    await updateAgent(owner, agent.address, { persona: content })
    return
  }
  if (path === 'MEMORY.md') {
    if (content.length > MEMORY_MAX) throw new AgentError(400, `MEMORY.md holds at most ${MEMORY_MAX} characters`)
    await setMemory(agent.address, content)
    return
  }

  if (isSkillPath(path)) {
    const [[{ count }]] = await pool.execute("SELECT COUNT(*) AS count FROM agent_files WHERE agent_address = ? AND path LIKE 'skills/%' AND path <> ?", [agent.address, path])
    if (Number(count) >= SKILL_LIMIT) throw new AgentError(409, `An agent can have ${SKILL_LIMIT} skills`)
  }
  await pool.execute('INSERT INTO agent_files (agent_address, path, content) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE content = VALUES(content)', [agent.address, path, content])
}

/** Removes a skill. Core files are emptied by writing them, never removed. */
export const deleteWorkspaceFile = async (owner, agentAddress, path) => {
  if (!isSkillPath(path)) throw new AgentError(400, 'Only skills can be removed')
  const agent = await getAgent(owner, agentAddress)
  await pool.execute('DELETE FROM agent_files WHERE agent_address = ? AND path = ?', [agent.address, path])
}

/**
 * Replaces the working copy with a snapshot's files, decrypted in the owner's browser: persona,
 * memory, rules, owner notes and skills, and the tasks in TASKS.json. Anything else in the
 * snapshot is ignored.
 */
export const restoreWorkspace = async (owner, agentAddress, files) => {
  if (!files || typeof files !== 'object') throw new AgentError(400, 'That snapshot has no files')
  const agent = await getAgent(owner, agentAddress)
  const entries = Object.entries(files).filter(([path, content]) => typeof content === 'string' && (isWritablePath(path) || path === 'TASKS.json'))

  // Skills are replaced as a set, so a skill removed since the snapshot is removed again
  await pool.execute("DELETE FROM agent_files WHERE agent_address = ? AND path LIKE 'skills/%'", [agent.address])
  for (const [path, content] of entries) {
    if (path === 'TASKS.json') continue
    if (STORED_PATHS.has(path) || isSkillPath(path) || path === 'SOUL.md' || path === 'MEMORY.md') {
      await writeWorkspaceFile(owner, agent.address, path, content)
    }
  }

  const tasksFile = entries.find(([path]) => path === 'TASKS.json')?.[1]
  if (tasksFile) {
    let tasks = []
    try {
      tasks = JSON.parse(tasksFile)
    } catch {
      tasks = []
    }
    if (Array.isArray(tasks)) {
      for (const existing of await listTasks(owner, agent.address)) await deleteTask(owner, agent.address, existing.id)
      for (const task of tasks.slice(0, 10)) {
        const created = await createTask(owner, agent.address, task).catch(() => null)
        // A task that was switched off in the snapshot comes back off
        if (created && task.enabled === false) await pool.execute('UPDATE agent_tasks SET enabled = 0 WHERE id = ?', [created.id])
      }
    }
  }
}

// --- Snapshots ---

export const listSnapshots = async (agentAddress) => {
  const [rows] = await pool.execute(
    `SELECT chain_id, file_id, tx_hash, size, created_at FROM agent_snapshots WHERE agent_address = ? ORDER BY id DESC LIMIT ${SNAPSHOT_HISTORY}`,
    [agentAddress],
  )
  return rows.map((row) => ({ chainId: Number(row.chain_id), fileId: row.file_id, txHash: row.tx_hash, size: Number(row.size), createdAt: new Date(row.created_at).toISOString() }))
}

/** Notes a snapshot the browser just wrote. The chain stays the record; this only speeds up the history. */
export const recordSnapshot = async (owner, agentAddress, { chainId, fileId, txHash, size }) => {
  const agent = await getAgent(owner, agentAddress)
  if (!Number.isInteger(chainId) || !FILE_ID_RE.test(String(fileId)) || (txHash && !TX_HASH_RE.test(txHash)) || !Number.isInteger(size)) {
    throw new AgentError(400, 'Invalid snapshot')
  }
  await pool.execute('INSERT IGNORE INTO agent_snapshots (agent_address, chain_id, file_id, tx_hash, size) VALUES (?, ?, ?, ?, ?)', [
    agent.address,
    chainId,
    fileId.toLowerCase(),
    txHash ?? null,
    size,
  ])
}
