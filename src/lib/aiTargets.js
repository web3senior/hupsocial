/**
 * "Summarize with AI" deep links.
 *
 * Every assistant here accepts a prefilled prompt through a query parameter, so the entry
 * points are plain links — no SDKs, no keys, nothing to proxy.
 */
import { postToMarkdown, getPostPermalink, getPostMarkdownUrl } from './postMarkdown'

// Assistants differ on how much they will accept in a URL, and a truncated prompt is worse
// than a short one plus a fetchable link — so the inline copy is capped and the full document
// is always one hop away at the /markdown route.
const MAX_INLINE_MARKDOWN = 2000

// `short` is the fallback mark shown when the logo file is missing — two letters, because all
// four assistants would otherwise collapse into two initials (C, C, G, G).
//
// `ink` says how the mark survives a dark panel. `mono` marks are solid black and disappear
// into one, so the menu inverts them there; `color` marks carry their own contrast and must be
// left alone — inverting Claude's orange or Gemini's blue would just make them wrong.
export const AI_TARGETS = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    short: 'Ch',
    logo: '/logos/openai.svg',
    ink: 'mono',
    buildUrl: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: 'claude',
    label: 'Claude',
    short: 'Cl',
    logo: '/logos/claude.svg',
    ink: 'color',
    buildUrl: (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: 'grok',
    label: 'Grok',
    short: 'Gr',
    logo: '/logos/grok.svg',
    ink: 'mono',
    buildUrl: (prompt) => `https://grok.com/?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    short: 'Ge',
    logo: '/logos/gemini.svg',
    ink: 'color',
    // Routed through Google's AI Mode (`udm=50`) rather than gemini.google.com/app, which
    // ignores `?q=` and just lands on an empty composer.
    buildUrl: (prompt) => `https://www.google.com/search?udm=50&aep=11&q=${encodeURIComponent(prompt)}`,
    // …and this one gets links instead of the inline markdown. `q` here is a *search* query,
    // not a chat composer: a couple of thousand characters of markdown syntax is well outside
    // what AI Mode is known to take, and Google drops an over-long query rather than trimming
    // it. The cost is that Gemini alone needs the post to be publicly reachable to answer.
    promptMode: 'link',
  },
]

/**
 * Build the prompt handed to an assistant for a post.
 *
 * The post markdown travels inline rather than as a bare link: assistants without browsing
 * (and every localhost or private deployment) can still answer, and the ones that can browse
 * get the permalink and the plain-markdown URL to pull the rest.
 *
 * @param {Object} item Post row.
 * @param {Object} [options]
 * @param {string} [options.origin] Absolute origin used for links inside the prompt.
 * @param {boolean} [options.linkOnly] Send just the links, for targets that can't carry the
 * markdown in a URL. Costs the offline case — the assistant has to fetch to answer at all.
 * @returns {string} The prompt text.
 */
export function buildPostAiPrompt(item, { origin = '', linkOnly = false } = {}) {
  const permalink = getPostPermalink(item, origin)
  const markdownUrl = getPostMarkdownUrl(item, origin)

  if (linkOnly) {
    return `Summarize and analyze the key insights from this Hup Social post: ${permalink} (plain markdown at ${markdownUrl})`
  }

  const markdown = postToMarkdown(item, { origin })
  const inline =
    markdown.length > MAX_INLINE_MARKDOWN
      ? `${markdown.slice(0, MAX_INLINE_MARKDOWN).trimEnd()}\n\n…(truncated)`
      : markdown

  return [
    'Summarize this post from Hup Social and explain what it is about.',
    '',
    '---',
    '',
    inline.trimEnd(),
    '',
    '---',
    '',
    `Source: ${permalink}`,
    `Full markdown: ${markdownUrl}`,
  ].join('\n')
}

/**
 * Resolve the URL for one assistant entry, in whichever prompt form that target takes.
 *
 * @param {Object} target An entry from AI_TARGETS.
 * @param {Object} item Post row.
 * @param {Object} [options]
 * @param {string} [options.origin] Absolute origin used for links inside the prompt.
 * @returns {string} The URL to open.
 */
export function buildPostAiUrl(target, item, { origin = '' } = {}) {
  return target.buildUrl(buildPostAiPrompt(item, { origin, linkOnly: target.promptMode === 'link' }))
}
