'use client'
import { useState, useEffect } from 'react'
import Ticker from './Ticker' // Your existing component
import styles from './TickerTooltip.module.scss'

export default function TickerTooltip() {
  const [active, setActive] = useState(null) // { symbol, x, y }

  useEffect(() => {
    const handleMouseOver = (e) => {
      // Look for our custom class
      const target = e.target.closest('.ticker-trigger')
      if (target) {
        const rect = target.getBoundingClientRect()
        setActive({
          symbol: target.getAttribute('data-symbol'),
          // Position relative to viewport (fixed)
          x: rect.left + rect.width / 2,
          y: rect.top,
        })
      }
    }

    const handleMouseOut = (e) => {
      if (e.target.closest('.ticker-trigger')) {
        setActive(null)
      }
    }

    document.addEventListener('mouseover', handleMouseOver)
    document.addEventListener('mouseout', handleMouseOut)

    return () => {
      document.removeEventListener('mouseover', handleMouseOver)
      document.removeEventListener('mouseout', handleMouseOut)
    }
  }, [])

  if (!active) return null

  return (
    <div
      className={styles.floatingContainer}
      style={{
        left: `${active.x}px`,
        top: `${active.y}px`,
      }}
    >
      <Ticker
        blockchain={active.symbol === 'LYX' ? 'Lukso' : 'Ethereum'}
        address="0x0000000000000000000000000000000000000000"
      />
    </div>
  )
}
