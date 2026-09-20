/**
 * @file lib/chatSession.js
 * @description HMAC-signed bearer token for the public chat, plus the chat_users row behind a
 * wallet. Server-only.
 *
 * A wallet signs once (see lib/chatSignature.js) and gets a token that carries its address;
 * every post after that proves identity with the token instead of a fresh signature. Same
 * payload.signature format as lib/emailAuthSession.js.
 */

import crypto from 'crypto'
import { normalizeAddress } from '@/lib/address'

const SESSION_TTL_S = 7 * 24 * 60 * 60

const getSecret = () => {
  const secret = process.env.CHAT_SESSION_SECRET || process.env.EMAIL_AUTH_SECRET
  if (!secret) throw new Error('CHAT_SESSION_SECRET is not set')
  return secret
}

const sign = (payload) => crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url')

/** @returns {string} opaque bearer token */
export const mintChatToken = (address) => {
  const payload = Buffer.from(
    JSON.stringify({ address: normalizeAddress(address), exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** @returns {string|null} the lowercase wallet the token was minted for */
export const verifyChatToken = (token) => {
  if (!token || typeof token !== 'string') return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!data.address || !data.exp || data.exp * 1000 < Date.now()) return null
    return normalizeAddress(data.address)
  } catch {
    return null
  }
}

/** The wallet behind an `Authorization: Bearer` header, or null. */
export const chatAddressFromRequest = (request) => {
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  return verifyChatToken(token)
}

// --- Chat users: the compact row a wallet gets on first sign-in, holding its role and ban ---

export const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase() || null

export const isChatAdmin = (address) => Boolean(ADMIN_WALLET && normalizeAddress(address) === ADMIN_WALLET)

/**
 * The chat_users row for a wallet, created on first sight.
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} address
 * @returns {Promise<{id: number, wallet: string, role: string, banned_until: Date|null, ban_reason: string|null}>}
 */
export const ensureChatUser = async (pool, address) => {
  const wallet = normalizeAddress(address)
  await pool.execute('INSERT IGNORE INTO chat_users (wallet) VALUES (?)', [wallet])
  const [[row]] = await pool.execute('SELECT id, wallet, role, banned_until, ban_reason FROM chat_users WHERE wallet = ? LIMIT 1', [wallet])
  return row
}

/** Whether a chat_users row is under a ban right now. */
export const isBanned = (row) => Boolean(row?.banned_until && new Date(row.banned_until).getTime() > Date.now())

/** Whether a wallet may moderate: the admin always, plus anyone holding the moderator role. */
export const canModerate = (row) => isChatAdmin(row?.wallet) || row?.role === 'moderator'

/**
 * The signed-in wallet's row, or null when the request carries no valid token.
 * @returns {Promise<Awaited<ReturnType<typeof ensureChatUser>>|null>}
 */
export const chatActorFromRequest = async (pool, request) => {
  const address = chatAddressFromRequest(request)
  return address ? ensureChatUser(pool, address) : null
}
