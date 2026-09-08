'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import styles from './FundCountdown.module.scss'

/**
 * @file components/FundCountdown.jsx
 * @description Live countdown to a campaign's close. Two shapes from one clock: `big` is the
 * four-box days / hrs / min / sec readout the campaign page leads with, and the default is
 * the one-line "2d 4h 10m 3s" a card has room for. Timestamps are unix seconds, the way the
 * contract stores them.
 */

const pad = (value) => String(value).padStart(2, '0')

const split = (seconds) => ({
  days: Math.floor(seconds / 86400),
  hours: Math.floor((seconds % 86400) / 3600),
  minutes: Math.floor((seconds % 3600) / 60),
  seconds: Math.floor(seconds % 60),
})

/**
 * Fund Countdown
 * @param {Object} props
 * @param {number|string} props.closesAt Unix seconds the campaign stops accepting backings.
 * @param {boolean} [props.big=false] The four-box readout instead of the inline phrase.
 * @param {string} [props.closedLabel='Ended'] What to show once the clock has run out.
 * @param {Function} [props.onClose] Called once, the moment the window crosses into closed
 *   while on screen. A card derives its own status at render time, so without this a
 *   campaign that ends in front of the viewer keeps its back button.
 * @param {string} [props.className] Layout class from the consumer's module.
 */
export default function FundCountdown({ closesAt, big = false, closedLabel = 'Ended', onClose, className }) {
  const closes = Number(closesAt) || 0
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  const isClosed = closes > 0 && now >= closes
  // Fires on the crossing only, never on mount — the parent already knows the initial phase
  const wasClosed = useRef(isClosed)
  useEffect(() => {
    if (wasClosed.current === isClosed) return
    wasClosed.current = isClosed
    if (isClosed) onClose?.()
  }, [isClosed, onClose])

  if (!closes) return null

  if (isClosed) {
    return big ? <p className={clsx(styles.countdown__ended, className)}>{closedLabel}</p> : <span className={className}>{closedLabel}</span>
  }

  const parts = split(closes - now)

  if (!big) {
    const phrase = parts.days > 0 ? `${parts.days}d ${parts.hours}h ${parts.minutes}m ${parts.seconds}s` : `${parts.hours}h ${parts.minutes}m ${parts.seconds}s`
    return <span className={className}>Ends in {phrase}</span>
  }

  const cells = [
    { label: 'Days', value: parts.days },
    { label: 'Hrs', value: parts.hours },
    { label: 'Min', value: parts.minutes },
    { label: 'Sec', value: parts.seconds },
  ]

  return (
    <div className={clsx(styles.countdown, className)} role="timer" aria-live="off" aria-label={`Closes in ${parts.days} days ${parts.hours} hours ${parts.minutes} minutes`}>
      {cells.map((cell, index) => (
        <div key={cell.label} className={styles.countdown__cell}>
          <span className={styles.countdown__value}>{pad(cell.value)}</span>
          <span className={styles.countdown__label}>{cell.label}</span>
          {index < cells.length - 1 && <span className={styles.countdown__colon} aria-hidden="true">:</span>}
        </div>
      ))}
    </div>
  )
}
