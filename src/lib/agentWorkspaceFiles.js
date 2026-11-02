/**
 * @file lib/agentWorkspaceFiles.js
 * @description The shape of a hosted agent's workspace, shared by server and browser. It follows
 * OpenClaw's layout so an agent and its skills stay portable:
 *
 *   SOUL.md                 who the agent is — its persona
 *   MEMORY.md               its own notes (read_memory / save_memory)
 *   AGENTS.md               how it should work: standing rules from its owner
 *   USER.md                 what it should know about its owner
 *   TASKS.json              its tasks, drawn from the task list (read-only here)
 *   skills/<name>/SKILL.md  one skill each
 *
 * Credentials never belong here: snapshots are written onchain, where nothing can be deleted.
 */

export const WORKSPACE_FORMAT = 'hup-agent-workspace'
export const WORKSPACE_VERSION = 1

export const FILE_MAX_CHARS = 20_000
export const SKILL_LIMIT = 12

/** The files every workspace has, in display order, and what each is for. */
export const CORE_FILES = Object.freeze([
  { path: 'SOUL.md', label: 'Personality and purpose', editable: true },
  { path: 'MEMORY.md', label: 'Its own notes', editable: true },
  { path: 'AGENTS.md', label: 'How it should work', editable: true },
  { path: 'USER.md', label: 'About you', editable: true },
  { path: 'TASKS.json', label: 'Its tasks (edit them in Tasks)', editable: false },
])

const SKILL_PATH_RE = /^skills\/([a-z0-9][a-z0-9-]{0,39})\/SKILL\.md$/

/** Files kept in the workspace table — everything but the persona, memory and tasks, which have homes of their own. */
export const STORED_PATHS = new Set(['AGENTS.md', 'USER.md'])

export const isSkillPath = (path) => SKILL_PATH_RE.test(String(path))

/** Whether a path may be written by the owner (or restored from a snapshot). */
export const isWritablePath = (path) => ['SOUL.md', 'MEMORY.md'].includes(path) || STORED_PATHS.has(path) || isSkillPath(path)

/** "LUKSO news" → "lukso-news": the folder name a skill gets. */
export const skillSlug = (name) =>
  String(name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

export const skillPath = (name) => `skills/${skillSlug(name)}/SKILL.md`

/** A new skill's starting text, in the frontmatter shape OpenClaw and ClawHub read. */
export const skillTemplate = (name) => `---
name: ${skillSlug(name)}
description: When to use this skill, in one sentence.
---

# ${String(name).trim()}

Step-by-step instructions for the agent.
`
