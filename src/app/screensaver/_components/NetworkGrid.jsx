'use client'

import { useRef } from 'react'
import { CornersOutIcon } from '@phosphor-icons/react'
import { appChains } from '@/config/contracts'
import GalaxyCanvas from './GalaxyCanvas'
import styles from './NetworkGrid.module.scss'

// wagmi's config stamps iconUrl onto the shared chain objects; the inline `icon` SVG is the fallback
const chainIconFor = (chain) => {
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * One square per app chain, each galaxy ramped from that chain's own brand colour with its logo
 * riding the core. The 3x3 board is 1:1 so a fullscreen capture crops straight to a social post.
 */
export default function NetworkGrid() {
  const boardRef = useRef(null)

  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else boardRef.current?.requestFullscreen?.()
  }

  return (
    <div className={styles.network} ref={boardRef}>
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
      <span className={styles.network__tag}>Nine networks</span>
      <button type="button" className={styles.network__fullscreen} onClick={toggle} aria-label="View fullscreen" title="View fullscreen">
        <CornersOutIcon size={16} weight="bold" />
      </button>
    </div>
  )
}
