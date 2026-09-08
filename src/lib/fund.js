// Shared client helpers for Hup Fund — status derivation, progress math and formatting, used
// by the directory, the campaign page, the composer dialogs and the in-post card.

import { formatEther, parseEther } from 'viem'
import { parseJsonArray, toRelative } from '@/lib/predict'

// Re-exported rather than copied: campaigns read the same cidex-written JSON columns and the
// same unix-second timestamps polls and markets do, so a second implementation would only drift.
export { parseJsonArray, toRelative }

// Mirrors HupFund.sol — the composer must never offer a shape the contract will reject.
export const MIN_FUND_DURATION_SECONDS = 3600
export const MAX_FUND_DURATION_SECONDS = 180 * 24 * 3600
export const MAX_FUND_MEMO_BYTES = 256
// How long after backing ends the creator has to withdraw before anyone may open refunds
export const CLAIM_WINDOW_SECONDS = 90 * 24 * 3600

/** Duration presets for the composer, shortest first. */
export const FUND_DURATIONS = [
  { label: '1 day', seconds: 24 * 3600 },
  { label: '3 days', seconds: 3 * 24 * 3600 },
  { label: '7 days', seconds: 7 * 24 * 3600 },
  { label: '14 days', seconds: 14 * 24 * 3600 },
  { label: '30 days', seconds: 30 * 24 * 3600 },
  { label: '60 days', seconds: 60 * 24 * 3600 },
]

// People think in dollars, not in a gas token they may never have held
export const BACK_PRESETS_USD = [5, 10, 25, 100]

export const MAX_FUND_TITLE_LENGTH = 120
export const MAX_FUND_DESCRIPTION_LENGTH = 2000
export const MAX_FUND_FAQ = 8
export const MAX_FUND_FAQ_LENGTH = 500

const countFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const percentFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const amountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 })
const compactAmountFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 })
const usdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usdCentsFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })

/** "1.2K" for a backer count. */
export const formatBackers = (count) => countFormatter.format(Number(count) || 0)

/** "43%" for progress toward the goal. */
export const formatPercent = (percent) => `${percentFormatter.format(Number(percent) || 0)}%`

/** A wei figure as BigInt, tolerating the strings and nulls the API hands over. */
export const toWei = (value) => {
  try {
    return BigInt(value ?? 0)
  } catch {
    return 0n
  }
}

/**
 * Wei (as the string the indexer stores) to a whole-coin number. Precision past four decimals
 * is noise on a card, and Number is enough for anything a fundraiser realistically holds.
 */
export const weiToNumber = (wei) => {
  try {
    return Number(formatEther(toWei(wei)))
  } catch {
    return 0
  }
}

/** "25 LYX" — the amount the way the card and the toast both say it. */
export const formatAmount = (wei, symbol = '') => `${amountFormatter.format(weiToNumber(wei))} ${symbol}`.trim()

/** "1.5K LYX" — for the tight goal/raised readout where four decimals would not fit. */
export const formatCompactAmount = (wei, symbol = '') => `${compactAmountFormatter.format(weiToNumber(wei))} ${symbol}`.trim()

/**
 * A dollar figure for an amount, given the coin's price. Whole dollars past $100, cents
 * below — a $4.50 backing rendered as "$5" would misreport what someone sent.
 * @returns {string|null} Null when the chain has no market price.
 */
export const formatUsd = (wei, price) => {
  if (!price) return null
  const value = weiToNumber(wei) * price
  return (value >= 100 ? usdFormatter : usdCentsFormatter).format(value)
}

/** A whole-dollar figure the way the presets and the target line print it. */
export const formatUsdRound = (value) => usdFormatter.format(Number(value) || 0)

/**
 * The native amount a dollar figure buys, as a string parseEther accepts. Eight decimals is
 * finer than any backing needs and never hits parseEther's 18-place limit.
 * @returns {string|null} Null without a price or a positive figure.
 */
export const usdToNative = (usd, price) => {
  if (!price || !Number.isFinite(usd) || usd <= 0) return null
  return (usd / price).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

/** Wei for a native amount typed by a person, or null when it does not parse. */
export const nativeToWei = (native) => {
  try {
    const wei = parseEther(String(native))
    return wei > 0n ? wei : null
  } catch {
    return null
  }
}

/**
 * Progress toward the goal, uncapped: an overfunded campaign reads 140%, and the bar is the
 * one thing that clamps. Measured on what was raised, not on what is still held — a refund
 * does not un-happen the campaign.
 */
export const fundProgress = (campaign) => {
  const goal = weiToNumber(campaign?.goal)
  if (goal <= 0) return 0
  return (weiToNumber(campaign?.raised) / goal) * 100
}

/** True once the creator has switched the campaign to refunds. One way. */
export const isRefunding = (campaign) => Number(campaign?.refunding || 0) === 1

/** True once the creator has taken the pot. */
export const isWithdrawn = (campaign) => Number(campaign?.withdrawn_at || 0) > 0

/** Unix seconds backing ended, or 0 while it still runs its window. */
export const fundEndedAt = (campaign) => {
  const now = Math.floor(Date.now() / 1000)
  const closedAt = Number(campaign?.closed_at || 0)
  if (closedAt > 0) return closedAt
  const closesAt = Number(campaign?.closes_at || 0)
  return closesAt <= now ? closesAt : 0
}

/**
 * Derives a display status from an indexed campaign row, in the order the money settles: a
 * refunding campaign is refunding whatever its clock says, a withdrawn one is paid out, then
 * ended, then open. Reaching the goal is not a status — it is a fact about the number.
 */
export const fundStatus = (campaign) => {
  if (isRefunding(campaign)) return { key: 'refunding', label: 'Refunding' }
  if (isWithdrawn(campaign)) return { key: 'withdrawn', label: 'Paid out' }
  if (fundEndedAt(campaign) > 0) return { key: 'closed', label: 'Ended' }
  return { key: 'open', label: 'Open' }
}

/** True while the contract would still accept a backing on this campaign. */
export const isFundOpen = (campaign) => fundStatus(campaign).key === 'open'

/** True once raised has met the goal. */
export const isFunded = (campaign) => {
  const goal = toWei(campaign?.goal)
  return goal > 0n && toWei(campaign?.raised) >= goal
}

/** True when the creator could withdraw the pot right now — mirrors HupFund.canWithdraw. */
export const canWithdrawFund = (campaign) =>
  !isRefunding(campaign) && !isWithdrawn(campaign) && fundEndedAt(campaign) > 0 && toWei(campaign?.raised) > 0n

/**
 * True once anyone, not only the creator, may open refunds: the pot has sat unclaimed past
 * the claim window after backing ended. The safety valve for a creator who disappears.
 */
export const canForceRefunds = (campaign) => {
  if (isRefunding(campaign) || isWithdrawn(campaign)) return false
  const endedAt = fundEndedAt(campaign)
  return endedAt > 0 && Math.floor(Date.now() / 1000) >= endedAt + CLAIM_WINDOW_SECONDS
}

/** Wei the contract still holds for a campaign: raised, less what was refunded or paid out. */
export const heldAmount = (campaign) => {
  if (isWithdrawn(campaign)) return 0n
  const held = toWei(campaign?.raised) - toWei(campaign?.refunded)
  return held > 0n ? held : 0n
}

/** What a refund claim would return a viewer: what they gave, less what they already took back. */
export const refundableFor = (backed, refunded) => {
  const left = toWei(backed) - toWei(refunded)
  return left > 0n ? left : 0n
}

/**
 * The tone the progress readout takes, from how far along it is: the card's fill goes from
 * the alarm colour through amber to green as the goal comes into reach.
 */
export const progressTone = (percent) => {
  if (percent >= 100) return 'funded'
  if (percent >= 50) return 'halfway'
  if (percent >= 20) return 'started'
  return 'early'
}

/** The campaign's FAQ as `{ question, answer }` pairs, or [] when the creator wrote none. */
export const fundFaq = (campaign) =>
  parseJsonArray(campaign?.faq).filter((entry) => entry && typeof entry.question === 'string' && typeof entry.answer === 'string')

/**
 * The memo a backer attached, decoded from the hex bytes the event carried. Anything that is
 * not UTF-8 text renders as nothing rather than as mojibake.
 */
export const decodeMemo = (memo) => {
  if (!memo || memo === '0x') return ''
  if (!/^0x[0-9a-fA-F]*$/.test(memo)) return String(memo)
  try {
    const bytes = new Uint8Array(memo.slice(2).match(/.{1,2}/g).map((pair) => parseInt(pair, 16)))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
  } catch {
    return ''
  }
}

/** UTF-8 text to the hex bytes the contract's memo parameter takes. */
export const encodeMemo = (text) => {
  const bytes = new TextEncoder().encode(String(text ?? '').trim())
  if (bytes.length === 0) return '0x'
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** Byte length of a memo as the contract will measure it. */
export const memoByteLength = (text) => new TextEncoder().encode(String(text ?? '').trim()).length
