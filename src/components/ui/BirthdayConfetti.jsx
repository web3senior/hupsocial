'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import styles from './BirthdayConfetti.module.scss'

const PARTICLE_COLORS = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3', '#5f27cd']
const PARTICLE_COUNT = 80

// Deterministic jitter (no Math.random) so particle generation stays a pure
// function of its index — required by this app's react-hooks/purity rule.
const jitter = (seed) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Fullscreen one-shot birthday celebration: confetti rains across the whole
 * window (Twitter-style), then fades out. Mounted when it's the viewed user's
 * birthday; bump the `burst` prop to replay the animation.
 */
export const BirthdayConfetti = ({ burst = 0 }) => {
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const sway = (jitter(i + 500) - 0.5) * 120

        return {
          id: i,
          color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
          left: jitter(i) * 100,
          sway,
          rotate: (jitter(i + 200) - 0.5) * 1080,
          delay: jitter(i + 300) * 1.2,
          duration: 2.4 + jitter(i + 100) * 1.8,
          size: 7 + jitter(i + 400) * 7,
          // Every third particle is a circle for visual variety
          round: i % 3 === 0,
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
          style={{
            backgroundColor: p.color,
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 1.6,
            borderRadius: p.round ? '50%' : 1,
          }}
          initial={{ y: '-4vh', x: 0, opacity: 1, rotate: 0 }}
          animate={{
            y: '104vh',
            x: [0, p.sway, p.sway * 0.4],
            opacity: [1, 1, 0],
            rotate: p.rotate,
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: 'linear',
            x: { duration: p.duration, ease: 'easeInOut' },
            opacity: { duration: p.duration, times: [0, 0.85, 1] },
          }}
        />
      ))}
    </div>
  )
}

export default BirthdayConfetti
