import { gatewayList } from '@/lib/ipfsGateways'
import { slugify } from '@/lib/utils'

/**
 * Long-form articles on Hup.
 *
 * An article is an ordinary post. The contract only ever sees the post's metadata CID (see the
 * upload in NewPost's handleCreatePost), so article length is not bounded by maxMetadataBytes —
 * but the indexer resolves that CID and stores the whole content JSON in `posts.content`, which
 * the feed API returns verbatim on every page. Putting a 10,000-word body there would ship the
 * essay with every timeline response that happens to include the post.
 *
 * So the body lives in its own IPFS object and the post carries only the card:
 *
 *   content.article = { title, subtitle, cover, excerpt, tags, bodyCid, wordCount, ... }
 *
 * That is the same shape as every other attachment in the payload (nftDrop, poll, predictMarket
 * …): a reference the renderer resolves, never the resolved thing. It keeps the feed payload and
 * the indexed row the size they are today, which is why articles need no cidex change at all.
 */

export const ARTICLE_VERSION = '1'

/* A title has to fit a card, an <h1>, an OG image and a <title> tag. Past this it is a subtitle. */
export const MAX_ARTICLE_TITLE = 140
export const MAX_ARTICLE_SUBTITLE = 280
/* Roughly 150k words. The body is JSON-POSTed to /api/ipfs/object, which runs as a serverless
   function under a 4.5MB request cap — this leaves that ceiling a wide berth while being far
   more than anyone writes in one sitting. */
export const MAX_ARTICLE_BODY_BYTES = 1_000_000
export const MAX_ARTICLE_TAGS = 5

/* Average adult prose speed. Only ever shown rounded to a minute, so precision past this is noise. */
const WORDS_PER_MINUTE = 200

const readTimeFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })

/* Scripts that do not put spaces between words, so whitespace tokenizing undercounts them badly
   — CJK ideographs, kana, and hangul are each counted as their own word. */
const UNSPACED_SCRIPTS = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu

/**
 * Word count that does not collapse to nonsense outside Latin scripts.
 * @param {string} markdown
 * @returns {number}
 */
export function countWords(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  const unspaced = text.match(UNSPACED_SCRIPTS)?.length || 0
  const spaced = text
    .replace(UNSPACED_SCRIPTS, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

  return unspaced + spaced
}

/**
 * Reading time in whole minutes, never zero — a two-line article still says "1 min read".
 * @param {number} wordCount
 * @returns {number}
 */
export function readingMinutes(wordCount) {
  return Math.max(1, Math.round((Number(wordCount) || 0) / WORDS_PER_MINUTE))
}

/**
 * The label the card and the reader both show.
 * @param {number} wordCount
 * @returns {string}
 */
export function readingTimeLabel(wordCount) {
  return `${readTimeFormat.format(readingMinutes(wordCount))} min read`
}

/* Enough markdown to get readable plain text for an excerpt and an OG description. This is not a
   parser and does not need to be — anything it misses degrades to a stray character in a preview,
   never to broken output, because the reader renders the original through renderMarkdown. */
function stripMarkdown(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')            // fenced code
    .replace(/`[^`]*`/g, ' ')                   // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')      // images, caption and all
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links keep their text
    .replace(/^\s{0,3}>+\s?/gm, '')             // blockquote markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')         // heading hashes
    .replace(/^\s{0,3}[-*+]\s+/gm, '')          // bullet markers
    .replace(/^\s{0,3}\d+\.\s+/gm, '')          // ordered markers
    .replace(/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/gm, ' ') // thematic breaks
    .replace(/[*_~]/g, '')                      // emphasis
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * First readable prose of an article, for the feed card and the meta description.
 * @param {string} markdown
 * @param {number} [max] Characters before the ellipsis.
 * @returns {string}
 */
export function excerptFrom(markdown, max = 200) {
  const text = stripMarkdown(markdown)
  if (text.length <= max) return text

  /* Cut on a word boundary so the preview never ends mid-word. If the first `max` characters
     hold no space at all (unspaced scripts again), the hard cut is the honest answer. */
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * The slug half of an article URL. Decorative — see articlePath.
 *
 * Titles here are frequently non-Latin, which is the whole reason slugify preserves Unicode and
 * ZWNJ rather than ASCII-folding. A title made only of punctuation or emoji leaves nothing behind
 * and the path still needs a slug half, so it falls back to a constant.
 *
 * @param {string} title
 * @returns {string} A slug, or 'article' when the title has nothing sluggable in it.
 */
export function articleSlug(title) {
  return slugify(title) || 'article'
}

/**
 * Canonical path for an article. The slug is decorative and the trailing post id is the only part
 * that resolves — post ids are per-network on Hup, so the network is part of the address too.
 * @param {string|number} networkId
 * @param {string|number} postId
 * @param {string} [title]
 * @returns {string}
 */
export function articlePath(networkId, postId, title) {
  return `/articles/${networkId}/${articleSlug(title)}-${postId}`
}

/**
 * Pull the post id back out of a `[slug]` segment. Titles can themselves contain digits and
 * hyphens, so only the final hyphen-delimited run of digits counts.
 * @param {string} segment
 * @returns {string|null}
 */
export function postIdFromSlug(segment) {
  const match = /-(\d+)$/.exec(String(segment || ''))
  return match ? match[1] : null
}

/**
 * The separately-pinned body object. Kept deliberately dull: a version, a marker so a stray CID
 * can be told apart from a post payload, and the markdown itself.
 * @param {string} markdown
 * @returns {{version: string, kind: string, markdown: string}}
 */
export function makeArticleBody(markdown) {
  return {
    version: ARTICLE_VERSION,
    kind: 'article-body',
    markdown: String(markdown || ''),
  }
}

/**
 * The reference that rides inside the post's content JSON. Everything here is what a card needs
 * to render without fetching the body.
 *
 * @param {Object} article
 * @param {string} article.title
 * @param {string} [article.subtitle]
 * @param {string} [article.cover] IPFS cid of the cover image.
 * @param {string[]} [article.tags]
 * @param {string} article.bodyCid Where the markdown lives.
 * @param {string} article.markdown Used only to derive the excerpt and word count; never stored.
 * @returns {Object}
 */
export function makeArticleRef({ title, subtitle, cover, tags, bodyCid, markdown }) {
  const wordCount = countWords(markdown)

  return {
    version: ARTICLE_VERSION,
    title: String(title || '').trim().slice(0, MAX_ARTICLE_TITLE),
    ...(subtitle ? { subtitle: String(subtitle).trim().slice(0, MAX_ARTICLE_SUBTITLE) } : {}),
    ...(cover ? { cover } : {}),
    ...(tags?.length ? { tags: tags.slice(0, MAX_ARTICLE_TAGS) } : {}),
    bodyCid,
    excerpt: excerptFrom(markdown),
    wordCount,
  }
}

/**
 * Whether a post's content payload is an article.
 * @param {Object} content Parsed post content.
 * @returns {boolean}
 */
export function isArticle(content) {
  return Boolean(content?.article?.bodyCid && content?.article?.title)
}

/* A gateway that has the block answers fast; one that does not can hang until the socket dies.
   The reader is server-rendered, so this budget is a visitor waiting on a blank page. */
const BODY_FETCH_TIMEOUT_MS = 8000

/**
 * Read an article body from IPFS, walking the same gateway chain the media proxy uses.
 *
 * Server-side only — it talks to gateways directly, which is exactly why it can: there is no CORS
 * to negotiate and no proxy hop to pay. Returns null rather than throwing, so a body that cannot
 * be resolved renders as an unavailable article instead of a 500 on the whole page.
 *
 * @param {string} bodyCid An `ipfs://` uri or a bare CID.
 * @returns {Promise<string|null>} The markdown, or null if no gateway could serve it.
 */
export async function fetchArticleBody(bodyCid) {
  const cid = String(bodyCid || '').replace(/^ipfs:\/\//, '').trim()
  if (!cid) return null

  for (const gateway of gatewayList()) {
    try {
      const res = await fetch(`${gateway}${cid}`, {
        signal: AbortSignal.timeout(BODY_FETCH_TIMEOUT_MS),
        /* The body at a CID is immutable, so this is safe to hold for a long time. Articles are
           edited by publishing a new body and rewriting the post's metadata CID — which produces
           a different cid here, not a changed one. */
        next: { revalidate: 31536000 },
      })
      if (!res.ok) continue

      const payload = await res.json()
      if (typeof payload?.markdown === 'string') return payload.markdown
    } catch {
      /* Timeout, socket error, or a gateway that answered with an HTML error page — try the next */
    }
  }

  console.warn(`[article] no gateway could serve body ${cid}`)
  return null
}
