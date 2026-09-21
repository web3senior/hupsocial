/**
 * @file lib/premium.js
 * @description Shared helpers for Hup Premium — the plan table, what a subscription unlocks,
 * and the formatting the pricing page and the badge both need.
 *
 * Prices are native wei set per chain to hit one dollar target, so nothing here hardcodes an
 * amount: the figures come from the indexed `premium_plans` rows, which cidex writes from the
 * contract's own PlanUpdated logs. A client that assumed a price would be wrong the first time
 * an admin moved one.
 *
 * Imported by server routes as well as components, so it stays free of React and of anything
 * that reaches for `window`.
 */

import { formatUnits } from 'viem'

// The plan ids HupPremium seeds at construction. Admins may define others; these two are what
// the app sells, and the page looks them up by name rather than by position.
export const PLAN_MONTHLY = 1
export const PLAN_YEARLY = 2
export const PLAN_IDS = [PLAN_MONTHLY, PLAN_YEARLY]

export const PLAN_LABELS = {
  [PLAN_MONTHLY]: { name: 'Monthly', period: 'month', short: '/mo' },
  [PLAN_YEARLY]: { name: 'Yearly', period: 'year', short: '/yr' },
}

// What the badge is worth having, in the order the page lists it. Copy lives here so the
// pricing page, the upsell in the composer and the settings row can never drift apart.
export const PREMIUM_PERKS = [
  {
    id: 'badge',
    title: 'The mark',
    description: 'A premium mark beside your name, everywhere your profile renders.',
  },
  {
    id: 'accent',
    title: 'Your own accent',
    description: 'Pick the colour your profile and posts are themed in, instead of taking the chain’s.',
  },
  {
    id: 'uploads',
    title: 'Longer video',
    description: 'Post video up to 500MB instead of 100MB — minutes rather than seconds.',
  },
  {
    id: 'insights',
    title: 'Longer history',
    description: '90-day and 12-month views on /insights, instead of stopping at 30 days.',
  },
  {
    id: 'translation',
    title: 'Unmetered translation',
    description: 'Translate every post you read, without the daily ceiling.',
  },
]

// The upload ceilings the composer and the presign route both work from. Free matches
// MAX_VIDEO_SIZE_MB in NewPost.jsx; premium is the number the perk above promises.
export const FREE_VIDEO_MB = 100
export const PREMIUM_VIDEO_MB = 500

/* Insights history, in days. Free keeps every window it has always had — the perk extends the
   range rather than taking one away, because clawing back a window people already use reads as
   a punishment for not paying. Premium adds the two beyond it. */
export const FREE_INSIGHTS_DAYS = 30
export const PREMIUM_INSIGHTS_DAYS = 365

// Translations per rolling day. Premium is uncapped, which null rather than Infinity says
// without a JSON round trip turning it into null anyway.
export const FREE_TRANSLATIONS_PER_DAY = 20
export const PREMIUM_TRANSLATIONS_PER_DAY = null

// The zero address is how the contract, the indexer and this app all say "the native coin".
export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

export const isNativeToken = (address) => !address || String(address).toLowerCase() === NATIVE_TOKEN

// Mirrors IHupPremium.TokenStandard. Which one a token is decides the approval call the buyer
// makes — LSP7 authorizeOperator vs ERC20 approve — and the two are not interchangeable.
export const TOKEN_STANDARD = { NONE: 0, ERC20: 1, LSP7: 2 }

/* The units a moderator can name a granted term in. A month is 30 days and a year 365, the
   same arithmetic the seeded plans use (30 days / 365 days), so "1 month" here and the monthly
   plan are the same length rather than nearly the same. */
export const GRANT_UNITS = [
  { id: 'days', label: 'days', seconds: 86400 },
  { id: 'months', label: 'months', seconds: 30 * 86400 },
  { id: 'years', label: 'years', seconds: 365 * 86400 },
]

/**
 * A term as seconds, or null when the amount is not a positive number.
 * @param {string|number} amount
 * @param {string} unitId One of GRANT_UNITS.
 */
export const grantSeconds = (amount, unitId) => {
  const unit = GRANT_UNITS.find((entry) => entry.id === unitId) ?? GRANT_UNITS[0]
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return null

  return Math.round(value * unit.seconds)
}

/* The native price that means "not for sale". No coin amount can satisfy it, so subscribe()
   reverts with InsufficientPayment — which is how native sales are closed on a live deployment
   that has no on/off switch for them. Reopening is setting a real price again. */
export const NATIVE_CLOSED_PRICE = (1n << 256n) - 1n

/** Whether a native price is the sentinel rather than a price. */
export const isNativeClosed = (priceWei) => toWei(priceWei) === NATIVE_CLOSED_PRICE

// Mirrors MAX_BATCH in HupPremium.sol — a longer list reverts with InvalidBatch, so the admin
// card refuses it before it costs a signature.
export const PREMIUM_MAX_BATCH = 200

const wholeCoinFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 })
const usdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const percentFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** A wei figure as BigInt, tolerating the decimal strings the API hands over. */
export const toWei = (value) => {
  try {
    return BigInt(value ?? 0)
  } catch {
    return 0n
  }
}

/** "0.0132 LYX" for a plan price. Decimals default to 18; Arc's native USDC is still 18 here. */
export const formatCoin = (priceWei, symbol, decimals = 18) => {
  const amount = Number(formatUnits(toWei(priceWei), decimals))
  const figure = wholeCoinFormatter.format(amount)
  return symbol ? `${figure} ${symbol}` : figure
}

/**
 * What a plan costs in dollars, or null on a chain with no market price. Null is the normal
 * case on a testnet, and the caller prints the coin figure alone rather than a wrong number.
 */
export const planUsd = (priceWei, usdPerCoin, decimals = 18) => {
  if (!usdPerCoin || !Number.isFinite(Number(usdPerCoin))) return null
  return Number(formatUnits(toWei(priceWei), decimals)) * Number(usdPerCoin)
}

/** "$6.00" for a dollar figure, or null passed straight through. */
export const formatUsd = (amount) => (amount === null || amount === undefined ? null : usdFormatter.format(amount))

/**
 * How much cheaper a year is than twelve months of the monthly plan, as a whole percent.
 * Returns null when either price is missing or the year saves nothing — an honest "save 0%"
 * badge is worse than no badge.
 */
export const yearlySavingPercent = (monthlyWei, yearlyWei) => {
  const monthly = toWei(monthlyWei)
  const yearly = toWei(yearlyWei)
  if (monthly === 0n || yearly === 0n) return null

  const twelve = monthly * 12n
  if (yearly >= twelve) return null

  const saved = Number(((twelve - yearly) * 10000n) / twelve) / 100
  return saved >= 1 ? percentFormatter.format(saved) : null
}

/** Whether a unix-second expiry is still in the future. */
export const isActive = (expiresAt) => Number(expiresAt ?? 0) * 1000 > Date.now()

/**
 * "in 3 months" / "2 days ago" for an expiry. Extends past the day-granularity `toRelative`
 * the poll and market cards use, because a yearly subscription reading "in 341 days" is a
 * number nobody converts in their head.
 */
export const expiryRelative = (expiresAt) => {
  const deltaSeconds = Number(expiresAt ?? 0) - Math.floor(Date.now() / 1000)
  const absDelta = Math.abs(deltaSeconds)

  if (absDelta < 3600) return relativeTime.format(Math.trunc(deltaSeconds / 60), 'minute')
  if (absDelta < 86400) return relativeTime.format(Math.trunc(deltaSeconds / 3600), 'hour')
  if (absDelta < 86400 * 45) return relativeTime.format(Math.trunc(deltaSeconds / 86400), 'day')
  if (absDelta < 86400 * 365) return relativeTime.format(Math.trunc(deltaSeconds / (86400 * 30)), 'month')
  return relativeTime.format(Math.trunc(deltaSeconds / (86400 * 365)), 'year')
}

/** "12 Mar 2027" for the date a subscription lapses. */
export const expiryDate = (expiresAt) => {
  const seconds = Number(expiresAt ?? 0)
  return seconds > 0 ? longDate.format(new Date(seconds * 1000)) : null
}

/* A profile accent is a six-digit hex colour and nothing else — no named colours, no rgb(),
   no gradients. The value is interpolated straight into a CSS custom property on the server's
   markup, so anything looser is a stylesheet injection with extra steps. */
const ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/

/** Whether a stored or submitted accent is one this app will ever render. */
export const isAccentColor = (value) => typeof value === 'string' && ACCENT_PATTERN.test(value)

/**
 * What a profile save means by its `accent` field, in the shape the badge and origin fields
 * already use: absent leaves it alone, empty clears it, anything else must be a hex colour.
 * @param {string|null} raw The form value.
 * @returns {{action: 'none'|'clear'|'set'|'invalid', color?: string}}
 */
export const parseAccentSelection = (raw) => {
  if (raw === null || raw === undefined) return { action: 'none' }

  const trimmed = String(raw).trim()
  if (trimmed === '') return { action: 'clear' }
  if (!isAccentColor(trimmed)) return { action: 'invalid' }

  return { action: 'set', color: trimmed.toLowerCase() }
}

/** "1 month" / "1 year" for a plan's raw duration in seconds. */
export const durationLabel = (seconds) => {
  const days = Math.round(Number(seconds ?? 0) / 86400)
  if (days >= 360) {
    const years = Math.round(days / 365)
    return years === 1 ? '1 year' : `${years} years`
  }
  if (days >= 28) {
    const months = Math.round(days / 30)
    return months === 1 ? '1 month' : `${months} months`
  }
  return days === 1 ? '1 day' : `${days} days`
}
