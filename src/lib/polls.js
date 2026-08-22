// Shared client helpers for Hup Polls — status derivation and tally math, used by the
// directory, the poll detail page, and the in-post card.

import { parseJsonArray, toRelative } from '@/lib/predict'

// Re-exported rather than copied: polls and markets read the same cidex-written JSON columns
// and the same unix-second timestamps, so two implementations would only drift.
export { parseJsonArray, toRelative }

// Mirrors HupPolls.sol — the composer must never offer a shape the contract will reject.
export const MIN_POLL_OPTIONS = 2
export const MAX_POLL_OPTIONS = 8
export const MIN_POLL_DURATION_SECONDS = 5 * 60
export const MAX_POLL_DURATION_SECONDS = 180 * 24 * 3600

// Mirrors HupPolls.sol's RequirementType enum — order is the wire format, so entries may only
// ever be appended.
export const REQUIREMENT_TYPE = {
  NativeBalance: 0,
  TokenBalance: 1,
  NftBalance: 2,
  Allowlisted: 3,
  FollowsCreator: 4,
  CommunityMember: 5,
}

export const REQUIREMENT_MODE = { AllOf: 0, AnyOf: 1 }

export const MAX_POLL_REQUIREMENTS = 3

/** Duration presets for the composer, shortest first. Custom windows go through the date field. */
export const POLL_DURATIONS = [
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 6 * 3600 },
  { label: '1 day', seconds: 24 * 3600 },
  { label: '3 days', seconds: 3 * 24 * 3600 },
  { label: '7 days', seconds: 7 * 24 * 3600 },
]

const votesFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const shareFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/** "1.2K" for a ballot count. */
export const formatVotes = (count) => votesFormatter.format(Number(count) || 0)

/** "43%" for a share of the vote. */
export const formatShare = (share) => `${shareFormatter.format(Number(share) || 0)}%`

/**
 * Derives a display status from an indexed poll row. `closed_at` is non-zero only when the
 * creator ended voting early; every other poll simply runs out its window.
 */
export const pollStatus = (poll) => {
  const now = Math.floor(Date.now() / 1000)
  const closedEarly = Number(poll?.closed_at || 0) > 0

  if (closedEarly || Number(poll?.closes_at || 0) <= now) return { key: 'closed', label: 'Final results' }
  if (Number(poll?.opens_at || 0) > now) return { key: 'upcoming', label: 'Opens soon' }

  return { key: 'open', label: 'Open' }
}

/** True while the contract would still accept a ballot on this poll. */
export const isPollOpen = (poll) => pollStatus(poll).key === 'open'

/**
 * True once the API has actually served per-option counts. It withholds them from a viewer
 * who hasn't voted on a running poll, and there is also a gap right after voting where the
 * ballot exists onchain but the indexer hasn't caught up — in both cases the tallies come
 * back null, and a caller that assumed an array would paint a confident 0% for every option.
 */
export const hasTallies = (poll) => parseJsonArray(poll?.tallies).length > 0

const shortAddress = (address) => (address ? `${String(address).slice(0, 6)}…${String(address).slice(-4)}` : '')

/** A poll's requirement list as objects, or [] for the ungated majority. */
export const pollRequirements = (poll) => parseJsonArray(poll?.requirements)

/** True when a poll narrows who may vote at all. */
export const isPollGated = (poll) => pollRequirements(poll).length > 0

/**
 * A one-line description of a requirement, for the "who can vote" line on a card.
 *
 * Derived from the onchain entry, never from creator-supplied copy: a label saying "hold 1
 * token" over a requirement demanding a thousand would send people to a vote button that
 * refuses them. Token amounts are the one thing this can't decode — decimals live in the
 * token contract — so they render in raw units with the asset address, which is at least
 * true. The composer is what should keep humans from meeting one of these.
 * @param {Object} requirement One entry of pollRequirements().
 * @param {string} [nativeSymbol] The chain's native currency symbol.
 * @returns {string} Human-readable condition.
 */
export const describeRequirement = (requirement, nativeSymbol = '') => {
  const min = requirement?.minBalance ?? '0'

  switch (Number(requirement?.rType)) {
    case REQUIREMENT_TYPE.NativeBalance:
      return `Hold ${formatUnitsLoose(min, 18)} ${nativeSymbol}`.trim()
    case REQUIREMENT_TYPE.TokenBalance:
      return `Hold ${min} units of ${shortAddress(requirement.asset)}`
    case REQUIREMENT_TYPE.NftBalance:
      return `Own ${Number(min) || 1} from ${shortAddress(requirement.asset)}`
    case REQUIREMENT_TYPE.Allowlisted:
      return 'Be on the poll’s list'
    case REQUIREMENT_TYPE.FollowsCreator:
      return 'Follow the creator'
    case REQUIREMENT_TYPE.CommunityMember:
      return `Be a member of community #${min}`
    default:
      return 'Meet the creator’s condition'
  }
}

// What a gate is called, by the requirement that defines it. Ordered by how strongly each
// type narrows the electorate, so a poll with several shows the tightest one.
const GATE_NAMES = [
  [REQUIREMENT_TYPE.Allowlisted, 'Invite only'],
  [REQUIREMENT_TYPE.CommunityMember, 'Members only'],
  [REQUIREMENT_TYPE.TokenBalance, 'Only Holders'],
  [REQUIREMENT_TYPE.NftBalance, 'Only Holders'],
  [REQUIREMENT_TYPE.NativeBalance, 'Only Holders'],
  [REQUIREMENT_TYPE.FollowsCreator, 'Followers only'],
]

/**
 * The chips shown under a gated poll's question: one naming the kind of gate, then one per
 * condition. Empty for an ungated poll, which is most of them.
 *
 * Condition text prefers the label the composer wrote into the poll's metadata, because that
 * is the only place a token's symbol and decimals are known without an extra chain read —
 * `requirements` carries raw units. The label is display only: eligibility is decided by the
 * contract, so a wrong one can misstate the reason a voter is refused but never the outcome.
 * @param {Object} poll Indexed poll row.
 * @param {string} [nativeSymbol] The chain's native currency symbol.
 * @returns {Array<{label: string, tone: 'gate'|'condition'}>}
 */
export const requirementChips = (poll, nativeSymbol = '') => {
  const requirements = pollRequirements(poll)
  if (requirements.length === 0) return []

  const types = new Set(requirements.map((requirement) => Number(requirement.rType)))
  const gateName = GATE_NAMES.find(([type]) => types.has(type))?.[1] ?? 'Restricted'
  const labels = parseJsonArray(poll?.requirement_labels)

  return [
    { label: gateName, tone: 'gate' },
    ...requirements.map((requirement, index) => ({
      label: typeof labels[index] === 'string' && labels[index] ? labels[index] : describeRequirement(requirement, nativeSymbol),
      tone: 'condition',
    })),
  ]
}

// Enough to render 18-decimal amounts without pulling in a formatter — trailing zeros go, and
// a value too large for Number stays a string rather than becoming 1.0000000000000002e+21.
const formatUnitsLoose = (value, decimals) => {
  const raw = String(value)
  if (raw.length <= decimals) return `0.${raw.padStart(decimals, '0')}`.replace(/\.?0+$/, '') || '0'

  const whole = raw.slice(0, raw.length - decimals)
  const fraction = raw.slice(raw.length - decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

/**
 * Merges an indexed poll's labels and tallies into one array the UI can render directly.
 * Ties keep every joint leader flagged — a card that crowned one of them would be lying
 * about a result the chain reports as level.
 * @param {Object} poll Indexed poll row from /api/v1/polls.
 * @returns {Array<{index: number, label: string, emoji: string|null, votes: number, share: number, isLeader: boolean}>}
 */
export const pollOptions = (poll) => {
  const labels = parseJsonArray(poll?.option_labels)
  const counts = parseJsonArray(poll?.tallies)
  const total = Number(poll?.total_votes || 0)
  const length = Number(poll?.option_count) || labels.length

  const options = Array.from({ length }, (_, index) => {
    const votes = Number(counts[index] ?? 0)

    return {
      index,
      label: labels[index]?.label || `Option ${index + 1}`,
      emoji: labels[index]?.emoji || null,
      votes,
      share: total > 0 ? (votes / total) * 100 : 0,
      isLeader: false,
    }
  })

  const top = Math.max(0, ...options.map((option) => option.votes))
  if (top > 0) {
    for (const option of options) option.isLeader = option.votes === top
  }

  return options
}
