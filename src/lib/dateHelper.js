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

const timeZoneOrUndefined = (timeZone) => {
  if (!timeZone) return undefined

  try {
    // Metadata timezones are free organizer input — probe before trusting so one bad
    // IANA name can't throw mid-render (falls back to the viewer's local zone).
    new Intl.DateTimeFormat('en', { timeZone })
    return timeZone
  } catch {
    return undefined
  }
}

/**
 * Formats a Unix timestamp (in seconds) as a directory day header, e.g. "30 March, Monday".
 * `timeZone` is an optional IANA name (the event's own zone); invalid or missing falls back
 * to the viewer's local zone.
 */
export const toDayGroupLabel = (unixSeconds, timeZone) => {
  if (!Number.isFinite(unixSeconds)) return ''

  const date = new Date(unixSeconds * 1000)
  const parts = new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: timeZoneOrUndefined(timeZone),
  }).formatToParts(date)

  const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('day')} ${get('month')}, ${get('weekday')}`
}

/**
 * Stable calendar-day grouping key ("2026-03-30") for a Unix timestamp in an optional IANA
 * time zone. Same-day events share a key regardless of their exact times.
 */
export const toDayGroupKey = (unixSeconds, timeZone) => {
  if (!Number.isFinite(unixSeconds)) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timeZoneOrUndefined(timeZone),
  }).formatToParts(new Date(unixSeconds * 1000))

  const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Formats an event's start/end Unix timestamps as a compact range, e.g. "09:00 – 18:00".
 * When the range crosses into another calendar day, the end time gains a day-month suffix:
 * "21:00 – 02:00 (31 Mar)".
 */
export const toTimeRange = (startUnix, endUnix, timeZone) => {
  if (!Number.isFinite(startUnix)) return ''

  const zone = timeZoneOrUndefined(timeZone)
  const timeFormat = new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  })

  const start = timeFormat.format(new Date(startUnix * 1000))
  if (!Number.isFinite(endUnix)) return start

  let end = timeFormat.format(new Date(endUnix * 1000))
  if (toDayGroupKey(startUnix, timeZone) !== toDayGroupKey(endUnix, timeZone)) {
    const dayFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: zone })
    end = `${end} (${dayFormat.format(new Date(endUnix * 1000))})`
  }

  return `${start} – ${end}`
}

/**
 * Converts a datetime-local input value ("2026-03-30T09:00") that means wall-clock time in
 * the given IANA zone into Unix seconds — no date library, just the standard two-pass
 * Intl offset probe (the second pass settles values that land on a DST transition).
 * Missing/invalid `timeZone` interprets the value in the viewer's local zone.
 */
export const wallTimeToUnix = (dateTimeLocal, timeZone) => {
  if (!dateTimeLocal) return NaN

  const zone = timeZoneOrUndefined(timeZone)
  if (!zone) return Math.floor(new Date(dateTimeLocal).getTime() / 1000)

  const utcGuess = Date.parse(`${dateTimeLocal}:00Z`)
  if (!Number.isFinite(utcGuess)) return NaN

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const asZoneUtc = (timestampMs) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestampMs)).map((part) => [part.type, part.value]))
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}Z`)
  }

  let result = utcGuess - (asZoneUtc(utcGuess) - utcGuess)
  result = utcGuess - (asZoneUtc(result) - result)
  return Math.floor(result / 1000)
}

/**
 * Formats a Date string or Unix timestamp as a compact relative time string.
 * Supports: "2025-12-07 17:37:36" or 1733593056
 */
export const toRelativeTime = (input) => {
  if (input === null || input === undefined || input === '') return ''

  let timestampInSeconds

  if (typeof input === 'bigint') {
    timestampInSeconds = Number(input)
  } else if (typeof input === 'string') {
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