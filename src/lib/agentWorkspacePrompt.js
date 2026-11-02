/**
 * @file lib/agentWorkspacePrompt.js
 * @description The workspace files a hosted agent works from, for its system prompt. Kept apart
 * from lib/agentWorkspace.js so the runtime can read them without pulling in tasks, which run on
 * the runtime themselves. Server-only.
 */

import pool from '@/lib/db'
import { isSkillPath, STORED_PATHS } from '@/lib/agentWorkspaceFiles'

const PROMPT_BUDGET = 12_000

/**
 * Its owner's rules (AGENTS.md), what it knows about its owner (USER.md) and its skills, as one
 * block. Bounded, so a long skill cannot crowd out the conversation.
 * @returns {Promise<string>} Empty when the agent has none.
 */
export const workspaceForPrompt = async (agentAddress) => {
  const [rows] = await pool.execute('SELECT path, content FROM agent_files WHERE agent_address = ? ORDER BY path', [agentAddress])
  const ordered = [...rows.filter((row) => STORED_PATHS.has(row.path)), ...rows.filter((row) => isSkillPath(row.path))]

  let budget = PROMPT_BUDGET
  const sections = []
  for (const row of ordered) {
    const content = row.content.trim()
    if (!content || budget <= 0) continue
    const piece = content.slice(0, budget)
    budget -= piece.length
    sections.push(`--- ${row.path} ---\n${piece}`)
  }
  return sections.join('\n\n')
}
