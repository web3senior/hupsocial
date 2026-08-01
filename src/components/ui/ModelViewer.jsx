'use client'

/**
 * @file components/ui/ModelViewer.jsx
 * @description Inline glTF/GLB viewer for NFTs whose metadata ships a 3D asset alongside
 * the artwork.
 *
 * The renderer is deliberately not part of the app bundle: `@google/model-viewer` registers
 * a custom element as a side effect of being imported, so it is pulled in on mount and only
 * on mount. A visitor browsing listings that are plain images never downloads it.
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { CubeIcon, WarningIcon } from '@phosphor-icons/react'
import { Spinner } from '@/components/Loading'
import styles from './ModelViewer.module.scss'

// Module-level so a page that mounts several viewers imports the renderer once, and a
// remount after the first load is instant rather than another dynamic import round trip.
let rendererPromise = null

const loadRenderer = () => {
  if (!rendererPromise) rendererPromise = import('@google/model-viewer')
  return rendererPromise
}

/**
 * @param {Object} props
 * @param {string} props.src Fully resolved URL of the .glb/.gltf file.
 * @param {string} [props.poster] Still artwork shown until the mesh has loaded.
 * @param {string} [props.alt] Description for assistive technology.
 * @param {string} [props.className] Wrapper class, for the consumer's sizing and chrome.
 */
export default function ModelViewer({ src, poster, alt = '3D model', className }) {
  // 'loading' covers fetching the renderer; the mesh itself reports through model-viewer's
  // own error event once the element exists.
  const [status, setStatus] = useState('loading')
  const elementRef = useRef(null)

  useEffect(() => {
    let active = true

    loadRenderer()
      .then(() => active && setStatus('ready'))
      .catch((error) => {
        console.warn('[ModelViewer] renderer failed to load:', error.message)
        if (active) setStatus('error')
      })

    return () => {
      active = false
    }
  }, [])

  // model-viewer dispatches a plain custom `error` event, which React's synthetic system
  // doesn't surface for unknown elements — so the listener is attached by hand. A mesh that
  // 404s or fails to parse otherwise leaves an empty canvas with no explanation.
  useEffect(() => {
    const element = elementRef.current
    if (status !== 'ready' || !element) return undefined

    const handleError = () => setStatus('error')
    element.addEventListener('error', handleError)
    return () => element.removeEventListener('error', handleError)
  }, [status, src])

  if (status === 'error') {
    return (
      <div className={clsx(styles.model, styles['model--failed'], className)}>
        <WarningIcon size={24} />
        <p>This 3D model couldn&apos;t be displayed.</p>
        <a href={src} target="_blank" rel="noopener noreferrer">
          Open the file
        </a>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className={clsx(styles.model, styles['model--pending'], className)}>
        {poster && <img src={poster} alt="" aria-hidden="true" />}
        <span className={styles.model__pendingBadge}>
          <Spinner size="14px" />
          Loading 3D
        </span>
      </div>
    )
  }

  return (
    <div className={clsx(styles.model, className)}>
      {/* Custom element, so every flag is a real attribute: an empty string reads as
          present, which is what model-viewer's boolean attributes look for. */}
      <model-viewer
        ref={elementRef}
        src={src}
        alt={alt}
        poster={poster || undefined}
        camera-controls=""
        touch-action="pan-y"
        auto-rotate=""
        interaction-prompt="none"
        shadow-intensity="0.6"
        environment-image="neutral"
        loading="eager"
      />
      <span className={styles.model__badge}>
        <CubeIcon size={12} weight="bold" />
        3D
      </span>
    </div>
  )
}
