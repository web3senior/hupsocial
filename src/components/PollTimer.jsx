'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * @file components/PollTimer.jsx
 * @description Live countdown for a poll's open window — "Ends in 4h:10m:3s". Ticks every
 * second rather than settling on a coarse phrase: a closing poll is the one thing on the card
 * worth watching, and a number that moves is what says a vote still counts.
 * Timestamps are unix seconds, the way the contract stores them.
 */

/**
 * Ticking "6d:4h:10m:3s" — unit-labelled and unpadded, so the number reads at a glance
 * without being mistaken for a wall clock. Seconds always ride along, even with days left:
 * a countdown that only moves once a minute reads as stuck, and the whole point of ticking
 * is that the viewer can see it tick.
 * @param {number} seconds Seconds from now until the edge.
 * @returns {string} The countdown.
 */
const countdown = (seconds) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (days > 0) return `${days}d:${hours}h:${minutes}m:${secs}s`
  return `${hours}h:${minutes}m:${secs}s`
}

const phaseOf = (now, opens, closes) => (now >= closes ? 'closed' : now >= opens ? 'open' : 'upcoming')

/**
 * Poll Timer
 * @param {Object} props
 * @param {number|string} props.opensAt Unix seconds the poll starts accepting votes.
 * @param {number|string} props.closesAt Unix seconds the poll stops accepting votes.
 * @param {Function} [props.onPhaseChange] Called with 'open' or 'closed' the moment the window
 *   crosses that edge while on screen. A card derives its own status at render time, so
 *   without this a poll that ends in front of the viewer keeps its vote buttons until
 *   something else happens to re-render it.
 */
export default function PollTimer({ opensAt, closesAt, onPhaseChange }) {
  const opens = Number(opensAt) || 0
  const closes = Number(closesAt) || 0

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    // One interval regardless of phase: a poll that opens while the card is on screen
    // has to flip to its closing countdown without a remount.
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  // Fires on a crossing only, never on mount — the parent already knows the initial phase
  const phase = phaseOf(now, opens, closes)
  const lastPhase = useRef(phase)
  useEffect(() => {
    if (lastPhase.current === phase) return
    lastPhase.current = phase
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  if (!closes) return null
  if (phase === 'closed') return <>Final results</>

  const upcoming = phase === 'upcoming'
  const remaining = (upcoming ? opens : closes) - now

  return (
    <>
      {upcoming ? 'Opens in' : 'Ends in'} {countdown(remaining)}
    </>
  )
}
