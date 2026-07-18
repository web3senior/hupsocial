'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import styles from './BirthdayConfetti.module.scss'

const PARTICLE_COLORS = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3', '#5f27cd']
const PARTICLE_COUNT = 28

// Deterministic jitter (no Math.random) so particle generation stays a pure
// function of its index — required by this app's react-hooks/purity rule.
const jitter = (seed) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * One-shot particle burst overlay, meant to be conditionally mounted
 * over a profile header when it's the viewed user's birthday.
 * Bump the `burst` prop to replay the animation.
 */
export const BirthdayConfetti = ({ burst = 0 }) => {
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + jitter(i) * 0.5
        const distance = 60 + jitter(i + 100) * 90

        return {
          id: i,
          color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance - 40,
          rotate: jitter(i + 200) * 360,
          delay: jitter(i + 300) * 0.15,
          size: 6 + jitter(i + 400) * 5,
        }
      }),
    [],
  )

  return (
    // Keyed by burst so a bump remounts the particles and replays the one-shot animation
    <div key={burst} className={styles.birthdayConfetti} aria-hidden="true">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className={styles.birthdayConfetti__particle}
          style={{ backgroundColor: p.color, width: p.size, height: p.size * 1.6 }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, rotate: p.rotate }}
          transition={{ duration: 1.4, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

export default BirthdayConfetti
