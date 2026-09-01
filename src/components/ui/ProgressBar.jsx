'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import styles from './ProgressBar.module.scss'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// Tick rate scales with the window so a seven-day poll is not re-rendered every second
const TICK_STEPS = 600
const MIN_TICK_MS = 1000
const MAX_TICK_MS = 60000

const tickFor = (durationMs) => clamp(Math.round(durationMs / TICK_STEPS), MIN_TICK_MS, MAX_TICK_MS)

const toLength = (value) => (typeof value === 'number' ? `${value}px` : value)

/**
 * Progress Bar. Colour, height, radius, and track all arrive as custom properties, so a caller
 * styles it from its own module or a chain's palette. Fill source, in precedence order:
 * `startsAt`/`endsAt` (timed mode, ticks on its own clock), `percent`, then `value`/`max`.
 *
 * @param {Object} props
 * @param {number} [props.value=0] Current amount, against `max`.
 * @param {number} [props.max=100] Denominator; 0 leaves the bar empty.
 * @param {number} [props.percent] Explicit 0–100 fill, taking precedence over value/max.
 * @param {number|string} [props.startsAt] Unix seconds the window opened — timed mode.
 * @param {number|string} [props.endsAt] Unix seconds the window closes — timed mode.
 * @param {boolean} [props.countdown=false] Timed mode drains instead of filling.
 * @param {string} [props.color] Any CSS colour for the fill. Defaults to the active chain's.
 * @param {string} [props.trackColor] Any CSS colour for the groove behind it.
 * @param {number|string} [props.height=6] Track thickness.
 * @param {number|string} [props.radius=999] Corner radius.
 * @param {boolean} [props.gradient=true] Dim at the start, full strength at the leading edge.
 * @param {boolean} [props.animated=false] Sheen across the fill.
 * @param {boolean} [props.sparkle=false] Lights drifting off the fill's leading edge.
 * @param {boolean} [props.indeterminate=false] Unknown progress; a shuttle rides the track.
 * @param {import('react').ReactNode} [props.marker] Disc riding the fill's leading edge, ringed in the bar's colour.
 * @param {number|string} [props.markerSize=15] The marker's diameter.
 * @param {import('react').ReactNode} [props.label] Leading caption above the track.
 * @param {import('react').ReactNode} [props.hint] Trailing caption above the track.
 * @param {string} [props.ariaLabel] Accessible name when the visible label isn't enough.
 * @param {boolean} [props.decorative=false] Drops the progressbar role when the enclosing element already announces the value.
 * @param {Function} [props.onComplete] Fired once in timed mode when the window closes.
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
  marker,
  markerSize = 15,
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
  // Both edges required: a missing start would measure from the epoch
  const isTimed = from > 0 && to > from

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    if (!isTimed) return

    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), tickFor((to - from) * 1000))
    return () => clearInterval(timer)
  }, [isTimed, from, to])

  // onComplete fires once and never on a bar that mounted finished
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

  const countBacked = elapsed === null && (percent === undefined || percent === null) && Number(max) > 0
  const ariaMax = countBacked ? Number(max) : 100
  const ariaNow = countBacked ? clamp(Number(value) || 0, 0, Number(max)) : Math.round(fill)

  const hasMarker = Boolean(marker) && !indeterminate

  const cssVars = {
    '--progress-height': toLength(height),
    '--progress-radius': toLength(radius),
    '--progress-marker-size': toLength(markerSize),
    ...(color ? { '--progress-color': color } : null),
    ...(trackColor ? { '--progress-track': trackColor } : null),
    ...style,
  }

  return (
    <span className={clsx(styles.progress, { [styles['progress--marked']]: hasMarker }, className)} style={cssVars}>
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

      {/* Sparkles and the marker sit outside the track, which would clip them */}
      {sparkle && !indeterminate && fill > 0 && (
        <span className={styles.progress__sparkles} style={{ width: `${fill}%` }} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}

      {hasMarker && (
        <span className={styles.progress__marker} style={{ '--progress-fill': `${fill}%` }} aria-hidden="true">
          {marker}
        </span>
      )}
    </span>
  )
}
