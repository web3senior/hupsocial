'use client'

import { useEffect, useState } from 'react'

/**
 * @file components/PollTimer.jsx
 * @description Live countdown for a poll's open window — "Ends in 4h:10m:3s". Ticks every
 * second rather than settling on a coarse phrase: a closing poll is the one thing on the card
 * worth watching, and a number that moves is what says a vote still counts.
 * Timestamps are unix seconds, the way the contract stores them.
 */

/**
 * Ticking "4h:10m:3s" — unit-labelled and unpadded, so the number reads at a glance without
 * being mistaken for a wall clock. Trimmed to the three largest live units: a poll closing in
 * six days does not need its seconds, and one closing in four hours does.
 * @param {number} seconds Seconds from now until the edge.
 * @returns {string} The countdown.
 */
const countdown = (seconds) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (days > 0) return `${days}d:${hours}h:${minutes}m`
  return `${hours}h:${minutes}m:${secs}s`
}

/**
 * Poll Timer
 * @param {Object} props
 * @param {number|string} props.opensAt Unix seconds the poll starts accepting votes.
 * @param {number|string} props.closesAt Unix seconds the poll stops accepting votes.
 */
export default function PollTimer({ opensAt, closesAt }) {
  const opens = Number(opensAt) || 0
  const closes = Number(closesAt) || 0

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    // One interval regardless of phase: a poll that opens while the card is on screen
    // has to flip to its closing countdown without a remount.
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!closes) return null
  if (now >= closes) return <>Final results</>

  const upcoming = opens > now
  const remaining = (upcoming ? opens : closes) - now

  return (
    <>
      {upcoming ? 'Opens in' : 'Ends in'} {countdown(remaining)}
    </>
  )
}
