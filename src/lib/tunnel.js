import { getAddress, isAddress, zeroAddress } from 'viem'

const TUNNEL_CHAT_URL = 'https://www.tunnelapp.chat/chat'
// Tunnel's invite links carry the account as `/chat?add=0x…` (My QR code → Copy link).
const INVITE_PARAM = 'add'

/**
 * The Tunnel account a profile points Message at, from what its owner pasted: the address itself
 * or Tunnel's invite link. A mixed-case address must carry a valid checksum, as Tunnel requires.
 * @param {unknown} value
 * @returns {string|null} Checksummed address, or null when the value names none.
 */
export function parseTunnelAddress(value) {
  if (typeof value !== 'string') return null
  let candidate = value.trim()
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).searchParams.get(INVITE_PARAM)?.trim() ?? ''
    } catch {
      return null
    }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate) || !isAddress(candidate)) return null
  const address = getAddress(candidate.toLowerCase())
  return address === getAddress(zeroAddress) ? null : address
}

/** Opens Tunnel's New chat form with this address filled in. */
export const tunnelChatUrl = (address) => `${TUNNEL_CHAT_URL}?${INVITE_PARAM}=${address}`
