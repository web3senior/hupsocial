import { formatUnits } from 'viem'
import { appChains } from '@/config/contracts'
import { communityProposalPath } from '@/lib/communityGovernance'

const BINARY_OPTIONS = ['No', 'Yes', 'Abstain']
const BINARY_FOR = 1

export const chainNameFor = (chainId) => appChains.find((chain) => chain.id === Number(chainId))?.name || `#${chainId}`

export const shortAddress = (address) => (address ? `${String(address).slice(0, 6)}…${String(address).slice(-4)}` : '')

export const sameAddress = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase()

const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const percentFormatter = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/**
 * Voting power as a compact number. Values are whole member votes by default.
 * @param {bigint|number|string} value Raw onchain amount.
 * @param {number} [decimals] Decimals; community ballots use 0.
 */
export const formatPower = (value, decimals = 0) => {
  const raw = BigInt(value ?? 0)
  const whole = decimals > 0 ? Number(formatUnits(raw, decimals)) : Number(raw)
  return compactFormatter.format(whole)
}

/** A 0–1 share as "42.5%". */
export const formatShare = (share) => percentFormatter.format(Number.isFinite(share) ? share : 0)

/** Unix seconds as "Oct 16, 2026, 3:20 PM". */
export const formatWhen = (unixSeconds) => (Number(unixSeconds) > 0 ? dateTimeFormatter.format(new Date(Number(unixSeconds) * 1000)) : '—')

const RELATIVE_UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** Unix seconds as "in 3 days" / "2 hours ago". */
export const formatRelative = (unixSeconds) => {
  const delta = Number(unixSeconds) - Math.floor(Date.now() / 1000)
  const abs = Math.abs(delta)
  const [unit, size] = RELATIVE_UNITS.find(([, seconds]) => abs >= seconds) ?? ['second', 1]
  return relativeFormatter.format(Math.round(delta / size), unit)
}

/** Option labels for a proposal: the three binary slots, or the choices its metadata names. */
export const optionLabels = (proposal, metadata) => {
  const count = Number(proposal?.optionCount ?? 0)
  if (count === 0) return BINARY_OPTIONS

  const named = Array.isArray(metadata?.options) ? metadata.options : []
  return Array.from({ length: count }, (_, index) => {
    const label = named[index]
    return typeof label === 'string' && label.trim() ? label.trim() : `Option ${index + 1}`
  })
}

/**
 * Tally rows with shares of the votes cast. The leader is the option that would carry the
 * proposal: For on a binary vote (only if it beats Against), the unique top option otherwise.
 */
export const tallyRows = (proposal, tallies, labels) => {
  const counts = (tallies ?? []).map((value) => BigInt(value ?? 0))
  const total = counts.reduce((sum, value) => sum + value, 0n)
  const isBinary = Number(proposal?.optionCount ?? 0) === 0

  let leader = -1
  if (isBinary) {
    if ((counts[BINARY_FOR] ?? 0n) > (counts[0] ?? 0n)) leader = BINARY_FOR
  } else {
    const top = counts.reduce((max, value) => (value > max ? value : max), 0n)
    const atTop = counts.filter((value) => value === top).length
    if (top > 0n && atTop === 1) leader = counts.indexOf(top)
  }

  return labels.map((label, index) => {
    const votes = counts[index] ?? 0n
    return {
      label,
      votes,
      share: total > 0n ? Number((votes * 10_000n) / total) / 10_000 : 0,
      isLeader: index === leader,
    }
  })
}

export const proposalPath = (ref) => communityProposalPath(ref.chainId, ref.communityId, ref.proposalId)

export const parseProposalLink = (text) => {
  const match = String(text || '').trim().match(/\/communities\/(\d+)\/([1-9]\d*)\/proposals\/([1-9]\d*)\/?(?:[?#].*)?$/)
  return match ? { chainId: Number(match[1]), communityId: match[2], proposalId: match[3] } : null
}

/** "1 vote" / "2.5K votes" — the count with its noun. */
export const votesLabel = (value, decimals = 0) => {
  const text = formatPower(value, decimals)
  return `${text} ${text === '1' ? 'vote' : 'votes'}`
}
