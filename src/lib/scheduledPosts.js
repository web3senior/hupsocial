/**
 * @file lib/scheduledPosts.js
 * @description Browser side of scheduled posts: the one-time signed sign-in that unlocks the
 * scheduled-posts API, the token it leaves in localStorage, the fetchers, the pre-signing that
 * lets the relayer publish a post while its author is away, and the wording the composer and the
 * list share.
 *
 * Two hands can publish a scheduled post (see lib/scheduledDelivery.js for the server's). This
 * file is the author's: it signs the forward request at schedule time, keeps that signature
 * fresh while the author is around, and — through components/ScheduledPostsRunner — publishes
 * directly when the relayer cannot.
 */

import { requestAuthNonce } from '@/lib/api'
import { normalizeAddress } from '@/lib/address'
import { ContentType } from '@/lib/content'
import { isSessionActive } from '@/lib/burnerSession'
import { isGaslessEnabled, readForwarderNonce, signHupForwardRequest } from '@/lib/relayGasless'
import { scheduleSessionMessage, SCHEDULE_DELIVERY_WINDOW_S } from '@/lib/scheduleSignature'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''
const tokenKey = (address) => `${prefix}schedule-session:${normalizeAddress(address)}`

// Fired whenever something changed that the runner should look at right away — a post was just
// scheduled, moved, or asked to go out now
export const SCHEDULE_POKE_EVENT = 'hup:scheduled-posts'

export const pokeScheduledRunner = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SCHEDULE_POKE_EVENT))
}

// --- Token ---

const listeners = new Set()
const announce = () => listeners.forEach((listener) => listener())
export const subscribeScheduleToken = (listener) => {
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
export const readScheduleToken = (address) => {
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

export const clearScheduleToken = (address) => {
  try {
    window.localStorage.removeItem(tokenKey(address))
  } catch {
    /* storage blocked */
  }
  announce()
}

/**
 * One wallet signature buys a month of scheduling. Reuses a stored token when it has one.
 * @param {string} address
 * @param {(args: {message: string}) => Promise<string>} signMessageAsync
 * @param {number} [chainId]
 * @returns {Promise<string>} bearer token
 */
export const ensureScheduleSession = async (address, signMessageAsync, chainId) => {
  const stored = readScheduleToken(address)
  if (stored) return stored

  const nonce = await requestAuthNonce(address)
  if (!nonce) throw new Error('Could not start the sign-in')
  const issuedAt = Date.now()
  const signature = await signMessageAsync({ message: scheduleSessionMessage({ address, nonce, issuedAt }) })

  const response = await fetch('/api/v1/posts/scheduled/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, nonce, issuedAt, signature, chainId }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.token) throw new Error(data?.error || 'Sign-in was rejected')

  try {
    window.localStorage.setItem(tokenKey(address), data.token)
  } catch {
    /* storage blocked: the token still works for this call */
  }
  announce()
  return data.token
}

// --- API ---

const authed = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })

const readJson = async (response, fallback) => {
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.success === false) {
    const error = new Error(data?.error || fallback)
    error.status = response.status
    throw error
  }
  return data
}

/** @returns {Promise<object[]>} the author's rows for a scope: pending (default), history, all */
export const listScheduledPosts = async (token, scope = 'pending') => {
  const response = await fetch(`/api/v1/posts/scheduled?scope=${scope}`, { headers: authed(token), cache: 'no-store' })
  return (await readJson(response, 'Could not load scheduled posts')).data
}

export const createScheduledPost = async (token, payload) => {
  const response = await fetch('/api/v1/posts/scheduled', { method: 'POST', headers: authed(token), body: JSON.stringify(payload) })
  return (await readJson(response, 'Could not schedule the post')).data
}

export const updateScheduledPost = async (token, id, body) => {
  const response = await fetch(`/api/v1/posts/scheduled/${id}`, { method: 'PATCH', headers: authed(token), body: JSON.stringify(body) })
  return (await readJson(response, 'Could not update the scheduled post')).data
}

export const cancelScheduledPost = async (token, id, { purge = false } = {}) => {
  const response = await fetch(`/api/v1/posts/scheduled/${id}${purge ? '?purge=1' : ''}`, { method: 'DELETE', headers: authed(token) })
  return (await readJson(response, 'Could not cancel the scheduled post')).data
}

/** Asks the server to relay whichever of the author's pre-signed posts are due. */
export const deliverDueScheduledPosts = async (token) => {
  const response = await fetch('/api/v1/posts/scheduled/deliver', { method: 'POST', headers: authed(token) })
  return (await readJson(response, 'Could not publish scheduled posts')).data
}

// --- Wording ---

/** "Tue, Sep 22, 2026 at 2:01 AM", in the viewer's locale and zone. */
export const formatWillSend = (unixSeconds) => {
  const date = new Date(Number(unixSeconds) * 1000)
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date)
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  return `${day} at ${time}`
}

/** The viewer's IANA zone, e.g. "Asia/Tehran". */
export const localTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** "Iran Standard Time" for "Asia/Tehran" — the zone's long name, or the id when there is none. */
export const timeZoneLongName = (zone) => {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: 'long' })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value || zone
    )
  } catch {
    return zone
  }
}

// --- Signing ---

/** The `create` call a scheduled row stands for. */
export const createArgsFor = (row, owner) => [owner, ContentType.Post, row.metadata, 0, row.allowComments !== false]

const serializeRequest = (request) => ({
  from: request.from,
  to: request.to,
  value: request.value.toString(),
  gas: request.gas.toString(),
  nonce: request.nonce.toString(),
  deadline: Number(request.deadline),
  data: request.data,
})

/**
 * Whether this author can pre-sign a forward request for the relayer at all: the chain is in
 * the gasless trial (and the author has not turned it off) and the account can sign one — a
 * plain wallet, or a smart account with a live session key.
 */
export const canPreSign = async ({ row, owner, publicClient }) => {
  if (!isGaslessEnabled(row.networkId) || !owner || !publicClient) return { ok: false, useSessionKey: false }

  const session = await isSessionActive({ userAddress: owner, publicClient }).catch(() => ({ active: false }))
  if (session.active) return { ok: true, useSessionKey: true }

  const code = await publicClient.getCode({ address: owner }).catch(() => null)
  return { ok: !(code && code !== '0x'), useSessionKey: false }
}

/**
 * The nonce a new pre-signed request should carry: the signer's current forwarder nonce plus one
 * for every already-signed post of theirs that goes out first. Requests from one signer execute
 * in nonce order, so a post due earlier has to be signed earlier in the sequence.
 */
const nonceForRow = ({ row, pendingRows, publicClient }) => async (from, forwarderAddress) => {
  const base = await readForwarderNonce(publicClient, forwarderAddress, from)
  const ahead = (pendingRows ?? []).filter(
    (other) =>
      other.id !== row.id &&
      other.status === 'scheduled' &&
      other.signed &&
      !other.signatureStale &&
      Number(other.networkId) === Number(row.networkId) &&
      normalizeAddress(other.forwardFrom) === normalizeAddress(from) &&
      (other.scheduledAt < row.scheduledAt || (other.scheduledAt === row.scheduledAt && other.id < row.id)),
  ).length
  return base + BigInt(ahead)
}

/**
 * Signs the forward request that lets the relayer publish `row` at its time and stores it on
 * the row. Silent with an active session key; one typed-data prompt for a plain wallet.
 *
 * @param {Object} params
 * @param {object} params.row A scheduled row from the API.
 * @param {object[]} [params.pendingRows] The author's other pending rows, for nonce ordering.
 * @param {object} params.chain Viem chain of the row's network.
 * @param {object} params.publicClient Viem client on that chain.
 * @param {string} params.owner The author.
 * @param {Function} [params.signTypedDataAsync] wagmi signer for the wallet path.
 * @param {boolean} params.useSessionKey From canPreSign.
 * @param {string} params.token Scheduled-posts bearer token.
 * @returns {Promise<object>} The updated row.
 */
export const preSignScheduledPost = async ({ row, pendingRows, chain, publicClient, owner, signTypedDataAsync, useSessionKey, token }) => {
  const signed = await signHupForwardRequest({
    chain,
    publicClient,
    owner,
    functionName: 'create',
    args: createArgsFor(row, owner),
    signTypedDataAsync,
    useSessionKey,
    deadline: Number(row.scheduledAt) + SCHEDULE_DELIVERY_WINDOW_S,
    nonceFor: nonceForRow({ row, pendingRows, publicClient }),
  })

  return updateScheduledPost(token, row.id, {
    action: 'sign',
    forwardRequest: serializeRequest(signed.request),
    signature: signed.signature,
    forwarderAddress: signed.forwarderAddress,
    forwarderName: signed.forwarderName,
  })
}
