// Shared client helpers for Hup DAOs — contract mirrors, formatting and tally math, used by the
// directory, the DAO page and the proposal page.

import { formatUnits } from 'viem'
import { CONTRACTS, appChains } from '@/config/contracts'
import { communityProposalPath } from '@/lib/communityGovernance'

// Mirrors HupDao.sol. Enum order is the wire format, so entries may only ever be appended.
export const VOTING_MODE = { Staked: 0, VotesToken: 1, Members: 2 }

// User-facing copy says "group" for a DAO and avoids governance jargon (quorum, stake,
// delegate) — the section is meant to read plainly to people who have never used one.
export const VOTING_MODE_OPTIONS = [
  {
    value: VOTING_MODE.Staked,
    label: 'Token holders (lock to vote)',
    tag: 'Token',
    note: 'People lock a token (ERC20 or LSP7) to get votes: 1 token = 1 vote. They can unlock any time.',
  },
  {
    value: VOTING_MODE.VotesToken,
    label: 'Token holders (voting token)',
    tag: 'Voting token',
    note: 'For tokens that already count votes (ERC20Votes or LSP7Votes). Holding the token is enough.',
  },
  {
    value: VOTING_MODE.Members,
    label: 'Members you choose',
    tag: 'Members',
    note: 'One person, one vote. You decide who is in, and can add or remove people later.',
  },
]

export const PROPOSAL_STATES = [
  { key: 'pending', label: 'Upcoming' },
  { key: 'active', label: 'Voting' },
  { key: 'defeated', label: 'Rejected' },
  { key: 'succeeded', label: 'Passed' },
  { key: 'canceled', label: 'Canceled' },
]

// Binary proposals (optionCount 0) tally into these slots, in this order
export const BINARY_OPTIONS = ['No', 'Yes', 'Abstain']
export const BINARY_FOR = 1
export const BINARY_ABSTAIN = 2

export const MIN_PROPOSAL_OPTIONS = 2
export const MAX_PROPOSAL_OPTIONS = 8
export const MIN_VOTING_PERIOD_SECONDS = 3600
export const MAX_VOTING_PERIOD_SECONDS = 90 * 24 * 3600
export const MAX_VOTING_DELAY_SECONDS = 30 * 24 * 3600
export const MAX_MEMBER_BATCH = 100
export const MAX_BPS = 10_000
export const MAX_REASON_LENGTH = 1024
export const PAGE_SIZE = 20

export const VOTING_PERIODS = [
  { label: '1 day', seconds: 24 * 3600 },
  { label: '3 days', seconds: 3 * 24 * 3600 },
  { label: '5 days', seconds: 5 * 24 * 3600 },
  { label: '7 days', seconds: 7 * 24 * 3600 },
  { label: '14 days', seconds: 14 * 24 * 3600 },
]

export const VOTING_DELAYS = [
  { label: 'Right away', seconds: 0 },
  { label: 'After 1 hour', seconds: 3600 },
  { label: 'After 1 day', seconds: 24 * 3600 },
  { label: 'After 2 days', seconds: 2 * 24 * 3600 },
]

/** Chains where HupDao is deployed. */
export const daoChains = () => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.dao)

/** HupDao's address on a chain, or '' where it isn't deployed. */
export const daoAddressFor = (chainId) => CONTRACTS[`chain${chainId}`]?.dao || ''

export const chainNameFor = (chainId) => appChains.find((chain) => chain.id === Number(chainId))?.name || `#${chainId}`

export const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(String(value || '').trim())

export const shortAddress = (address) => (address ? `${String(address).slice(0, 6)}…${String(address).slice(-4)}` : '')

export const sameAddress = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase()

const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const percentFormatter = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/**
 * Voting power as a compact number. Staked and votes-token DAOs count in token base units, so
 * they divide by the token's decimals first; a Members DAO counts whole votes.
 * @param {bigint|number|string} value Raw onchain amount.
 * @param {number} [decimals] Token decimals; 0 for Members mode.
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

/** { key, label } for the uint8 the contract's state() returns. */
export const proposalStatus = (stateValue) => PROPOSAL_STATES[Number(stateValue)] ?? PROPOSAL_STATES[0]

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

/** Votes that count toward quorum ("must vote" in the UI) — For + Abstain on a binary vote, every ballot otherwise. */
export const quorumCounted = (proposal, tallies) => {
  const counts = (tallies ?? []).map((value) => BigInt(value ?? 0))
  if (Number(proposal?.optionCount ?? 0) === 0) return (counts[BINARY_FOR] ?? 0n) + (counts[BINARY_ABSTAIN] ?? 0n)
  return counts.reduce((sum, value) => sum + value, 0n)
}

/** Parses a free-form address list (newline, comma or space separated), deduped, lowercased. */
export const parseAddressList = (text) => [
  ...new Set(
    String(text || '')
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => isAddress(entry)),
  ),
]

/** The page a proposal lives on, from a post's { chainId, daoId, proposalId } reference. */
export const proposalPath = (ref) => ref.communityId
  ? communityProposalPath(ref.chainId, ref.communityId, ref.proposalId)
  : `/proposals/${ref.chainId}/${ref.daoId}/${ref.proposalId}`

/**
 * A pasted proposal link — full URL or bare path, any host — as the reference a post stores.
 * @param {string} text
 * @returns {{chainId: number, daoId?: string, communityId?: string, proposalId: string}|null}
 */
export const parseProposalLink = (text) => {
  const value = String(text || '').trim()
  const community = value.match(/\/communities\/(\d+)\/([1-9]\d*)\/proposals\/([1-9]\d*)\/?(?:[?#].*)?$/)
  if (community) return { chainId: Number(community[1]), communityId: community[2], proposalId: community[3] }
  const match = value.match(/\/proposals\/(\d+)\/([1-9]\d*)\/([1-9]\d*)\/?(?:[?#].*)?$/)
  if (!match) return null
  return { chainId: Number(match[1]), daoId: match[2], proposalId: match[3] }
}

/** Plain-language summary of a DAO's rules, for the settings line on its page. */
export const describeSettings = (settings, decimals = 0) => {
  if (!settings) return []
  const period = Number(settings.votingPeriod)
  const delay = Number(settings.votingDelay)
  const days = (seconds) => (seconds % 86400 === 0 ? `${seconds / 86400}d` : `${Math.round(seconds / 3600)}h`)

  const threshold = BigInt(settings.proposalThreshold ?? 0)

  return [
    `Voting lasts ${days(period)}`,
    delay > 0 ? `Voting opens ${days(delay)} after posting` : 'Voting opens right away',
    `${formatShare(Number(settings.quorumBps) / MAX_BPS)} must vote`,
    threshold > 0n ? `${votesLabel(threshold, decimals)} needed to post` : 'Anyone can post',
  ]
}

/** "1 vote" / "2.5K votes" — the count with its noun. */
export const votesLabel = (value, decimals = 0) => {
  const text = formatPower(value, decimals)
  return `${text} ${text === '1' ? 'vote' : 'votes'}`
}
