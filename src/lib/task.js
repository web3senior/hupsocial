// Shared client helpers for Hup Tasks: the contract's limits, status derivation and formatting,
// used by the composer dialog, the in-post card, the review dialog and the /tasks directory.

import { formatUnits, parseUnits } from 'viem'
import { toRelative } from '@/lib/predict'
import { TIP_TOKENS } from '@/lib/tokens'
import { appChains } from '@/config/contracts'

export { toRelative }

// Mirrors HupTasks.sol — the composer must never offer a shape the contract will reject.
export const MIN_TASK_DURATION_SECONDS = 3600
export const MAX_TASK_DURATION_SECONDS = 90 * 24 * 3600
export const MAX_TASK_SLOTS = 1000
export const MAX_APPROVAL_BATCH = 50
export const MAX_CATEGORY_BYTES = 32
export const MAX_RATING = 100
export const DEFAULT_RATING = 100

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const TASK_CATEGORIES = [
  { slug: 'translate', label: 'Translate' },
  { slug: 'summarize', label: 'Summarize' },
  { slug: 'write', label: 'Write' },
  { slug: 'design', label: 'Design' },
  { slug: 'research', label: 'Research' },
  { slug: 'code', label: 'Code' },
  { slug: 'data', label: 'Data' },
  { slug: 'review', label: 'Review' },
  { slug: 'other', label: 'Other' },
]

export const TASK_DURATIONS = [
  { label: '1 day', seconds: 24 * 3600 },
  { label: '3 days', seconds: 3 * 24 * 3600 },
  { label: '7 days', seconds: 7 * 24 * 3600 },
  { label: '14 days', seconds: 14 * 24 * 3600 },
  { label: '30 days', seconds: 30 * 24 * 3600 },
]

export const categoryLabel = (slug) => TASK_CATEGORIES.find((entry) => entry.slug === slug)?.label ?? slug

/** Normalizes a free-typed category into the contract's 1-32 byte label. */
export const normalizeCategory = (value) => {
  const slug = String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
  const bytes = new TextEncoder().encode(slug)
  return bytes.length > MAX_CATEGORY_BYTES ? new TextDecoder().decode(bytes.slice(0, MAX_CATEGORY_BYTES)).replace(/�$/, '') : slug
}

/** Native coin plus the chain's curated ERC20/LSP7 tokens. */
export const paymentOptionsFor = (chainId) => {
  const chain = appChains.find((entry) => entry.id === Number(chainId))
  const native = { symbol: chain?.nativeCurrency?.symbol ?? 'ETH', address: ZERO_ADDRESS, decimals: chain?.nativeCurrency?.decimals ?? 18, lsp7: false }
  const tokens = (TIP_TOKENS[Number(chainId)] ?? []).map((token) => ({ symbol: token.symbol, address: token.address, lsp7: Boolean(token.lsp7), decimals: null }))
  return [native, ...tokens]
}

export const isNativeToken = (address) => !address || String(address).toLowerCase() === ZERO_ADDRESS

export const toBigInt = (value) => {
  try {
    return BigInt(value ?? 0)
  } catch {
    return 0n
  }
}

const amountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 })
const smallAmountFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 })
const countFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

/** "2.5 USDC" from base units. */
export const formatTokenAmount = (units, decimals = 18, symbol = '') => {
  let value = 0
  try {
    value = Number(formatUnits(toBigInt(units), Number(decimals ?? 18)))
  } catch {
    value = 0
  }
  const text = value > 0 && value < 1 ? smallAmountFormatter.format(value) : amountFormatter.format(value)
  return `${text} ${symbol}`.trim()
}

export const formatCount = (count) => countFormatter.format(Number(count) || 0)

/** Base units for a typed amount, or null when it does not parse to something positive. */
export const parseTokenAmount = (text, decimals = 18) => {
  try {
    const units = parseUnits(String(text).trim(), Number(decimals ?? 18))
    return units > 0n ? units : null
  } catch {
    return null
  }
}

export const slotsLeft = (task) => Math.max(0, Number(task?.slots || 0) - Number(task?.paid_slots || 0))

/** What the task still holds for unpaid slots, fee included; zero once closed. */
export const escrowRemaining = (task) => {
  if (!task || Number(task.closed_at || 0) > 0) return 0n
  return BigInt(slotsLeft(task)) * (toBigInt(task.reward_per_slot) + toBigInt(task.fee_per_slot))
}

/**
 * Display status, in the order the money settles. `awaiting` is an unfunded post that promises
 * a task; `reviewing` is past its deadline with slots still unpaid, which the poster can still
 * approve until they reclaim.
 */
export const taskStatus = (task) => {
  if (!task) return { key: 'awaiting', label: 'Not started', tone: 'idle' }
  if (task.closed_reason === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'cancelled' }
  if (task.closed_reason === 'reclaimed') return { key: 'closed', label: 'Closed', tone: 'idle' }
  if (slotsLeft(task) === 0) return { key: 'filled', label: 'Filled', tone: 'approved' }
  if (Number(task.deadline) <= Math.floor(Date.now() / 1000)) return { key: 'reviewing', label: 'In review', tone: 'review' }
  return { key: 'open', label: 'In progress', tone: 'progress' }
}

/** A submission's state, for the review list and the sealed-reply block. */
export const submissionStatus = (payout) => (payout ? { tone: 'approved', label: 'Approved' } : { tone: 'pending', label: 'Pending' })

export const isTaskOpenForSubmissions = (task) => taskStatus(task).key === 'open'

export const canReclaim = (task) => Boolean(task) && !task.closed_reason && Number(task.deadline) <= Math.floor(Date.now() / 1000)

/** The post content's task reference, if the post was published with one. */
export const taskRefOf = (content) => {
  const ref = content?.hupTask
  return ref && typeof ref === 'object' && ref.chainId ? ref : null
}

/** The sealed envelope a submission reply carries, if any. */
export const sealedSubmissionOf = (content) => {
  const envelope = content?.taskSubmission
  return envelope && typeof envelope === 'object' && envelope.ciphertext && envelope.wrappedKey ? envelope : null
}

export const SEALED_PLACEHOLDER = '🔒 Sealed task submission'

// LSP7 is operator-based: authorizedAmountFor(operator, owner) where ERC20 has allowance(owner, spender)
export const lsp7OperatorAbi = [
  {
    type: 'function',
    name: 'authorizedAmountFor',
    stateMutability: 'view',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'tokenOwner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'authorizeOperator',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'operatorNotificationData', type: 'bytes' },
    ],
    outputs: [],
  },
]

export const taskHref = (networkId, postId) => `/networks/${Number(networkId)}/${postId}`
