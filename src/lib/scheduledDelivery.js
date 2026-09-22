/**
 * @file lib/scheduledDelivery.js
 * @description Server side of scheduled posts: checking a signed request before it is stored, the
 * row shape the API returns, and the sweep that publishes due posts. Server-only.
 *
 * The author signs a HupScheduleForwarder request when they schedule. Its notBefore is the chosen
 * time, so nobody (the relayer included) can publish early, and its nonce is theirs alone, so none
 * of their other activity can invalidate it. From then on the relayer alone delivers it: the cron
 * sweeps every minute, and a delivery that fails for a passing reason is retried with backoff until
 * the signed deadline. Nothing here ever needs the author back.
 */

import { ethers } from 'ethers'
import pool from '@/lib/db'
import hupAbi from '@/abi/post.json'
import scheduleForwarderAbi from '@/abis/HupScheduleForwarder.json'
import { appChains, CONTRACTS } from '@/config/contracts'
import { sameAddress } from '@/lib/address'
import { forgetServerRpc, getServerProvider, isTransportError } from '@/lib/serverRpc'
import { enqueueRelayerSend, relayerFees, relayerWallet } from '@/lib/relayerSend'
import { SCHEDULE_DELIVERY_WINDOW_S, SCHEDULE_MAX_AHEAD_S, SCHEDULE_MIN_LEAD_S } from '@/lib/scheduleSignature'

const hupInterface = new ethers.Interface(hupAbi)
const forwarderInterface = new ethers.Interface(scheduleForwarderAbi)

const CONTENT_TYPE_POST = 0
// Room over the signed call gas for the forwarder's own checks and the ERC-1271 lookup
const FORWARDER_OVERHEAD_GAS = 100_000n
const MIN_REQUEST_GAS = 200_000n
const MAX_REQUEST_GAS = 1_000_000n
// "Post now" may be signed a moment before the server reads it
const NOW_SKEW_S = 120
// Backoff between delivery attempts: 1, 2, 4 … minutes, capped at an hour
const MAX_BACKOFF_S = 3600
const STUCK_SENDING_MINUTES = 10
// A post the chain's latest block still calls early is checked again this soon, not counted as a failure
const NOT_YET_RETRY_S = 15
// Blocks searched for the execution event when a nonce turns out spent
const EXECUTED_LOOKBACK_BLOCKS = 1900

const nowSeconds = () => Math.floor(Date.now() / 1000)

const chainName = (networkId) => appChains.find((chain) => chain.id === Number(networkId))?.name || `network ${networkId}`

const parseJson = (text, fallback) => {
  if (text === null || text === undefined) return fallback
  if (typeof text === 'object') return text
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

const toBigInt = (value) => {
  try {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
    if (typeof value === 'string' && /^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/.test(value)) return BigInt(value)
  } catch {
    /* falls through */
  }
  return null
}

/** The contracts a chain needs before anything can be scheduled on it. */
export const scheduleContractsFor = (networkId) => {
  const contracts = CONTRACTS[`chain${Number(networkId)}`]
  return contracts?.hup && contracts?.scheduleForwarder ? { hup: contracts.hup, forwarder: contracts.scheduleForwarder } : null
}

/**
 * A schedule time the API will accept: whole unix seconds, a minute out at least and a year at
 * most. With `allowNow`, "now" itself, give or take clock skew, for "Post now".
 * @returns {{ok: true, value: number}|{ok: false, error: string}}
 */
export const validateScheduledAt = (value, { allowNow = false } = {}) => {
  const seconds = Number(value)
  if (!Number.isInteger(seconds) || seconds <= 0) return { ok: false, error: 'A schedule time is required' }

  const now = nowSeconds()
  const earliest = allowNow ? now - NOW_SKEW_S : now + SCHEDULE_MIN_LEAD_S
  if (seconds < earliest) return { ok: false, error: 'Pick a time at least a minute from now' }
  if (seconds > now + SCHEDULE_MAX_AHEAD_S) return { ok: false, error: 'Posts can be scheduled up to a year ahead' }

  return { ok: true, value: seconds }
}

/** The request as stored and sent: every integer as a decimal string. */
const normalizeRequest = (request) => ({
  from: ethers.getAddress(request.from),
  to: ethers.getAddress(request.to),
  gas: toBigInt(request.gas).toString(),
  nonce: toBigInt(request.nonce).toString(),
  notBefore: Number(request.notBefore),
  deadline: Number(request.deadline),
  data: request.data,
})

/**
 * Everything a signed request must be before a row may hold it: shaped as `create` for exactly this
 * author, post and time, and accepted by the forwarder itself, which settles the signature (key or
 * ERC-1271), the nonce and Hup's trust in one read. Also refuses a chain whose relayer could not pay
 * for the send today, so a post never waits on a relayer that is already dry.
 *
 * @param {Object} params
 * @param {string} params.author Lowercase wallet the post belongs to.
 * @param {number} params.networkId
 * @param {string} params.metadata The pinned ipfs:// URI.
 * @param {boolean} params.allowComments
 * @param {number} params.scheduledAt Unix seconds; must equal the signed notBefore.
 * @param {Object} params.forwardRequest The ScheduledRequest as the client signed it.
 * @param {string} params.signature
 * @param {string|null} [params.expectNonce] A reschedule must keep the row's nonce, so only one of
 *   the two signatures can ever publish.
 * @returns {Promise<{ok: true, request: Object, forwarder: string}|{ok: false, error: string, status?: number}>}
 */
export async function checkScheduledRequest({ author, networkId, metadata, allowComments, scheduledAt, forwardRequest, signature, expectNonce = null }) {
  const contracts = scheduleContractsFor(networkId)
  if (!contracts) return { ok: false, error: `Scheduling is not supported on ${chainName(networkId)}` }

  if (!forwardRequest || typeof forwardRequest !== 'object') return { ok: false, error: 'The signed request is missing' }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 4000) {
    return { ok: false, error: 'A signature is required' }
  }

  const gas = toBigInt(forwardRequest.gas)
  const nonce = toBigInt(forwardRequest.nonce)
  if (!ethers.isAddress(forwardRequest.from) || !ethers.isAddress(forwardRequest.to) || gas === null || nonce === null || nonce >= 2n ** 256n) {
    return { ok: false, error: 'The signed request is malformed' }
  }
  if (!sameAddress(forwardRequest.from, author)) return { ok: false, error: 'The request is signed for a different author' }
  if (!sameAddress(forwardRequest.to, contracts.hup)) return { ok: false, error: 'The request does not target Hup on this network' }
  if (gas < MIN_REQUEST_GAS || gas > MAX_REQUEST_GAS) return { ok: false, error: 'The request asks for an unusual amount of gas' }
  if (Number(forwardRequest.notBefore) !== Number(scheduledAt)) return { ok: false, error: 'The signed time does not match the schedule' }
  if (Number(forwardRequest.deadline) !== Number(scheduledAt) + SCHEDULE_DELIVERY_WINDOW_S) {
    return { ok: false, error: 'The signed deadline does not match the schedule' }
  }
  if (expectNonce !== null && nonce.toString() !== String(expectNonce)) {
    return { ok: false, error: 'A new time has to be signed with the same nonce as before' }
  }

  let decoded
  try {
    decoded = hupInterface.decodeFunctionData('create', forwardRequest.data)
  } catch {
    return { ok: false, error: 'The request is not a post' }
  }
  const [owner, contentType, signedMetadata, parentId, signedAllowComments] = decoded
  if (!sameAddress(owner, author)) return { ok: false, error: 'The post is signed for a different author' }
  if (Number(contentType) !== CONTENT_TYPE_POST || BigInt(parentId) !== 0n) return { ok: false, error: 'Only posts and quotes can be scheduled' }
  if (signedMetadata !== metadata) return { ok: false, error: 'The signature does not cover this post' }
  if (Boolean(signedAllowComments) !== Boolean(allowComments)) return { ok: false, error: 'The signed reply setting does not match' }

  const request = normalizeRequest(forwardRequest)

  const provider = await getServerProvider(networkId)
  if (!provider) return { ok: false, error: `Could not reach ${chainName(networkId)} right now, try again shortly`, status: 503 }

  try {
    const forwarder = new ethers.Contract(contracts.forwarder, scheduleForwarderAbi, provider)
    const hup = new ethers.Contract(contracts.hup, ['function isTrustedForwarder(address) view returns (bool)'], provider)

    const [valid, trusted] = await Promise.all([forwarder.verify(request, signature), hup.isTrustedForwarder(contracts.forwarder)])
    if (!trusted) return { ok: false, error: `Scheduling is not live on ${chainName(networkId)} yet` }
    if (!valid) return { ok: false, error: 'The signature does not match this wallet' }

    const [balance, fees] = await Promise.all([provider.getBalance(relayerWallet(provider).address), relayerFees(provider)])
    const oneSend = (gas + FORWARDER_OVERHEAD_GAS) * fees.maxFeePerGas
    if (balance < oneSend) return { ok: false, error: `Scheduling on ${chainName(networkId)} is paused while its relayer is topped up`, status: 503 }

    return { ok: true, request, forwarder: contracts.forwarder }
  } catch (error) {
    if (isTransportError(error)) forgetServerRpc(networkId)
    console.error('SCHEDULE_CHECK_ERROR:', networkId, error.shortMessage || error.message)
    return { ok: false, error: `Could not check the signature on ${chainName(networkId)}, try again shortly`, status: 503 }
  } finally {
    provider.destroy()
  }
}

/**
 * The public shape of a row. The stored signature never leaves the server.
 * @param {object} row A scheduled_posts row.
 */
export const serializeScheduledRow = (row) => {
  const request = parseJson(row.forward_request, null)

  return {
    id: Number(row.id),
    walletAddress: row.wallet_address,
    networkId: Number(row.network_id),
    metadata: row.metadata,
    content: parseJson(row.content, null),
    allowComments: Boolean(Number(row.allow_comments)),
    quoteOf: row.quote_of ?? null,
    scheduledAt: Number(row.scheduled_at),
    timeZone: row.time_zone ?? null,
    status: row.status,
    signed: Boolean(row.signature),
    forwardNonce: row.forward_nonce ?? null,
    forwardDeadline: request?.deadline ? Number(request.deadline) : null,
    forwarderAddress: row.forwarder_address ?? null,
    attempts: Number(row.attempts) || 0,
    retryAt: row.retry_at === null || row.retry_at === undefined ? null : Number(row.retry_at),
    lastError: row.last_error ?? null,
    txHash: row.tx_hash ?? null,
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : Number(row.sent_at),
    createdAt: row.created_at,
  }
}

// --- Delivery ---

const clip = (text) => String(text ?? '').slice(0, 255)

const markSent = async (row, txHash) => {
  await pool.execute(
    `UPDATE scheduled_posts SET status = 'sent', tx_hash = ?, sent_at = ?, retry_at = NULL, last_error = NULL WHERE id = ?`,
    [txHash, nowSeconds(), row.id],
  )
  return { id: row.id, outcome: 'sent', txHash }
}

const markFailed = async (row, reason) => {
  await pool.execute(`UPDATE scheduled_posts SET status = 'failed', retry_at = NULL, last_error = ? WHERE id = ?`, [clip(reason), row.id])
  return { id: row.id, outcome: 'failed', reason }
}

// Back in the queue for a later sweep. Past the signed deadline there is nothing left to retry.
const markRetry = async (row, reason, deadline) => {
  const attempts = (Number(row.attempts) || 0) + 1
  const retryAt = nowSeconds() + Math.min(60 * 2 ** Math.min(attempts - 1, 10), MAX_BACKOFF_S)
  if (deadline && retryAt > deadline) return markFailed(row, `${reason} (gave up at the signed deadline)`)

  await pool.execute(
    `UPDATE scheduled_posts SET status = 'scheduled', attempts = ?, retry_at = ?, last_error = ? WHERE id = ?`,
    [attempts, retryAt, clip(reason), row.id],
  )
  return { id: row.id, outcome: 'retry', reason }
}

// Simulations run against the latest block, which trails the wall clock by a block time or two
const markNotYet = async (row, notBefore) => {
  const retryAt = Math.max(nowSeconds(), Number(notBefore) || 0) + NOT_YET_RETRY_S
  await pool.execute(`UPDATE scheduled_posts SET status = 'scheduled', retry_at = ? WHERE id = ?`, [retryAt, row.id])
  return { id: row.id, outcome: 'retry', reason: 'Not due onchain yet' }
}

/** The error name inside a revert, from the forwarder or from Hup bubbled through it. */
const revertName = (error) => {
  const data = error?.data ?? error?.info?.error?.data ?? error?.error?.data
  if (typeof data !== 'string' || data.length < 10) return error?.revert?.name ?? null

  for (const iface of [forwarderInterface, hupInterface]) {
    try {
      const parsed = iface.parseError(data)
      if (parsed) return parsed.name
    } catch {
      /* not this contract's error */
    }
  }
  return null
}

/** The transaction that spent this nonce, when it went out recently enough to find. */
const findExecution = async (provider, forwarderAddress, from, nonce) => {
  try {
    const latest = await provider.getBlockNumber()
    const logs = await provider.getLogs({
      address: forwarderAddress,
      topics: [
        forwarderInterface.getEvent('ScheduledRequestExecuted').topicHash,
        ethers.zeroPadValue(from, 32),
        ethers.toBeHex(BigInt(nonce), 32),
      ],
      fromBlock: Math.max(0, latest - EXECUTED_LOOKBACK_BLOCKS),
      toBlock: latest,
    })
    return logs[0]?.transactionHash ?? null
  } catch {
    return null
  }
}

const deliverRow = async (row) => {
  const request = parseJson(row.forward_request, null)
  if (!request || !row.signature) return markFailed(row, 'The stored request is unreadable')

  const deadline = Number(request.deadline)
  if (deadline < nowSeconds()) return markFailed(row, 'The signed request expired before it could be sent')

  const networkId = Number(row.network_id)
  const provider = await getServerProvider(networkId)
  if (!provider) return markRetry(row, `Could not reach ${chainName(networkId)}`, deadline)

  try {
    // A previous attempt broadcast but died before recording the outcome
    if (row.tx_hash) {
      const receipt = await provider.getTransactionReceipt(row.tx_hash)
      if (receipt?.status === 1) return markSent(row, row.tx_hash)
      if (!receipt) return markRetry(row, 'Waiting for the last attempt to confirm', deadline)
    }

    const forwarder = new ethers.Contract(row.forwarder_address, scheduleForwarderAbi, relayerWallet(provider))
    const gasLimit = BigInt(request.gas) + FORWARDER_OVERHEAD_GAS

    try {
      await forwarder.execute.staticCall(request, row.signature, { gasLimit })
    } catch (error) {
      if (isTransportError(error)) {
        forgetServerRpc(networkId)
        return markRetry(row, `Could not reach ${chainName(networkId)}`, deadline)
      }

      const name = revertName(error)
      if (name === 'NonceUsed') {
        const txHash = await findExecution(provider, row.forwarder_address, request.from, request.nonce)
        return txHash ? markSent(row, txHash) : markFailed(row, 'This signature was already used or cancelled onchain')
      }
      if (name === 'Expired') return markFailed(row, 'The signed request expired before it could be sent')
      if (name === 'InvalidSignature') return markFailed(row, 'The wallet no longer accepts this signature')
      if (name === 'TooEarly') return markNotYet(row, request.notBefore)
      // Operational, not the post's fault: an admin can re-trust or unpause before the deadline
      if (name === 'UntrustfulTarget') return markRetry(row, `Hup on ${chainName(networkId)} does not trust the schedule forwarder`, deadline)
      if (name === 'EnforcedPause') return markRetry(row, `Hup on ${chainName(networkId)} is paused`, deadline)
      if (name) return markFailed(row, `Hup refused the post: ${name}`)

      return markRetry(row, error.shortMessage || error.message || 'Simulation failed', deadline)
    }

    const fees = await relayerFees(provider)
    let tx
    try {
      tx = await enqueueRelayerSend(networkId, () => forwarder.execute(request, row.signature, { gasLimit, ...fees }))
    } catch (error) {
      if (error?.code === 'INSUFFICIENT_FUNDS') return markRetry(row, `The relayer is out of gas on ${chainName(networkId)}`, deadline)
      if (isTransportError(error)) forgetServerRpc(networkId)
      return markRetry(row, error.shortMessage || error.message || 'Send failed', deadline)
    }

    await pool.execute(`UPDATE scheduled_posts SET tx_hash = ? WHERE id = ?`, [tx.hash, row.id])
    return markSent(row, tx.hash)
  } finally {
    provider.destroy()
  }
}

/**
 * Publishes every due scheduled post through the relayer.
 *
 * @param {{walletAddress?: string|null, limit?: number}} [options] Narrow to one author (the runner
 *   delivering its own posts) and cap the batch.
 * @returns {Promise<{sent: object[], failed: object[], retry: object[]}>}
 */
export async function deliverDueScheduledPosts({ walletAddress = null, limit = 25 } = {}) {
  await pool.execute(
    `UPDATE scheduled_posts SET status = 'scheduled' WHERE status = 'sending' AND updated_at < NOW() - INTERVAL ? MINUTE`,
    [STUCK_SENDING_MINUTES],
  )

  const now = nowSeconds()
  const params = [now, now]
  let where = `status = 'scheduled' AND signature IS NOT NULL AND scheduled_at <= ? AND (retry_at IS NULL OR retry_at <= ?)`
  if (walletAddress) {
    where += ' AND wallet_address = ?'
    params.push(walletAddress)
  }

  const [rows] = await pool.query(
    `SELECT * FROM scheduled_posts WHERE ${where} ORDER BY scheduled_at ASC, id ASC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 25))}`,
    params,
  )

  const result = { sent: [], failed: [], retry: [] }

  for (const row of rows) {
    // The claim is the lock: the cron and an author's runner can both reach the same row
    const [claim] = await pool.execute(`UPDATE scheduled_posts SET status = 'sending' WHERE id = ? AND status = 'scheduled'`, [row.id])
    if (claim.affectedRows !== 1) continue

    let outcome
    try {
      outcome = await deliverRow(row)
    } catch (error) {
      console.error('SCHEDULED_DELIVERY_ERROR:', row.id, error.message)
      const deadline = Number(parseJson(row.forward_request, {})?.deadline) || null
      outcome = await markRetry(row, error.message, deadline)
    }

    result[outcome.outcome]?.push(outcome)
  }

  return result
}
