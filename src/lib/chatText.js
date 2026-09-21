/**
 * @file lib/chatText.js
 * @description Splits a chat line into text, link and mention parts. Links are http(s) URLs with
 * a trailing bracket or punctuation left outside; mentions are the app's `[@Name](/0x…)` wire
 * format from lib/mentions.js, so a chat line and a post carry the same shape.
 */

import { MENTION_LINK_PATTERN } from '@/lib/mentions'

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi
const TRAILING = /[.,;:!?)\]}'"]+$/

/**
 * @param {string} text
 * @returns {Array<{type: 'text'|'link', value: string} | {type: 'mention', label: string, address: string, value: string}>}
 */
export const splitChatText = (text) => {
  const source = String(text ?? '')
  const parts = []
  let last = 0

  // Mentions first: a mention link contains a slash path that the URL pattern must never see
  const mentions = [...source.matchAll(MENTION_LINK_PATTERN)]
  const pushText = (segment) => {
    if (!segment) return
    let cursor = 0
    for (const match of segment.matchAll(URL_PATTERN)) {
      const trimmed = match[0].replace(TRAILING, '')
      if (match.index > cursor) parts.push({ type: 'text', value: segment.slice(cursor, match.index) })
      parts.push({ type: 'link', value: trimmed })
      cursor = match.index + trimmed.length
    }
    if (cursor < segment.length) parts.push({ type: 'text', value: segment.slice(cursor) })
  }

  for (const match of mentions) {
    pushText(source.slice(last, match.index))
    parts.push({ type: 'mention', label: match[1], address: match[2], value: match[0] })
    last = match.index + match[0].length
  }
  pushText(source.slice(last))
  return parts
}
