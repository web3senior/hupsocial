// Shared client helpers for Hup Predict — status derivation and compact relative time,
// used by the directory, the market detail page, and the in-post card.

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'narrow' })

/** Localized "10m ago" / "in 3d" for unix-second timestamps. */
export const toRelative = (unixSeconds) => {
  const deltaSeconds = Number(unixSeconds) - Math.floor(Date.now() / 1000)
  const absDelta = Math.abs(deltaSeconds)
  if (absDelta < 60) return relativeTime.format(Math.trunc(deltaSeconds), 'second')
  if (absDelta < 3600) return relativeTime.format(Math.trunc(deltaSeconds / 60), 'minute')
  if (absDelta < 86400) return relativeTime.format(Math.trunc(deltaSeconds / 3600), 'hour')
  return relativeTime.format(Math.trunc(deltaSeconds / 86400), 'day')
}

/**
 * Derives a display status from an indexed market row. State ints mirror the contract enum
 * (0 Open, 1 Closed, 2 Resolved, 3 Refunding); an Open market past its betting deadline
 * reads as awaiting a judge because the contract already rejects bets on it.
 */
export const marketStatus = (market) => {
  const state = Number(market.state)
  const deadlinePassed = Number(market.betting_deadline) <= Math.floor(Date.now() / 1000)
  if (state === 0 && !deadlinePassed) return { key: 'open', label: 'Bets open' }
  if (state === 0 || state === 1) return { key: 'awaiting', label: 'Awaiting result' }
  if (state === 2) return { key: 'resolved', label: 'Resolved' }
  return { key: 'refunding', label: 'Refunds open' }
}

/** Parses a JSON column that may be null/malformed into an array, never throwing. */
export const parseJsonArray = (raw) => {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Distinct, screenshot-style pastel fills for outcome rows, cycled by outcome index. */
export const OUTCOME_COLORS = ['#e8b4a0', '#d8dc8a', '#a8c8e8', '#f0b6d8', '#b8e0c0', '#e0c8f0', '#f0d8a0', '#c0d8d8']
