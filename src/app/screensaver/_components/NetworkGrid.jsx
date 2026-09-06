'use client'

import { useRef } from 'react'
import { CornersOutIcon } from '@phosphor-icons/react'
import { appChains } from '@/config/contracts'
import GalaxyCanvas from './GalaxyCanvas'
import styles from './NetworkGrid.module.scss'

// wagmi's config stamps iconUrl onto the shared chain objects; the inline `icon` SVG is the fallback
// Widest whole-number board that fits the chains exactly, so no cell is ever left empty
// (9 chains -> 3x3, 8 -> 4x2). Primes fall back to a near-square with a gap.
const boardLayout = (count) => {
  let best = null
  for (let cols = 1; cols <= count; cols++) {
    const rows = count / cols
    if (!Number.isInteger(rows) || cols < rows) continue
    if (!best || cols - rows < best.cols - best.rows) best = { cols, rows }
  }
  if (best && best.rows > 1) return best
  const cols = Math.ceil(Math.sqrt(count))
  return { cols, rows: Math.ceil(count / cols) }
}

export const chainIconFor = (chain) => {
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * One square per app chain, each galaxy ramped from that chain's own brand colour with its logo
 * riding the core. The board keeps square cells at whatever chain count is enabled.
 */
export default function NetworkGrid() {
  const boardRef = useRef(null)
  const { cols, rows } = boardLayout(appChains.length)

  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else boardRef.current?.requestFullscreen?.()
  }

  return (
    <div className={styles.network} ref={boardRef} style={{ '--cols': cols, '--rows': rows, '--ratio': `${cols} / ${rows}` }}>
      <ul className={styles.network__board}>
        {appChains.map((chain) => {
          const icon = chainIconFor(chain)
          return (
            <li key={chain.id} className={styles.network__cell}>
              {/* Thinner particle counts — nine live canvases share one frame budget */}
              <GalaxyCanvas chainColor={chain.primaryColor} density={0.5} className={styles.network__canvas} />
              <span className={styles.network__badge}>
                {icon ? <img src={icon} alt="" width={28} height={28} loading="lazy" /> : <b>{chain.name.slice(0, 1)}</b>}
              </span>
              <span className={styles.network__name}>{chain.name}</span>
            </li>
          )
        })}
      </ul>
      <span className={styles.network__tag}>{appChains.length} networks</span>
      <button type="button" className={styles.network__fullscreen} onClick={toggle} aria-label="View fullscreen" title="View fullscreen">
        <CornersOutIcon size={16} weight="bold" />
      </button>
    </div>
  )
}
