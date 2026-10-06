import { getAddress, isAddress, zeroAddress } from 'viem'

const TUNNEL_CHAT_URL = 'https://www.tunnelapp.chat/chat'
// Tunnel's invite links carry the account as `/chat?add=0x…` (My QR code → Copy link), or a
// Readable number as `?add=%2B04242`.
const INVITE_PARAM = 'add'

/* The invite's `add` value, decoded without URLSearchParams, which reads a bare `+` as a space and
   would turn `?add=+04242` into ` 04242`. Null when the text is not a link. */
function inviteValue(text) {
  if (!/^https?:\/\//i.test(text)) return null
  try {
    const raw = new URL(text).search.match(new RegExp(`[?&]${INVITE_PARAM}=([^&]*)`))?.[1]
    return raw === undefined ? '' : decodeURIComponent(raw).trim()
  } catch {
    return ''
  }
}

/**
 * The Tunnel account a profile points Message at, from what its owner pasted: the address itself
 * or Tunnel's invite link. A mixed-case address must carry a valid checksum, as Tunnel requires.
 * @param {unknown} value
 * @returns {string|null} Checksummed address, or null when the value names none.
 */
export function parseTunnelAddress(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const candidate = inviteValue(text) ?? text
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate) || !isAddress(candidate)) return null
  const address = getAddress(candidate.toLowerCase())
  return address === getAddress(zeroAddress) ? null : address
}

/**
 * What to look up as a Readable name (readable-sdk decides whether it is one): the text as typed,
 * or what a Tunnel invite link carries. Null when it is empty or written as an address.
 * @param {unknown} value
 * @returns {string|null}
 */
export function tunnelLookupText(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const candidate = inviteValue(text) ?? text
  return candidate && !/^0x/i.test(candidate) ? candidate : null
}

/** Opens Tunnel's New chat form with this address filled in. */
export const tunnelChatUrl = (address) => `${TUNNEL_CHAT_URL}?${INVITE_PARAM}=${address}`
