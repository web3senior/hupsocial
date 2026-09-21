/**
 * @file lib/scheduleSession.js
 * @description HMAC-signed bearer token for the scheduled-posts API. Server-only.
 *
 * A wallet signs once (see lib/scheduleSignature.js) and gets a token that carries its address;
 * every read and write after that proves identity with the token instead of a fresh signature,
 * which is what lets the shell poll for due posts without prompting. Same payload.signature
 * format as lib/chatSession.js, scoped so a chat token never passes here and vice versa.
 */

import crypto from 'crypto'
import { normalizeAddress } from '@/lib/address'

// A post can be scheduled weeks out, and the runner that publishes it needs a token that is
// still valid when the day comes
const SESSION_TTL_S = 30 * 24 * 60 * 60
const SCOPE = 'schedule'

const getSecret = () => {
  const secret = process.env.CHAT_SESSION_SECRET || process.env.EMAIL_AUTH_SECRET
  if (!secret) throw new Error('CHAT_SESSION_SECRET is not set')
  return secret
}

const sign = (payload) => crypto.createHmac('sha256', getSecret()).update(`${SCOPE}:${payload}`).digest('base64url')

/** @returns {string} opaque bearer token */
export const mintScheduleToken = (address) => {
  const payload = Buffer.from(
    JSON.stringify({ address: normalizeAddress(address), scope: SCOPE, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** @returns {string|null} the lowercase wallet the token was minted for */
export const verifyScheduleToken = (token) => {
  if (!token || typeof token !== 'string') return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (data.scope !== SCOPE || !data.address || !data.exp || data.exp * 1000 < Date.now()) return null
    return normalizeAddress(data.address)
  } catch {
    return null
  }
}

/** The wallet behind an `Authorization: Bearer` header, or null. */
export const scheduleAddressFromRequest = (request) => {
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  return verifyScheduleToken(token)
}
