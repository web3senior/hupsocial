/**
 * @file lib/postSummary.js
 * @description Turns a post row into the short strings its link preview needs — the title
 * and description tags on the page, and the headline on the generated card.
 *
 * Shared because the two have to agree: a crawler that renders a headline shows the tag while
 * the card shows the drawing, and the pair reading differently is how a preview starts looking
 * machine-made. Both live here so there is one place to change the wording.
 */

import { marked } from 'marked'

const BLOCK_TOKENS = new Set(['paragraph', 'heading', 'blockquote', 'code', 'list_item', 'space', 'br'])

const sameStyle = (a, b) => Boolean(a.bold) === Boolean(b.bold) && Boolean(a.italic) === Boolean(b.italic) && Boolean(a.strike) === Boolean(b.strike)

/**
 * A post body as runs of plain text carrying the emphasis the feed would draw them with.
 * Lexed by the same parser the feed renders through, so both agree on what counts as markup.
 *
 * @param {string} markdown
 * @returns {Array<{text: string, bold?: boolean, italic?: boolean, strike?: boolean}>}
 */
export const toRuns = (markdown) => {
  const source = typeof markdown === 'string' ? markdown.trim() : ''
  if (!source) return []

  const runs = []
  const push = (text, style) => {
    if (!text) return
    const last = runs.at(-1)
    if (last && sameStyle(last, style)) last.text += text
    else runs.push({ ...style, text })
  }

  const walk = (tokens, style) => {
    for (const token of tokens || []) {
      if (token.type === 'strong') walk(token.tokens, { ...style, bold: true })
      else if (token.type === 'em') walk(token.tokens, { ...style, italic: true })
      else if (token.type === 'del') walk(token.tokens, { ...style, strike: true })
      else if (token.type === 'heading') walk(token.tokens, { ...style, bold: true })
      else if (token.type === 'list') {
        token.items.forEach((item, index) => {
          push(token.ordered ? `${Number(token.start || 1) + index}. ` : '• ', style)
          walk([item], style)
        })
      } else if (token.type === 'table') {
        ;[token.header, ...token.rows].flat().forEach((cell) => {
          walk(cell.tokens, style)
          push(' ', style)
        })
      } else if (token.type === 'html' || token.type === 'image' || token.type === 'hr') continue
      else if (token.tokens?.length) walk(token.tokens, style)
      else if (token.type !== 'space' && token.type !== 'br') push(token.text || '', style)

      if (BLOCK_TOKENS.has(token.type)) push(' ', style)
    }
  }

  try {
    walk(marked.lexer(source, { gfm: true, breaks: true }), {})
  } catch {
    return [{ text: source.replace(/\s+/g, ' ') }]
  }

  /* Whitespace is collapsed across run boundaries, not just inside each run */
  const collapsed = []
  for (const run of runs) {
    let text = run.text.replace(/\s+/g, ' ')
    const previous = collapsed.at(-1)
    if (!previous || previous.text.endsWith(' ')) text = text.trimStart()
    if (text) collapsed.push({ ...run, text })
  }

  const last = collapsed.at(-1)
  if (last) last.text = last.text.trimEnd()
  if (last && !last.text) collapsed.pop()

  return collapsed
}

/**
 * Cuts to a word boundary. A bare slice ends mid-word ("swipe for the next, an"), which reads
 * as a broken card on every surface that still renders a headline.
 *
 * The 0.6 floor keeps the cut from eating most of the line when a single long token — a URL,
 * a contract address — happens to straddle the limit; below that it is better to split the
 * token than to return almost nothing.
 *
 * @param {string} text - Raw post markdown.
 * @param {number} max - Maximum length of the result, ellipsis included.
 * @returns {Array<{text: string, bold?: boolean, italic?: boolean, strike?: boolean}>}
 */
export const truncateToRuns = (text, max) => {
  const runs = toRuns(text)
  const clean = runs.map((run) => run.text).join('')
  if (clean.length <= max) return runs

  const cut = clean.slice(0, max - 1)
  const boundary = cut.lastIndexOf(' ')
  let budget = (boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd().length

  const kept = []
  for (const run of runs) {
    if (budget <= 0) break
    kept.push({ ...run, text: run.text.slice(0, budget) })
    budget -= run.text.length
  }

  kept[kept.length - 1].text += '…'
  return kept
}

/**
 * truncateToRuns as one plain string, for the surfaces that cannot draw emphasis.
 * @param {string} text - Raw post markdown.
 * @param {number} max
 * @returns {string}
 */
export const truncate = (text, max) =>
  truncateToRuns(text, max)
    .map((run) => run.text)
    .join('')

/**
 * What a post did, for the posts that carry no words of their own. An NFT listing or a bare
 * photo used to fall all the way through to "Post Details" and the site boilerplate, which
 * made a shared post indistinguishable from a shared home page.
 *
 * Returned as a lowercase verb phrase so a caller can put a name in front of it or capitalize
 * it on its own.
 *
 * @param {Object} post - The post row from the API.
 * @returns {string} e.g. "listed an NFT for sale", "posted 3 photos".
 */
export const summarizePostContent = (post) => {
  const items = post?.content?.elements?.find((element) => element?.type === 'media')?.data?.items || []

  if (post?.nft_listing_id) return 'listed an NFT for sale'
  if (items.some((item) => item?.type === 'video')) return 'posted a video'
  if (items.some((item) => item?.type === 'audio')) return 'posted audio'
  if (items.length === 1) return 'posted a photo'
  if (items.length > 1) return `posted ${items.length} photos`
  return 'posted'
}

/**
 * The post's own words, or a description of it when it has none.
 * @param {Object} post - The post row from the API.
 * @param {number} max - Maximum length of the result.
 * @returns {string}
 */
export const summarizePost = (post, max) => {
  const bodyText = post?.content?.elements?.find((element) => element?.type === 'text')?.data?.text || ''
  const summary = truncate(bodyText, max)
  if (summary) return summary

  const author = post?.display_name || 'Someone'
  return `${author} ${summarizePostContent(post)} on Hup`
}
