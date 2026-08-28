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

// The tags that ARE a declaration, normalized, each mapped to the word the chip wears. The chip
// repeats the claim back rather than flattening every tag into one label: a wallet that tagged
// itself `ai` is saying something smaller than one that tagged itself `ai-agent`, and a chip
// reading "AI" beside a builder's name is their own word, where "Automated" would be our verdict
// on them.
const AGENT_TAGS = new Map([
  ['agent', 'AI Agent'],
  ['aiagent', 'AI Agent'],
  ['autonomousagent', 'AI Agent'],
  ['ai', 'AI'],
  ['automated', 'Automated'],
  ['automatedaccount', 'Automated'],
  ['autonomous', 'Automated'],
  ['bot', 'Automated'],
  ['botaccount', 'Automated'],
  ['chatbot', 'Automated'],
])

// Most specific first. Tag lists overlap — the profile that started this carries `Agent`,
// `ai-agent` AND `AI` — so the chip has to settle on one, and the most particular claim is the one
// worth showing.
const LABEL_PRECEDENCE = ['AI Agent', 'Automated', 'AI']

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
 * The label one tag declares, or null. The plural is checked as a second lookup rather than by
 * stripping a trailing `s` upfront — that would maul `autonomous` into a word matching nothing.
 */
const labelForTag = (tag) => {
  const normalized = normalizeTag(tag)
  if (!normalized) return null

  if (AGENT_TAGS.has(normalized)) return AGENT_TAGS.get(normalized)
  if (normalized.endsWith('s')) return AGENT_TAGS.get(normalized.slice(0, -1)) ?? null

  return null
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
 * The mark a profile has claimed for itself, or null.
 *
 * @param {Object|null} profile - a profile payload from either branch of the profile route.
 * @returns {{ label: 'AI Agent'|'AI'|'Automated', source: 'tag'|'description' }|null} `source`
 *   records how the claim was made, so a moderation view can tell a tagged account from one that
 *   only says it in prose.
 */
export function resolveAgentProfile(profile) {
  if (!profile) return null

  const claimed = new Set(parseTags(profile.tags).map(labelForTag).filter(Boolean))
  const label = LABEL_PRECEDENCE.find((candidate) => claimed.has(candidate))
  if (label) {
    return { label, source: 'tag' }
  }

  if (typeof profile.description === 'string' && DECLARED_IN_DESCRIPTION.test(profile.description)) {
    return { label: 'Automated', source: 'description' }
  }

  return null
}
