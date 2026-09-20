/**
 * @file lib/chatText.js
 * @description Splits a chat line into text and link parts so URLs render as anchors. Only
 * http(s) links are recognised; a trailing bracket or punctuation stays outside the link.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi
const TRAILING = /[.,;:!?)\]}'"]+$/

/**
 * @param {string} text
 * @returns {Array<{type: 'text'|'link', value: string}>}
 */
export const splitChatText = (text) => {
  const parts = []
  let last = 0
  for (const match of String(text ?? '').matchAll(URL_PATTERN)) {
    const trimmed = match[0].replace(TRAILING, '')
    const start = match.index
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) })
    parts.push({ type: 'link', value: trimmed })
    last = start + trimmed.length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}
