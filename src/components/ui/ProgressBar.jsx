'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import styles from './ProgressBar.module.scss'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// A timed bar advances in about this many steps whatever its window is worth, so a seven-day
// poll re-renders roughly every minute instead of every second for a fill that moves a
// thousandth of a percent — and a five-minute one still ticks visibly.
const TICK_STEPS = 600
const MIN_TICK_MS = 1000
const MAX_TICK_MS = 60000

const tickFor = (durationMs) => clamp(Math.round(durationMs / TICK_STEPS), MIN_TICK_MS, MAX_TICK_MS)

// A number is px, anything else is already a CSS length — so `height={5}` and `height="0.4rem"`
// both mean what they look like
const toLength = (value) => (typeof value === 'number' ? `${value}px` : value)

/**
 * Progress Bar
 * The one bar in the app: a mint filling up, a poll's window running out, a share of the vote.
 * It carries no opinion about what it measures — colour, height, radius, and track all arrive
 * as custom properties, so a caller styles it from its own module or from a chain's palette
 * without this component knowing either.
 *
 * Three ways to say how full it is, in precedence order:
 *   - `startsAt`/`endsAt` (unix seconds) — timed mode: the bar fills itself as the window runs
 *     and re-renders on its own clock, so nothing above it has to tick to keep it honest.
 *   - `percent` — a share that is already a percentage.
 *   - `value`/`max` — a count against its denominator, which is also what the ARIA values read.
 *
 * @param {Object} props
 * @param {number} [props.value=0] Current amount, against `max`.
 * @param {number} [props.max=100] Denominator; 0 leaves the bar empty rather than dividing by it.
 * @param {number} [props.percent] Explicit 0–100 fill, taking precedence over value/max.
 * @param {number|string} [props.startsAt] Unix seconds the window opened — timed mode.
 * @param {number|string} [props.endsAt] Unix seconds the window closes — timed mode.
 * @param {boolean} [props.countdown=false] Timed mode drains instead of filling.
 * @param {string} [props.color] Any CSS colour for the fill. Defaults to the active chain's.
 * @param {string} [props.trackColor] Any CSS colour for the groove behind it.
 * @param {number|string} [props.height=6] Track thickness.
 * @param {number|string} [props.radius=999] Corner radius, for a squared-off bar.
 * @param {boolean} [props.gradient=true] Dim at the start, full strength at the leading edge.
 * @param {boolean} [props.animated=false] Sweeps a sheen across the fill — for something still
 *   moving. A finished bar should never carry it: motion says the story is still running.
 * @param {boolean} [props.sparkle=false] Lights drifting off the fill's leading edge — the mint
 *   bar treatment. Same rule as `animated`: only for a story still running.
 * @param {boolean} [props.indeterminate=false] Unknown progress; a shuttle rides the track.
 * @param {import('react').ReactNode} [props.label] Leading caption above the track.
 * @param {import('react').ReactNode} [props.hint] Trailing caption above the track — a
 *   percentage, a countdown, a remaining count.
 * @param {string} [props.ariaLabel] Accessible name when the visible label isn't enough.
 * @param {boolean} [props.decorative=false] Drops the progressbar role entirely — for a bar
 *   whose value is already announced by whatever encloses it, which would otherwise be read
 *   out twice.
 * @param {Function} [props.onComplete] Fired once in timed mode when the window closes, within
 *   one tick of the edge.
 * @param {string} [props.className] Layout class from the consumer's module.
 * @param {Object} [props.style] Extra inline style, merged after the custom properties.
 */
export default function ProgressBar({
  value = 0,
  max = 100,
  percent,
  startsAt,
  endsAt,
  countdown = false,
  color,
  trackColor,
  height = 6,
  radius = 999,
  gradient = true,
  animated = false,
  sparkle = false,
  indeterminate = false,
  label,
  hint,
  ariaLabel,
  decorative = false,
  onComplete,
  className,
  style,
}) {
  const from = Number(startsAt) || 0
  const to = Number(endsAt) || 0
  // Both edges, not just the far one: a window missing its start would otherwise measure from
  // the epoch and paint every bar all but full
  const isTimed = from > 0 && to > from

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    if (!isTimed) return

    // One interval whatever the phase: a window that opens while the bar is on screen has to
    // start measuring the run without a remount
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), tickFor((to - from) * 1000))
    return () => clearInterval(timer)
  }, [isTimed, from, to])

  // Once only, and never on a bar that mounted already finished — a caller refreshing on this
  // wants the moment it crossed, not a callback for every closed window that scrolls past
  const completedRef = useRef(isTimed && now >= to)
  useEffect(() => {
    if (!isTimed || completedRef.current || now < to) return
    completedRef.current = true
    onComplete?.()
  }, [isTimed, now, to, onComplete])

  const elapsed = isTimed ? clamp(((now - from) / (to - from)) * 100, 0, 100) : null
  const fill = indeterminate
    ? 0
    : elapsed !== null
      ? countdown
        ? 100 - elapsed
        : elapsed
      : percent !== undefined && percent !== null
        ? clamp(Number(percent) || 0, 0, 100)
        : Number(max) > 0
          ? clamp((Number(value) / Number(max)) * 100, 0, 100)
          : 0

  // A count-backed bar reports its own units to a screen reader; a timed or percentage one has
  // no units worth reading, so it reports the share
  const countBacked = elapsed === null && (percent === undefined || percent === null) && Number(max) > 0
  const ariaMax = countBacked ? Number(max) : 100
  const ariaNow = countBacked ? clamp(Number(value) || 0, 0, Number(max)) : Math.round(fill)

  const cssVars = {
    '--progress-height': toLength(height),
    '--progress-radius': toLength(radius),
    ...(color ? { '--progress-color': color } : null),
    ...(trackColor ? { '--progress-track': trackColor } : null),
    ...style,
  }

  return (
    <span className={clsx(styles.progress, className)} style={cssVars}>
      {(label || hint) && (
        <span className={styles.progress__head}>
          {label ? <span className={styles.progress__label}>{label}</span> : <span />}
          {hint && <span className={styles.progress__hint}>{hint}</span>}
        </span>
      )}

      <span
        className={styles.progress__track}
        role={decorative ? undefined : 'progressbar'}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : ariaLabel}
        aria-valuemin={decorative ? undefined : 0}
        aria-valuemax={decorative ? undefined : ariaMax}
        aria-valuenow={decorative || indeterminate ? undefined : ariaNow}
      >
        <span
          className={clsx(styles.progress__fill, {
            [styles['progress__fill--gradient']]: gradient,
            [styles['progress__fill--animated']]: animated && !indeterminate,
            [styles['progress__fill--indeterminate']]: indeterminate,
          })}
          style={indeterminate ? undefined : { width: `${fill}%` }}
        />
      </span>

      {/* The emitter is a zero-height layer over the track, as wide as the fill, so the lights
          rise from wherever the leading edge is — and can float past the track's clipped box,
          which is why they can't live inside it */}
      {sparkle && !indeterminate && fill > 0 && (
        <span className={styles.progress__sparkles} style={{ width: `${fill}%` }} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
    </span>
  )
}
