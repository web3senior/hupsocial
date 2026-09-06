'use client'

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { MAX_DROP_PHASES, PHASE_STATUS, formatPhaseTime, phaseStatus } from '@/lib/drops'
import styles from './DropPhaseTrack.module.scss'

// Slow enough for an eight-day presale, fast enough that a phase opening is noticed
const TICK_MS = 30000

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const phaseName = (phase, index) => phase?.name?.trim() || `Phase ${index + 1}`

const statusText = (phase, status) => {
  if (status === PHASE_STATUS.PAUSED) return 'Paused'
  if (status === PHASE_STATUS.ENDED) return 'Ended'
  if (status === PHASE_STATUS.UPCOMING) {
    const starts = formatPhaseTime(phase.startTime)
    return starts ? `Starts ${starts}` : 'Not started'
  }
  const ends = formatPhaseTime(phase.endTime)
  return ends ? `Live · ends ${ends}` : 'Live'
}

/**
 * Drop Phase Track
 * The whole mint schedule as one strip — a segment per phase, up to the engine's eight. Ended
 * phases read solid and dim, the live one carries the chain's colour and fills with its own
 * clock, and what's still coming stays faint. The creator's manage panel is its only home; the
 * public drop surfaces list phases in words instead.
 * @param {Object} props
 * @param {Array} props.phases Phase structs from `phasesOf`, or indexed rows carrying startTime/endTime/paused.
 * @param {number} [props.slots] Pad to this many segments with ghosts, capped at the engine's eight.
 * @param {boolean} [props.caption=true] The "2/8 · Presale · Live" line under the strip.
 * @param {string} [props.color] Fill colour; defaults to the drop chain's primary.
 * @param {string} [props.className] Layout class from the consumer's module.
 */
export default function DropPhaseTrack({ phases = [], slots, caption = true, color, className }) {
  const [now, setNow] = useState(() => Date.now())

  const statuses = useMemo(() => phases.map((phase) => phaseStatus(phase, now)), [phases, now])
  // Nothing left to move on once every phase has closed, so the clock stops with it
  const isSettled = statuses.length > 0 && statuses.every((status) => status === PHASE_STATUS.ENDED)

  useEffect(() => {
    if (isSettled) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [isSettled])

  if (phases.length === 0) return null

  // Captioned on the live phase, else the next one up, else the last one that ran
  const liveIndex = statuses.indexOf(PHASE_STATUS.LIVE)
  const nextIndex = statuses.indexOf(PHASE_STATUS.UPCOMING)
  const currentIndex = liveIndex !== -1 ? liveIndex : nextIndex !== -1 ? nextIndex : phases.length - 1
  const total = clamp(slots ?? phases.length, phases.length, MAX_DROP_PHASES)
  const ghosts = Math.max(0, total - phases.length)

  // A bounded live phase drains its own segment; an open-ended one has no end to measure against
  const liveFill = (phase) => {
    const start = Number(phase.startTime) * 1000
    const end = Number(phase.endTime) * 1000
    if (!(end > start)) return 100
    return clamp(((now - start) / (end - start)) * 100, 0, 100)
  }

  const current = phases[currentIndex]
  const currentStatus = statuses[currentIndex]

  return (
    <span className={clsx(styles.track, className)} style={color ? { '--phase-color': color } : undefined}>
      <span className={styles.track__slots} role="group" aria-label="Mint phases">
        {phases.map((phase, index) => {
          const status = statuses[index]
          const label = `${phaseName(phase, index)} · ${statusText(phase, status)}`
          return (
            <span
              key={index}
              className={clsx(styles.track__slot, styles[`track__slot--${status}`], index === currentIndex && styles['track__slot--current'])}
              title={label}
            >
              <span className={styles.track__bar}>
                {status === PHASE_STATUS.LIVE && <span className={styles.track__fill} style={{ width: `${liveFill(phase)}%` }} />}
              </span>
            </span>
          )
        })}

        {Array.from({ length: ghosts }, (_, index) => (
          <span key={`ghost-${index}`} className={clsx(styles.track__slot, styles['track__slot--ghost'])} aria-hidden="true">
            <span className={styles.track__bar} />
          </span>
        ))}
      </span>

      {caption && current && (
        <span className={styles.track__caption}>
          <b>
            {currentIndex + 1}/{total}
          </b>
          <span className={styles.track__name}>{phaseName(current, currentIndex)}</span>
          <em className={styles[`track__status--${currentStatus}`]}>{statusText(current, currentStatus)}</em>
        </span>
      )}
    </span>
  )
}
