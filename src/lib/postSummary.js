/**
 * @file lib/postSummary.js
 * @description Turns a post row into the short strings its link preview needs — the title
 * and description tags on the page, and the headline on the generated card.
 *
 * Shared because the two have to agree: a crawler that renders a headline shows the tag while
 * the card shows the drawing, and the pair reading differently is how a preview starts looking
 * machine-made. Both live here so there is one place to change the wording.
 */

/**
 * Cuts to a word boundary. A bare slice ends mid-word ("swipe for the next, an"), which reads
 * as a broken card on every surface that still renders a headline.
 *
 * The 0.6 floor keeps the cut from eating most of the line when a single long token — a URL,
 * a contract address — happens to straddle the limit; below that it is better to split the
 * token than to return almost nothing.
 *
 * @param {string} text - Raw post text; whitespace is collapsed first.
 * @param {number} max - Maximum length of the result, ellipsis included.
 * @returns {string}
 */
export const truncate = (text, max) => {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean

  const cut = clean.slice(0, max - 1)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`
}

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
