/**
 * @file lib/relayGasless.js
 * @description Trial gasless path for the one action we sponsor: creating content (posts,
 * replies, quotes). Instead of prompting for a transaction, the app signs an ERC-2771
 * ForwardRequest and posts it to /api/v1/relay, where our relayer pays the gas. Deliberately
 * self-contained: the experiment reverts by deleting this file plus its call sites in
 * components/NewPost.jsx and the settings toggle.
 *
 * Likes are NOT sponsored and keep using the batch basket / the user's own key. Like and
 * unlike are a toggle, so one account tapping a heart could drain the relayer without limit.
 *
 * Two signer paths, both ending in a plain ECDSA signature because OZ's ERC2771Forwarder
 * recovers with ECDSA and nothing else:
 *   1. Active session key — the burner signs and Hup._resolveActor maps it back to the
 *      owner through userSessions. This is the only path that works for Universal
 *      Profiles, since a contract account can never be `from` on the forwarder.
 *   2. No session — the connected wallet signs for itself. EOAs only.
 * Anything outside those two cases throws RELAY_UNSUPPORTED so the caller can fall back to
 * the basket or an ordinary transaction.
 */

import { ethers } from 'ethers'
import hupAbi from '@/abi/post.json'
import { CONTRACTS } from '@/config/contracts'
import { GASLESS_BUCKETS, formatWait, gaslessPolicyFor } from '@/config/gasless'
import { getBurnerSignerSilent } from '@/lib/burnerSession'

const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''

export const localStorageGaslessKey = `${prefix}gasless_enabled`

// Trial default for users who never touched the toggle. Flip to false to park the
// experiment for everyone without editing any call site.
export const GASLESS_DEFAULT = true

// Ethereum mainnet is excluded by default — an L1 post is real money every time.
const EXCLUDED_CHAIN_IDS = [1]

// Forwarder overhead plus the call itself: `create` stores a struct and a CID string. The
// relay route adds its own headroom for the outer transaction.
const RELAY_GAS = {
  create: 600000n,
}

// Sponsored actions are fire-and-forget, so a request has no reason to stay signable for long
const RELAY_DEADLINE_SECONDS = 300

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
}

const unsupported = (message) => {
  const error = new Error(message)
  error.code = 'RELAY_UNSUPPORTED'
  return error
}

// A cooldown is a deliberate answer, not a relay failure — callers surface it instead of
// quietly falling back to a path that charges the user.
const throttled = (retryAfter) => {
  const error = new Error(`Slow down — you can do that again in ${formatWait(retryAfter)}.`)
  error.code = 'RELAY_COOLDOWN'
  error.retryAfter = retryAfter
  return error
}

// Local mirror of the server's throttle, so an early tap costs no round trip. Holds the epoch
// ms the account is free again, set from our own cooldown after a success and from the
// server's Retry-After when it turns one down.
const waitKey = (bucket, chainId, owner) => `${prefix}gasless_wait_${bucket}_${chainId}_${owner.toLowerCase()}`

const remainingCooldown = (bucket, chainId, owner) => {
  if (typeof window === 'undefined') return 0

  const blockedUntil = Number(localStorage.getItem(waitKey(bucket, chainId, owner))) || 0
  const remaining = blockedUntil - Date.now()
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0
}

const holdUntil = (bucket, chainId, owner, ms) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(waitKey(bucket, chainId, owner), String(Date.now() + ms))
}

// Optional deploy-time override, e.g. NEXT_PUBLIC_GASLESS_CHAINS="42,143,8453".
// Absent, every configured chain except the exclusions above is sponsored.
const chainAllowlist = () => {
  const raw = process.env.NEXT_PUBLIC_GASLESS_CHAINS
  if (!raw) return null

  const ids = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)

  return ids.length > 0 ? ids : null
}

/**
 * True when the network has both a forwarder and a Hup contract configured and is not
 * excluded from the trial. Adding a chain to config/contracts.js is all the app needs —
 * the chain still has to trust the forwarder onchain and the relayer still needs funding.
 */
export const isGaslessChain = (networkId) => {
  const id = Number(networkId)
  if (!id) return false

  const contracts = CONTRACTS[`chain${id}`]
  if (!contracts?.forwarder || !contracts?.hup) return false

  const allowlist = chainAllowlist()
  return allowlist ? allowlist.includes(id) : !EXCLUDED_CHAIN_IDS.includes(id)
}

/** Reads the user's stored preference, falling back to the trial default. */
export const readGaslessPreference = () => {
  if (typeof window === 'undefined') return GASLESS_DEFAULT

  const stored = localStorage.getItem(localStorageGaslessKey)
  return stored === null ? GASLESS_DEFAULT : stored === 'true'
}

/** Preference plus chain support — the single check call sites make. */
export const isGaslessEnabled = (networkId) => {
  if (typeof window === 'undefined') return false
  return isGaslessChain(networkId) && readGaslessPreference()
}

/**
 * Seconds the account must wait before the relayer sponsors `functionName` again, or 0 when
 * it is free to go. Call sites use this to bail before any expensive work (an IPFS pin, an
 * optimistic update) rather than discovering the cooldown at the end of the flow.
 */
export const gaslessCooldown = (functionName, networkId, owner) => {
  const bucket = GASLESS_BUCKETS[functionName]
  if (!bucket || !owner || !isGaslessEnabled(networkId)) return 0

  return remainingCooldown(bucket, Number(networkId), owner)
}

/**
 * Signs `functionName(...args)` against the chain's Hup contract as a ForwardRequest and
 * hands it to the relayer.
 *
 * @param {Object} params
 * @param {Object} params.chain Viem chain object for the target network (RPC + id).
 * @param {Object} params.publicClient Viem client on that same chain.
 * @param {string} params.owner Connected wallet — the account the action is attributed to.
 * @param {string} params.functionName Hup function to relay (create / batchLike / like).
 * @param {Array} params.args Arguments for that function, owner-first as Hup expects.
 * @param {Function} [params.signTypedDataAsync] wagmi signer, used when no session exists.
 * @param {boolean} [params.useSessionKey] Sign with the burner instead of the wallet.
 * @returns {Promise<string>} Relayed transaction hash.
 */
export const relayHupAction = async ({ chain, publicClient, owner, functionName, args, signTypedDataAsync, useSessionKey = false }) => {
  const chainId = Number(chain?.id)
  const contracts = CONTRACTS[`chain${chainId}`]
  const forwarderAddress = contracts?.forwarder
  const hupAddress = contracts?.hup
  const rpcUrl = chain?.rpcUrls?.default?.http?.[0]
  const gas = RELAY_GAS[functionName]
  const bucket = GASLESS_BUCKETS[functionName]

  if (!chainId || !forwarderAddress || !hupAddress || !rpcUrl) throw unsupported('Relay is not configured for this network')
  if (!publicClient || !owner) throw unsupported('Relay needs a connected wallet')
  if (!gas || !bucket) throw unsupported(`${functionName} is not a sponsored action`)

  // Checked before the signature prompt so a too-early tap never opens the wallet
  const waiting = remainingCooldown(bucket, chainId, owner)
  if (waiting > 0) throw throttled(waiting)

  const data = new ethers.Interface(hupAbi).encodeFunctionData(functionName, args)

  let from = null
  let sign = null

  if (useSessionKey) {
    // A locked vault or a missing key is not an error here — the caller still has the
    // wallet path to fall back on.
    let burner = null
    try {
      burner = getBurnerSignerSilent(chain)
    } catch (err) {
      throw unsupported(err.message)
    }

    from = burner.address
    sign = (domain, message) => burner.signTypedData(domain, FORWARD_REQUEST_TYPES, message)
  } else {
    if (typeof signTypedDataAsync !== 'function') throw unsupported('No signer available for the relay')

    // Universal Profiles and other contract accounts cannot be `from`: the forwarder
    // ECDSA-recovers the signer, which never matches a contract address. They reach the
    // relay through the session-key path above instead.
    const code = await publicClient.getCode({ address: owner }).catch(() => null)
    if (code && code !== '0x') throw unsupported('Smart account wallets need an active session key for gasless actions')

    from = owner
    sign = (domain, message) =>
      signTypedDataAsync({
        domain,
        types: FORWARD_REQUEST_TYPES,
        primaryType: 'ForwardRequest',
        message,
      })
  }

  const nonce = await publicClient.readContract({
    address: forwarderAddress,
    abi: [
      {
        inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
        name: 'nonces',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'nonces',
    args: [from],
  })

  const domain = {
    name: contracts.forwarderName ?? 'HupForwarder',
    version: '1',
    chainId,
    verifyingContract: forwarderAddress,
  }

  const message = {
    from,
    to: hupAddress,
    value: 0n,
    gas,
    nonce: BigInt(nonce),
    deadline: Math.floor(Date.now() / 1000) + RELAY_DEADLINE_SECONDS,
    data,
  }

  const signature = await sign(domain, message)

  const res = await fetch('/api/v1/relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: message, signature, rpcUrl, forwarderAddress, chainId, forwarderName: domain.name }, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  })

  const payload = await res.json().catch(() => ({}))

  // The server is authoritative on throttling — mirror its answer so the next tap
  // short-circuits locally instead of making the round trip again
  if (res.status === 429) {
    const retryAfter = Number(payload?.retryAfter) || Math.ceil(gaslessPolicyFor(bucket).cooldownMs / 1000)
    holdUntil(bucket, chainId, owner, retryAfter * 1000)
    throw throttled(retryAfter)
  }

  if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Relay failed')

  holdUntil(bucket, chainId, owner, gaslessPolicyFor(bucket).cooldownMs)

  return payload.txHash
}
