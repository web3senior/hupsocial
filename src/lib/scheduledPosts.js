/**
 * @file lib/scheduledPosts.js
 * @description Browser side of scheduled posts: signing the request that lets the relayer publish a
 * post at its time, the fetchers, the one-time sign-in the list page needs, and the wording the
 * composer and the list share.
 *
 * A scheduled post is a HupScheduleForwarder request the author signs with their own wallet when
 * they press Schedule: a plain key signs the typed data, a Universal Profile answers for its
 * controller's signature through ERC-1271. The chosen time is inside the signature, so the relayer
 * can deliver it with nobody online and cannot deliver it early (lib/scheduledDelivery.js).
 */

import { encodeFunctionData, hashTypedData } from 'viem'
import hupAbi from '@/abi/post.json'
import { CONTRACTS } from '@/config/contracts'
import { requestAuthNonce } from '@/lib/api'
import { normalizeAddress } from '@/lib/address'
import { ContentType } from '@/lib/content'
import { scheduleSessionMessage, SCHEDULE_DELIVERY_WINDOW_S } from '@/lib/scheduleSignature'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''
const tokenKey = (address) => `${prefix}schedule-session:${normalizeAddress(address)}`

// Fired whenever something changed that the runner should look at right away
export const SCHEDULE_POKE_EVENT = 'hup:scheduled-posts'

export const pokeScheduledRunner = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SCHEDULE_POKE_EVENT))
}

// --- Token (list page only) ---

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
 * One wallet signature buys a month of access to the list. Reuses a stored token when it has one.
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

/** Records a signed post. No token: the signature is the proof of who scheduled it. */
export const createScheduledPost = async (payload) => {
  const response = await fetch('/api/v1/posts/scheduled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await readJson(response, 'Could not schedule the post')).data
}

/** Moves a pending or failed post to a new signed time, "now" included. */
export const rescheduleScheduledPost = async (token, id, body) => {
  const response = await fetch(`/api/v1/posts/scheduled/${id}`, {
    method: 'PATCH',
    headers: authed(token),
    body: JSON.stringify({ action: 'reschedule', ...body }),
  })
  return (await readJson(response, 'Could not move the scheduled post')).data
}

export const cancelScheduledPost = async (token, id, { purge = false } = {}) => {
  const response = await fetch(`/api/v1/posts/scheduled/${id}${purge ? '?purge=1' : ''}`, { method: 'DELETE', headers: authed(token) })
  return (await readJson(response, 'Could not cancel the scheduled post')).data
}

/** Asks the server to publish whichever of the author's posts are due. */
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

/** "Iran Standard Time" for "Asia/Tehran": the zone's long name, or the id when there is none. */
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

const SCHEDULED_REQUEST_TYPES = {
  ScheduledRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'notBefore', type: 'uint48' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
}

// Headroom for Hup.create storing a struct and a CID string; unused gas is never charged
const SCHEDULED_POST_GAS = 600_000n

const TRUSTED_FORWARDER_ABI = [
  {
    inputs: [{ name: 'forwarder', type: 'address' }],
    name: 'isTrustedForwarder',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
]

// Only a yes is cached: a chain switched on mid-session should not need a reload
const liveChains = new Set()

/** Whether this chain has a schedule forwarder configured at all. */
export const canScheduleOn = (networkId) => Boolean(CONTRACTS[`chain${Number(networkId)}`]?.scheduleForwarder)

/** Whether this chain's Hup trusts the schedule forwarder yet, which is what makes scheduling live there. */
export const isSchedulingLive = async ({ networkId, publicClient }) => {
  const contracts = CONTRACTS[`chain${Number(networkId)}`]
  if (!contracts?.hup || !contracts?.scheduleForwarder || !publicClient) return false
  if (liveChains.has(Number(networkId))) return true

  try {
    const live = Boolean(
      await publicClient.readContract({
        address: contracts.hup,
        abi: TRUSTED_FORWARDER_ABI,
        functionName: 'isTrustedForwarder',
        args: [contracts.scheduleForwarder],
      }),
    )
    if (live) liveChains.add(Number(networkId))
    return live
  } catch {
    return false
  }
}

/** A fresh 256-bit nonce. Random rather than sequential, so it never collides with the author's other requests. */
export const randomNonce = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`)
}

const isDeclined = (error) => /rejected|denied|cancel/i.test(error?.shortMessage || error?.message || '') || error?.code === 4001

/**
 * Signs the request that publishes `metadata` as a post by `owner` at `scheduledAt`.
 *
 * Typed data first, which both plain wallets and the Universal Profile extension sign. If a contract
 * account's wallet cannot sign typed data, its controller signs the same digest as a message, which
 * the forwarder accepts from contract accounts only.
 *
 * @param {Object} params
 * @param {number} params.chainId The post's chain; the wallet must be on it.
 * @param {Object} params.publicClient Viem client on that chain.
 * @param {string} params.owner The author, who signs.
 * @param {string} params.metadata The pinned ipfs:// URI.
 * @param {boolean} params.allowComments
 * @param {number} params.scheduledAt Unix seconds.
 * @param {bigint} params.nonce From randomNonce(), or the row's own when re-signing a new time.
 * @param {Function} params.signTypedDataAsync wagmi signer.
 * @param {Function} params.signMessageAsync wagmi signer, for the contract-account fallback.
 * @returns {Promise<{forwardRequest: Object, signature: string}>}
 */
export const signScheduledPost = async ({ chainId, publicClient, owner, metadata, allowComments, scheduledAt, nonce, signTypedDataAsync, signMessageAsync }) => {
  const contracts = CONTRACTS[`chain${Number(chainId)}`]
  if (!contracts?.hup || !contracts?.scheduleForwarder) throw new Error('Scheduling is not supported on this network')

  const message = {
    from: owner,
    to: contracts.hup,
    gas: SCHEDULED_POST_GAS,
    nonce: BigInt(nonce),
    notBefore: Number(scheduledAt),
    deadline: Number(scheduledAt) + SCHEDULE_DELIVERY_WINDOW_S,
    data: encodeFunctionData({
      abi: hupAbi,
      functionName: 'create',
      args: [owner, ContentType.Post, metadata, 0n, Boolean(allowComments)],
    }),
  }
  const typedData = {
    domain: { name: 'HupScheduleForwarder', version: '1', chainId: Number(chainId), verifyingContract: contracts.scheduleForwarder },
    types: SCHEDULED_REQUEST_TYPES,
    primaryType: 'ScheduledRequest',
    message,
  }

  let signature
  try {
    signature = await signTypedDataAsync(typedData)
  } catch (error) {
    if (isDeclined(error) || typeof signMessageAsync !== 'function') throw error

    const code = await publicClient?.getCode({ address: owner }).catch(() => null)
    if (!code || code === '0x') throw error

    signature = await signMessageAsync({ message: { raw: hashTypedData(typedData) } })
  }

  return {
    forwardRequest: {
      ...message,
      gas: message.gas.toString(),
      nonce: message.nonce.toString(),
    },
    signature,
  }
}
