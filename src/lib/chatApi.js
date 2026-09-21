/**
 * @file lib/chatApi.js
 * @description Browser side of the public chat room: the one-time signed sign-in that allows
 * posting, the token it leaves in localStorage, and the fetchers. Reading needs no token.
 */

import { requestAuthNonce } from '@/lib/api'
import { normalizeAddress } from '@/lib/address'
import { chatSessionMessage } from '@/lib/chatSignature'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''
const tokenKey = (address) => `${prefix}chat-session:${normalizeAddress(address)}`

// Token changes are announced so the dock can read them through useSyncExternalStore
const listeners = new Set()
const announce = () => listeners.forEach((listener) => listener())
export const subscribeChatToken = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const tokenExpiry = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')))
    return Number(payload?.exp) * 1000
  } catch {
    return 0
  }
}

/** @returns {string|null} a stored token that has not expired */
export const readChatToken = (address) => {
  if (!address || typeof window === 'undefined') return null
  try {
    const token = window.localStorage.getItem(tokenKey(address))
    if (!token) return null
    if (tokenExpiry(token) - 60_000 < Date.now()) {
      window.localStorage.removeItem(tokenKey(address))
      return null
    }
    return token
  } catch {
    return null
  }
}

export const clearChatToken = (address) => {
  try {
    window.localStorage.removeItem(tokenKey(address))
  } catch {
    /* storage blocked */
  }
  announce()
}

/**
 * One wallet signature buys a week of chat. Reuses a stored token when it has one.
 * @param {string} address
 * @param {(args: {message: string}) => Promise<string>} signMessageAsync
 * @param {number} [chainId]
 * @returns {Promise<string>} bearer token
 */
export const ensureChatSession = async (address, signMessageAsync, chainId) => {
  const stored = readChatToken(address)
  if (stored) return stored

  const nonce = await requestAuthNonce(address)
  if (!nonce) throw new Error('Could not start the sign-in')
  const issuedAt = Date.now()
  const signature = await signMessageAsync({ message: chatSessionMessage({ address, nonce, issuedAt }) })

  const response = await fetch('/api/v1/chat/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, nonce, issuedAt, signature, chainId }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.token) throw new Error(data?.error || 'Sign-in was rejected')

  try {
    window.localStorage.setItem(tokenKey(address), data.token)
  } catch {
    /* storage blocked: the token lives for this page only */
  }
  announce()
  return data.token
}

class ChatApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

const call = async (token, path, init = {}) => {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ChatApiError(data?.error || 'Chat request failed', response.status)
  return data
}

export const fetchRoomMessages = ({ room = 'global', after, before, deletedSince } = {}) => {
  const params = new URLSearchParams({ room })
  if (after) params.set('after', String(after))
  if (before) params.set('before', String(before))
  if (deletedSince) params.set('deletedSince', deletedSince)
  return call(null, `/api/v1/chat/room?${params}`)
}

/**
 * How many live messages are newer than `sinceId`, capped, plus the newest id, the last few
 * faces, and (with a viewer) how many of those lines mention them and which comes first.
 */
export const fetchRoomUnread = (sinceId, viewer = null, room = 'global') => {
  const params = new URLSearchParams({ room, countAfter: String(sinceId || 0) })
  if (viewer) params.set('viewer', viewer)
  return call(null, `/api/v1/chat/room?${params}`)
}

export const sendRoomMessage = (token, body, { kind = 'text', room = 'global' } = {}) =>
  call(token, '/api/v1/chat/room', { method: 'POST', body: JSON.stringify({ room, body, kind }) })

export const fetchChatMe = (token) => call(token, '/api/v1/chat/me')

export const moderateChat = (token, payload) => call(token, '/api/v1/chat/moderation', { method: 'POST', body: JSON.stringify(payload) })

export const isChatUnauthorized = (error) => error?.status === 401
