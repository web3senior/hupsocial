/**
 * Formats a Unix timestamp (in seconds) as a compact relative time string.
 * Examples: `5m`, `2h`, `3d`, `in 4mo`
 */
export const toRelativeTimestamp = (timestampInSeconds) => {
  if (!Number.isFinite(timestampInSeconds)) return ''

  const nowInSeconds = Math.floor(Date.now() / 1000)
  const deltaSeconds = Math.trunc(timestampInSeconds) - nowInSeconds
  const isFuture = deltaSeconds > 0
  const absDelta = Math.abs(deltaSeconds)

  if (absDelta < 1) return '0s'

  const UNITS = [
    { label: 'y', seconds: 365 * 24 * 60 * 60 },
    { label: 'mo', seconds: 30 * 24 * 60 * 60 },
    { label: 'd', seconds: 24 * 60 * 60 },
    { label: 'h', seconds: 60 * 60 },
    { label: 'm', seconds: 60 },
    { label: 's', seconds: 1 },
  ]

  const unit = UNITS.find(({ seconds }) => absDelta >= seconds) ?? UNITS[UNITS.length - 1]
  const value = Math.floor(absDelta / unit.seconds)
  const formatted = `${value}${unit.label}`

  return isFuture ? `in ${formatted}` : formatted
}

/**
 * Formats a Date string or Unix timestamp as a compact relative time string.
 * Supports: "2025-12-07 17:37:36" or 1733593056
 */
export const toRelativeTime = (input) => {
  if (!input) return ''

  let timestampInSeconds;

  // 1. Convert SQL String to Timestamp if necessary
  if (typeof input === 'string') {
    // Replace space with 'T' to make it ISO compliant for all browsers
    const isoStr = input.replace(' ', 'T')
    timestampInSeconds = Math.floor(new Date(isoStr).getTime() / 1000)
  } else {
    timestampInSeconds = Math.trunc(input)
  }

  if (!Number.isFinite(timestampInSeconds)) return ''

  const nowInSeconds = Math.floor(Date.now() / 1000)
  const deltaSeconds = timestampInSeconds - nowInSeconds
  const isFuture = deltaSeconds > 0
  const absDelta = Math.abs(deltaSeconds)

  if (absDelta < 1) return '0s'

  const UNITS = [
    { label: 'y', seconds: 31536000 },
    { label: 'mo', seconds: 2592000 },
    { label: 'd', seconds: 86400 },
    { label: 'h', seconds: 3600 },
    { label: 'm', seconds: 60 },
    { label: 's', seconds: 1 },
  ]

  const unit = UNITS.find(({ seconds }) => absDelta >= seconds) ?? UNITS[UNITS.length - 1]
  const value = Math.floor(absDelta / unit.seconds)
  const formatted = `${value}${unit.label}`

  return isFuture ? `in ${formatted}` : formatted
}