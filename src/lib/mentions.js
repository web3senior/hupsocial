/**
 * @file lib/mentions.js
 * @description The one wire format for @mentions: `[@Name](/0xAddress)`.
 *
 * Names are self-chosen and never unique, so the address travels with the mention. A plain
 * markdown link also keeps the mention a working profile link on every renderer that predates it.
 * cidex parses the same shape to notify the people mentioned — change both together.
 */

import { getAddress } from 'viem'

export const MAX_MENTION_NAME_LENGTH = 48

// Matches a whole mention link; group 1 is the label, group 2 the address
export const MENTION_LINK_PATTERN = /\[@([^\]\n]{1,48})\]\(\/(0x[0-9a-fA-F]{40})\)/g

export const MENTION_HREF_PATTERN = /^\/0x[0-9a-fA-F]{40}$/

/** Characters that would break the link syntax are dropped from the label. */
export const mentionLabel = (name, address) => {
  // Sliced by code point so a trailing emoji is never cut in half
  const clean = Array.from(String(name || '').replace(/[[\]()\n\r]/g, '').trim())
    .slice(0, MAX_MENTION_NAME_LENGTH / 2)
    .join('')
    .trim()
  return clean ||`${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Markdown for one mention, or '' when the address is not a wallet. */
export const mentionMarkdown = (name, address) => {
  let checksummed
  try {
    checksummed = getAddress(String(address).toLowerCase())
  } catch {
    return ''
  }
  return `[@${mentionLabel(name, checksummed)}](/${checksummed})`
}
