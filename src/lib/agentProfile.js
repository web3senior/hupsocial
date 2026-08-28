/**
 * @file lib/agentProfile.js
 * @description The "Automated" mark — X's robot glyph beside a display name, resolved from what a
 * profile says about itself.
 *
 * This is a DECLARATION, never an inference. The verdict comes only from metadata the wallet
 * writes itself — the LSP3 `tags` list, and failing that the description — so wearing the mark is
 * the account's own claim, and dropping it is one metadata edit away.
 *
 * Nothing here looks at behaviour, and that is deliberate. Posting cadence, relayer submission and
 * session keys all describe how a transaction reached the chain, and on Hup a large share of that
 * traffic is machine-submitted on behalf of a person: a Universal Profile posting through the
 * gasless relayer (api/v1/relay) or a burner session key is not a bot. Inferring from those
 * signals would stamp a label a pseudonymous profile cannot argue with, off a heuristic — so the
 * cadence work stays a moderation-side score and never reaches this mark.
 *
 * Resolved server-side beside the community badge (lib/badge.js) for the same reason that one is:
 * a single rule in a single place, so the feed, the hover card and the profile page can never
 * disagree about who is automated.
 */

// The tags that ARE a declaration, normalized. Deliberately narrow: a bare `ai` is not one — it is
// worn by builders describing what they work on, and matching it would pin the robot on a human
// founder whose only crime is a tag list that mentions the field.
const AGENT_TAGS = new Set([
  'agent',
  'aiagent',
  'automated',
  'automatedaccount',
  'autonomous',
  'autonomousagent',
  'bot',
  'botaccount',
  'chatbot',
])

// The description only speaks when it says so outright. Loose readings ("AI-powered", "powered by
// Claude") describe tools a human uses as often as they describe the account itself.
const DECLARED_IN_DESCRIPTION = /\b(ai[\s\-_]?agent|autonomous agent|automated account|bot account|i am a bot|this account is automated)\b/i

/** Strips a tag down to letters and digits so `AI-Agent`, `ai_agent` and `AI Agent` are one word. */
const normalizeTag = (tag) =>
  String(tag ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')

/**
 * True when one tag is a declaration. The plural is checked as a second lookup rather than by
 * stripping a trailing `s` upfront — that would maul `autonomous` into a word matching nothing.
 */
const isAgentTag = (tag) => {
  const normalized = normalizeTag(tag)
  if (!normalized) return false

  return AGENT_TAGS.has(normalized) || (normalized.endsWith('s') && AGENT_TAGS.has(normalized.slice(0, -1)))
}

/**
 * The tag list, from either shape the profile endpoint hands back: an array on the Universal
 * Profile branch (straight off the Envio payload) and a JSON string on the database branch, where
 * it is a longtext column. A value that is neither parses as a bare comma list rather than
 * throwing — hand-edited rows predate the JSON encoding.
 */
const parseTags = (tags) => {
  if (Array.isArray(tags)) return tags
  if (typeof tags !== 'string' || tags.trim() === '') return []

  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return tags.split(',')
  }
}

/**
 * The automated mark a profile has claimed for itself, or null.
 *
 * @param {Object|null} profile - a profile payload from either branch of the profile route.
 * @returns {{ label: string, source: 'tag'|'description' }|null} `source` records how the claim was
 *   made, so a moderation view can tell a tagged account from one that only says it in prose.
 */
export function resolveAgentProfile(profile) {
  if (!profile) return null

  if (parseTags(profile.tags).some(isAgentTag)) {
    return { label: 'Automated', source: 'tag' }
  }

  if (typeof profile.description === 'string' && DECLARED_IN_DESCRIPTION.test(profile.description)) {
    return { label: 'Automated', source: 'description' }
  }

  return null
}
