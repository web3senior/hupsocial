/**
 * @file lib/emailAuthSession.js
 * @description HMAC-signed session cookie for email-login accounts. Server-only.
 *
 * The session gates exactly one thing: the keystore route that releases the
 * server key-share and backup blob. Wallet-signature auth for extension users
 * is untouched. Token format is payloadBase64Url.signatureBase64Url with an
 * HMAC-SHA256 over the payload — no JWT library needed for a single issuer
 * and a single audience.
 */

import crypto from 'crypto'

export const SESSION_COOKIE = 'hup_email_session'
const SESSION_TTL_S = 30 * 24 * 60 * 60

const getSecret = () => {
  const secret = process.env.EMAIL_AUTH_SECRET
  if (!secret) throw new Error('EMAIL_AUTH_SECRET is not set')
  return secret
}

const sign = (payload) => crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url')

/** Peppered OTP hash — the DB never stores a code an offline attacker could grind unsalted. */
export const hashOtp = (email, code) =>
  crypto.createHash('sha256').update(`${email.toLowerCase()}:${code}:${getSecret()}`).digest('hex')

/** @returns {string} opaque token to place in the session cookie */
export const mintSessionToken = (accountId, email) => {
  const payload = Buffer.from(
    JSON.stringify({ accountId, email: email.toLowerCase(), exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** @returns {{accountId: number, email: string} | null} */
export const verifySessionToken = (token) => {
  if (!token || typeof token !== 'string') return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!data.accountId || !data.exp || data.exp * 1000 < Date.now()) return null
    return { accountId: data.accountId, email: data.email }
  } catch {
    return null
  }
}

/** Reads and verifies the session from a NextRequest; null when absent or invalid. */
export const sessionFromRequest = (request) => verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)

/** Options for NextResponse.cookies.set — HttpOnly so no script can lift the token. */
export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL_S,
})
