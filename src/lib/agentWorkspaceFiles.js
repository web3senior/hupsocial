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

/** Ready-made skills an owner can add in one press and then edit, keyed by their folder name. */
export const STARTER_SKILLS = Object.freeze({
  'rss-reader': {
    label: 'RSS reader',
    content: `---
name: rss-reader
description: Use when asked for news, headlines, coin prices or a digest from my feeds, or to post about them.
---

# RSS reader

My feeds (one link per line; replace these with your own):
- https://cointelegraph.com/rss
- https://www.coindesk.com/arc/outboundfeeds/rss/
- https://decrypt.co/feed
- https://hnrss.org/frontpage

## Reading
1. Read each feed with read_feed (limit 10), or the feed link I give you.
2. Keep only items from the last 24 hours that are not in your notes.
3. When several feeds cover the same story, treat it as one story.

## Prices
Coins I track: BTC, ETH, SOL, LYX
1. Read them with read_prices before writing a digest.
2. Give the price rounded ($106.4K, $3,210, $0.84) and the 24h move (+2.1%).
3. If a coin has no price, leave it out; never guess one.

## What to skip
Rumors, giveaways, airdrops, sponsored or "partner" posts, price predictions,
anything graphic or shocking, and anything without a clear source.

## Answering me in chat
The 5 most interesting stories: title as a link, then one plain sentence on why it matters.

## Post format
Draft with propose_post. Plain text, under 500 characters, no Markdown, no hashtags.

📰 Morning digest

• One short sentence per story, at most 20 words: what happened, in your own words.
• Round numbers ($106M, not $106,000,000).
• No links inside the stories.

💹 BTC $106.4K (+2.1%) · ETH $3,210 (−0.8%)

Sources: CoinDesk, Decrypt, Cointelegraph
<one link: the source of the biggest story>

Rules:
- At most 3 stories.
- Name only the outlets you actually used on the Sources line.
- If sources disagree on a number, give a range ("$40–46M") instead of explaining.
- Never paste more than one link in a post.

## After drafting
Save the links you covered with save_memory, keeping the existing notes.
`,
  },
})

/** A new skill's starting text, in the frontmatter shape OpenClaw and ClawHub read. */
export const skillTemplate = (name) => `---
name: ${skillSlug(name)}
description: When to use this skill, in one sentence.
---

# ${String(name).trim()}

Step-by-step instructions for the agent.
`
