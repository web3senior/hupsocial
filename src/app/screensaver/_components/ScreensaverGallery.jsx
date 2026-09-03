'use client'

import { useRef } from 'react'
import { CornersOutIcon } from '@phosphor-icons/react'
import GalaxyCanvas from './GalaxyCanvas'
import styles from './ScreensaverGallery.module.scss'

const SCENES = [
  { variant: 'nebula', label: 'Nebula' },
  { variant: 'chains', label: 'Chain colours' },
  { variant: 'cinematic', label: 'Cinematic' },
  { variant: 'robinhood', label: 'Robinhood green' },
]

// Fullscreens the scene it sits in; Esc (or the browser UI) exits
function Scene({ variant, label }) {
  const bandRef = useRef(null)
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else bandRef.current?.requestFullscreen?.()
  }
  return (
    <div className={styles.gallery__band} ref={bandRef}>
      <GalaxyCanvas variant={variant} className={styles.gallery__canvas} />
      <span className={styles.gallery__tag}>{label}</span>
      <button type="button" className={styles.gallery__fullscreen} onClick={toggle} aria-label="View fullscreen" title="View fullscreen">
        <CornersOutIcon size={16} weight="bold" />
      </button>
    </div>
  )
}

/**
 * Ambient galaxy scenes. Each band expands into a live fullscreen screensaver — overlays hide
 * so only the artwork shows.
 */
export default function ScreensaverGallery() {
  return (
    <div className={styles.gallery}>
      <p className={styles.gallery__hint}>Pick a scene and take it fullscreen — it drifts and twinkles live, and never loops. Esc leaves.</p>
      {SCENES.map((scene) => (
        <Scene key={scene.variant} {...scene} />
      ))}
    </div>
  )
}
