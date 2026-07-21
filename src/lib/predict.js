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

/**
 * Outcome colors, assigned by index in fixed order (never re-ranked). The 8-slot
 * categorical order is CVD-validated (adjacent-pair ΔE, lightness band, chroma floor);
 * identity never rides on color alone — every fill carries the outcome label directly.
 */
export const OUTCOME_COLORS = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948']

// Two-outcome markets read as yes/no polarity — the green/red pair Polymarket trained
// everyone on (CVD separation sits in the legal-with-labels band; labels are always on)
const BINARY_COLORS = ['#008300', '#e34948']

/** Resolves an outcome's color: polarity pair for binary markets, fixed categorical order otherwise. */
export const outcomeColor = (index, outcomeCount) =>
  Number(outcomeCount) === 2 ? BINARY_COLORS[index % 2] : OUTCOME_COLORS[index % OUTCOME_COLORS.length]
